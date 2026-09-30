"""LLM(NVIDIA / OpenRouter)への問い合わせを一か所にまとめる。

以前は research_bot.py・ensemble_check.py・generate_report.py がそれぞれ
独自に API を呼んでおり、再試行・思考制御・エラー判定の作りが少しずつ
違っていた。判定・抽出・アンサンブルはすべてここを通す。

ここで担っていること:
  1. 送信間隔の制御(全スレッド合計で REQUESTS_PER_MINUTE 以下)
     以前は判定結果を受け取る側で time.sleep(2) していたが、その時点で
     全バッチは投入済みなので送信の間隔には効いていなかった。
  2. モデル名の事前確認(preflight)
     モデル名の打ち間違い(例: ...-a12b の b 抜け)は 404 になる。以前は
     404 を「思考制御パラメータの拒否」と区別できず、数百バッチ分の
     再試行を終えてから全件「未判定」になって初めて気づいていた。
  3. 404 は待っても直らないので、再試行を重ねずに打ち切る
  4. Ctrl-C で並列処理を即座に止める(run_parallel)
     ThreadPoolExecutor を with で使うと、Ctrl-C を押しても残り全バッチの
     完了を待ってしまい、中断処理(チェックポイント保存)に届かなかった。

戻り値の約束: ask() は失敗時に例外を投げず、ERROR_PREFIX で始まる文字列を
返す。呼び出し側は is_error() で見分ける(既存コードとの互換のため)。
"""

import concurrent.futures
import difflib
import itertools
import os
import threading
import time

from openai import OpenAI
from tqdm import tqdm

import config

ERROR_PREFIX = "【"

# Ctrl-C 等で処理全体を止めるときに立てる。送信前・待機中・受信中に見る。
STOP = threading.Event()

_client = None
_client_lock = threading.Lock()

_rl_lock = threading.Lock()
_next_slot = 0.0

# 実行中の問い合わせ(応答待ちの表示に使う)。id → 状況
_active = {}
_active_lock = threading.Lock()
_active_ids = itertools.count()

_models_cache = None          # バックエンドのモデル一覧(取得できなければ None)
_verified_models = set()      # preflight で実在を確かめたモデル
_no_guided = set()            # guided_json を拒否したモデル
_no_thinking_param = set()    # 思考制御パラメータを拒否したモデル
_no_stream = set()            # ストリーミングで何も返ってこなかったモデル(以後まとめて受け取る)
_giveups = {}                 # モデル → 続けて諦めたバッチ数
_dead = set()                 # 応答していないとみなしたモデル(以後は問い合わせない)


def is_error(text: str) -> bool:
    return (text or "").startswith(ERROR_PREFIX)


def have_api_key() -> bool:
    if config.API_BACKEND == "openrouter":
        return bool(os.environ.get("OPENROUTER_API_KEY"))
    return bool(os.environ.get("NVIDIA_API_KEY"))


def key_name() -> str:
    return ("OPENROUTER_API_KEY" if config.API_BACKEND == "openrouter"
            else "NVIDIA_API_KEY")


def get_client() -> OpenAI:
    global _client
    with _client_lock:
        if _client is None:
            if config.API_BACKEND == "openrouter":
                _client = OpenAI(base_url=config.OPENROUTER_BASE_URL,
                                 api_key=os.environ.get("OPENROUTER_API_KEY", ""),
                                 max_retries=0)
            else:
                # max_retries=0: openai ライブラリは既定で時間切れ等を黙って
                # 2回やり直す。こちらでも再試行するので、待ち時間が最大3倍に
                # 膨らんでいた(実測: 240秒の上限で最初の時間切れ表示が約720秒後)。
                _client = OpenAI(base_url=config.NVIDIA_BASE_URL,
                                 api_key=os.environ.get("NVIDIA_API_KEY", ""),
                                 max_retries=0)
        return _client


# ==========================================
# 送信間隔
# ==========================================
def _throttle() -> bool:
    """次の送信枠まで待つ。止める指示が出たら False を返す。"""
    global _next_slot
    rpm = max(1, config.REQUESTS_PER_MINUTE)
    with _rl_lock:
        now = time.monotonic()
        wait = _next_slot - now
        _next_slot = max(now, _next_slot) + 60.0 / rpm
    if wait > 0:
        return not STOP.wait(wait)
    return not STOP.is_set()


def _sleep(sec: float) -> bool:
    """中断可能な待機。止める指示が出たら False。"""
    return not STOP.wait(sec)


# ==========================================
# モデルの事前確認
# ==========================================
def list_models():
    """バックエンドが公開しているモデル名の集合。取得できなければ None。"""
    global _models_cache
    if _models_cache is not None:
        return _models_cache
    try:
        ids = {m.id for m in get_client().models.list().data}
        _models_cache = ids or None
    except Exception as e:
        tqdm.write(f"[モデル確認] モデル一覧を取得できませんでした"
                   f"({type(e).__name__}: {str(e)[:120]})")
        _models_cache = None
    return _models_cache


def _probe(model: str) -> str:
    """1トークンだけ生成させて、モデルが呼べるか確かめる。成功なら空文字。"""
    try:
        get_client().chat.completions.create(
            model=model, messages=[{"role": "user", "content": "OK"}],
            max_tokens=1, timeout=60)
        return ""
    except Exception as e:
        return f"{type(e).__name__}: {str(e)[:200]}"


def preflight(models) -> None:
    """使う予定のモデルが実在するか確かめ、無ければ処理を始める前に止める。

    一覧(/v1/models)に載っていれば合格。載っていない場合は、一覧に
    出ないだけで呼べるモデルもありうるため、1トークンだけ試しに呼ぶ。
    それも 404 なら打ち間違いとみなして止める。
    """
    if not have_api_key():
        raise SystemExit(f"[エラー] {key_name()} が設定されていません。\n"
                         f"        export {key_name()}=\"...\" を実行するか、"
                         f"{config.KEYS_FILE} に書いてください。")
    available = list_models()
    for m in dict.fromkeys(x for x in models if x):
        if m in _verified_models:
            continue
        if available and m in available:
            _verified_models.add(m)
            continue
        err = _probe(m)
        if not err:
            _verified_models.add(m)
            if available:
                tqdm.write(f"[モデル確認] {m} は一覧に無いが呼び出せました。")
            continue
        near = difflib.get_close_matches(m, sorted(available or []), n=3, cutoff=0.6)
        hint = ("\n        近い名前: " + " / ".join(near)) if near else ""
        raise SystemExit(
            f"[エラー] モデル '{m}' を呼び出せません: {err}{hint}\n"
            "        config.py のモデル名を確認するか、--model で別のモデルを"
            "指定してください。\n"
            "        使えるモデルの一覧: python research_bot.py models")
    tqdm.write("[モデル確認] OK — " + " / ".join(dict.fromkeys(x for x in models if x)))


# ==========================================
# 問い合わせ
# ==========================================
def _thinking_off_body(model: str) -> dict:
    """思考を止める(または最小にする)ための追加パラメータ。

    Nemotron 等は chat_template_kwargs.enable_thinking=false で止まるが、
    gpt-oss はこれを無視して考え続ける。gpt-oss は reasoning_effort で
    思考の量を指定する(low が最小。完全には止められない)。
    """
    if config.API_BACKEND == "openrouter":
        return {"reasoning": {"enabled": False}}
    if "gpt-oss" in model.lower():
        return {"reasoning_effort": "low"}
    return {"chat_template_kwargs": {"enable_thinking": False}}


class ResponseTooLong(Exception):
    """応答全体が REQUEST_TIMEOUT を超えた。"""


def _with_deadline(fn, seconds: float):
    """fn() を別スレッドで実行し、seconds 秒を超えたら ResponseTooLong を投げる。

    まとめて受け取る方式では、サーバーが接続維持のための空データを送り続けると
    ライブラリのタイムアウトが効かない。待つのをやめて先へ進む(置き去りにした
    スレッドは、通信が終わるか切れた時点で消える)。
    """
    box = {}
    done = threading.Event()

    def run():
        try:
            box["value"] = fn()
        except BaseException as e:      # 呼び出し側でそのまま投げ直す
            box["error"] = e
        finally:
            done.set()

    threading.Thread(target=run, daemon=True).start()
    if not done.wait(seconds):
        raise ResponseTooLong(f"{seconds:.0f}秒以内に応答がありませんでした")
    if "error" in box:
        raise box["error"]
    return box["value"]


def _kill_stream(stream, info):
    """時間切れのストリームを外から閉じる(1文字も届かない場合でも打ち切るため)。"""
    info["killed"] = True
    close = getattr(stream, "close", None)
    if close:
        try:
            close()
        except Exception:
            pass


def _record_giveup(model: str) -> None:
    n = _giveups.get(model, 0) + 1
    _giveups[model] = n
    if n >= config.DEAD_MODEL_AFTER and model not in _dead:
        _dead.add(model)
        tqdm.write(f"  [!] {model} が{n}バッチ続けて応答しなかったため、このモデルへの"
                   "残りの問い合わせを打ち切ります。NVIDIA 側で混雑しているか停止して"
                   "いる可能性があります。時間をおいて再実行するか、"
                   "python research_bot.py probe で応答するモデルを確かめてください。")


def is_dead(model: str) -> bool:
    return model in _dead


def activity_summary() -> str:
    """応答待ちの状況を1行で返す(待っている問い合わせが無ければ空文字)。"""
    now = time.monotonic()
    with _active_lock:
        rows = list(_active.values())
    if not rows:
        return ""
    batch_mode = any(not r.get("stream", True) for r in rows)
    longest = max(now - r["start"] for r in rows)
    content = sum(r["content"] for r in rows)
    reasoning = sum(r["reasoning"] for r in rows)
    if batch_mode:
        what = "応答をまとめて受け取る方式で待機中(完了まで何も表示されません)"
    elif content == 0 and reasoning == 0:
        what = "サーバーからまだ何も届いていません(混雑している可能性)"
    elif content == 0:
        what = (f"思考 {reasoning:,}字を受信中・本文はまだ(思考の長いモデルは"
                "時間がかかります)")
    else:
        what = f"本文 {content:,}字・思考 {reasoning:,}字を受信"
    return (f"  … 応答待ち {len(rows)}本 / 最長 {longest:.0f}秒経過"
            f"(上限 {config.REQUEST_TIMEOUT}秒) / {what}")


def ask(prompt: str, model: str, *, system: str = None, max_tokens: int = None,
        temperature: float = None, schema: dict = None,
        disable_thinking: bool = True) -> str:
    """1回問い合わせて本文を返す。失敗時は ERROR_PREFIX で始まる文字列。

    schema を渡し、config.USE_GUIDED_JSON が True なら、NVIDIA NIM の
    構造化出力(nvext.guided_json)で JSON の形を強制する。拒否されたら
    そのモデルでは以後使わない。
    """
    if not have_api_key():
        return f"{ERROR_PREFIX}エラー】{key_name()} が設定されていません。"
    if model in _dead:
        return f"{ERROR_PREFIX}通信エラー】{model} は応答していないため省略"
    client = get_client()
    messages = ([{"role": "system", "content": system}] if system else []) + \
               [{"role": "user", "content": prompt}]
    max_tokens = max_tokens or config.MAX_TOKENS
    temperature = config.TEMPERATURE if temperature is None else temperature

    use_thinking_off = disable_thinking and model not in _no_thinking_param
    use_guided = (schema is not None and config.USE_GUIDED_JSON
                  and config.API_BACKEND == "nvidia" and model not in _no_guided)

    last = None
    attempt = 0
    timeouts = 0
    # ストリーミングでは、この値は「何も届かない時間」の上限として効く。
    # 応答全体の上限は下のループで REQUEST_TIMEOUT と比べて打ち切る。
    # (httpx を直接使わないのは、openai のバージョンによって下回りの
    #  HTTP ライブラリが httpx / httpx2 と異なるため)
    timeout = float(config.READ_TIMEOUT)
    while attempt < config.MAX_RETRIES:
        if not _throttle():
            return f"{ERROR_PREFIX}中断】"
        extra_body = {}
        if use_thinking_off:
            extra_body.update(_thinking_off_body(model))
        if use_guided:
            extra_body["nvext"] = {"guided_json": schema}
        use_stream = model not in _no_stream
        rid = next(_active_ids)
        info = {"model": model, "start": time.monotonic(), "content": 0,
                "reasoning": 0, "stream": use_stream}
        with _active_lock:
            _active[rid] = info
        try:
            if not use_stream:
                # まとめて受け取る。応答全体の上限をそのままタイムアウトにする。
                resp = _with_deadline(lambda: client.chat.completions.create(
                    model=model, messages=messages,
                    timeout=float(config.REQUEST_TIMEOUT),
                    max_tokens=max_tokens, temperature=temperature, stream=False,
                    extra_body=extra_body or None), config.REQUEST_TIMEOUT)
                ch = resp.choices[0] if resp.choices else None
                text = (ch.message.content or "") if ch else ""
                if ch and getattr(ch, "finish_reason", None) == "length":
                    tqdm.write(f"    [!] max_tokens({max_tokens})に達し、応答が途中で"
                               "打ち切られました。")
                _giveups[model] = 0
                return text
            stream = client.chat.completions.create(
                model=model, messages=messages, timeout=timeout,
                max_tokens=max_tokens, temperature=temperature, stream=True,
                extra_body=extra_body or None)
            parts, finish = [], None
            # 1文字も届かなくても REQUEST_TIMEOUT で打ち切れるよう、外から閉じる
            left = config.REQUEST_TIMEOUT - (time.monotonic() - info["start"])
            killer = threading.Timer(max(1.0, left), _kill_stream, (stream, info))
            killer.daemon = True
            killer.start()
            try:
                for chunk in stream:
                    if STOP.is_set():
                        return f"{ERROR_PREFIX}中断】"
                    if time.monotonic() - info["start"] > config.REQUEST_TIMEOUT:
                        raise ResponseTooLong(
                            f"応答全体が{config.REQUEST_TIMEOUT}秒を超えました"
                            f"(本文 {info['content']}字 / 思考 {info['reasoning']}字)")
                    if not chunk.choices:
                        continue
                    ch = chunk.choices[0]
                    if getattr(ch, "finish_reason", None):
                        finish = ch.finish_reason
                    delta = ch.delta
                    # 思考トレースは reasoning_content に分かれて届く。本文には集めない。
                    r = getattr(delta, "reasoning_content", None)
                    if r:
                        info["reasoning"] += len(r)
                        continue
                    piece = getattr(delta, "content", None)
                    if piece:
                        parts.append(piece)
                        info["content"] += len(piece)
                if info.get("killed"):
                    raise ResponseTooLong(
                        f"応答全体が{config.REQUEST_TIMEOUT}秒を超えました"
                        f"(本文 {info['content']}字 / 思考 {info['reasoning']}字)")
            finally:
                killer.cancel()
                close = getattr(stream, "close", None)
                if close:
                    try:
                        close()
                    except Exception:
                        pass
            text = "".join(parts)
            _giveups[model] = 0
            if finish == "length":
                tqdm.write(f"    [!] max_tokens({max_tokens})に達し、応答が途中で"
                           "打ち切られました。")
            elif finish is None and text:
                tqdm.write("    [!] 応答が終了の合図なしに途切れました"
                           "(タイムアウトや接続断の可能性)。")
            return text
        except Exception as e:
            if info.get("killed") and not isinstance(e, ResponseTooLong):
                # 外から閉じたことで起きた通信エラーは、時間切れとして扱う
                e = ResponseTooLong(
                    f"応答全体が{config.REQUEST_TIMEOUT}秒を超えました"
                    f"(本文 {info['content']}字 / 思考 {info['reasoning']}字)")
            last = e
            msg = str(e)
            low = msg.lower()
            status = getattr(e, "status_code", None)

            # 時間切れ(応答全体が長すぎる/何も届かない)。同じ条件で何度
            # 送っても同じになりやすいので、MAX_TIMEOUTS 回で諦める。
            if isinstance(e, ResponseTooLong) or "Timeout" in type(e).__name__:
                # ストリーミングで1文字も届かないまま時間切れ → このモデルは
                # ストリーミングで応答を返さない可能性がある(旧 ensemble_check.py
                # はまとめて受け取る方式で gemma から応答を得ていた)。以後
                # まとめて受け取る方式に切り替えて送り直す。切り替えも1回の
                # 時間切れとして数える(応答しないモデルで待ち時間が膨らまないように)。
                timeouts += 1
                silent = use_stream and info["content"] == 0 and info["reasoning"] == 0
                if silent and model not in _no_stream:
                    _no_stream.add(model)
                    tqdm.write(f"    [i] {model} からストリーミングで応答が来ないため、"
                               "応答をまとめて受け取る方式に切り替えます。")
                if silent and timeouts < config.MAX_TIMEOUTS:
                    continue
                if isinstance(e, ResponseTooLong):
                    why = msg
                elif use_stream:
                    why = f"{config.READ_TIMEOUT}秒間サーバーから何も届きませんでした"
                else:
                    why = f"{config.REQUEST_TIMEOUT}秒以内に応答がありませんでした"
                if timeouts >= config.MAX_TIMEOUTS or model in _dead:
                    tqdm.write(f"    [!] 時間切れが{timeouts}回続いたため、このバッチを"
                               f"諦めます({model}): {why}")
                    _record_giveup(model)
                    return f"{ERROR_PREFIX}通信エラー】timeout: {why}"
                tqdm.write(f"    [!] 時間切れ({model}): {why}。もう一度送ります。")
                continue

            # OpenRouterのクレジット不足は待っても直らない
            if config.API_BACKEND == "openrouter" and (
                    status == 402 or ("insufficient" in low and "credit" in low)):
                tqdm.write(f"    [!] OpenRouterのクレジット不足(402)。"
                           f"再試行しても直りません: {msg[:200]}")
                return f"{ERROR_PREFIX}通信エラー】{msg[:300]}"

            # 構造化出力の拒否 → 外してやり直す(試行回数は消費しない)
            if use_guided and (status in (400, 422) or "guided" in low
                               or "nvext" in low):
                tqdm.write(f"    [i] {model} は guided_json に対応していないため、"
                           "外して再送します。")
                _no_guided.add(model)
                use_guided = False
                continue

            # 思考制御パラメータの拒否 → 外してやり直す
            param_hint = ("chat_template_kwargs" in low or "enable_thinking" in low
                          or "reasoning" in low)
            if use_thinking_off and (param_hint or status == 404
                                     or "404" in msg):
                tqdm.write(f"    [!] 思考制御パラメータが拒否された可能性があります。"
                           f"外して再送します(遅くなることがあります): {msg[:160]}")
                _no_thinking_param.add(model)
                use_thinking_off = False
                continue

            # パラメータを外しても 404 → モデル名の誤り。待っても直らない。
            if status == 404 or "404" in msg:
                tqdm.write(f"    [!] 404: モデル '{model}' が見つかりません。"
                           "モデル名を確認してください(python research_bot.py models)。")
                return f"{ERROR_PREFIX}通信エラー】404 model not found: {model}"

            # コンテキスト長超過も待っても直らない
            if ("maximum context length" in low or "context_length_exceeded" in low
                    or "reduce the length" in low):
                tqdm.write(f"    [!] コンテキスト長超過: {msg[:200]}")
                return f"{ERROR_PREFIX}通信エラー】context length exceeded"

            attempt += 1
            if attempt >= config.MAX_RETRIES:
                break
            is_rate = type(e).__name__ == "RateLimitError" or status == 429 or "429" in msg
            if is_rate:
                wait = config.RATE_LIMIT_WAIT_BASE * (2 ** (attempt - 1))
                tqdm.write(f"    [!] レート制限(429)。{wait}秒後に再試行 "
                           f"({attempt}/{config.MAX_RETRIES})")
            else:
                wait = config.RETRY_WAIT * attempt
                tqdm.write(f"    [!] 通信エラー({type(e).__name__}): {msg[:200]}")
                tqdm.write(f"        {wait}秒後に再試行 ({attempt}/{config.MAX_RETRIES})")
            if not _sleep(wait):
                return f"{ERROR_PREFIX}中断】"
        finally:
            with _active_lock:
                _active.pop(rid, None)
    return f"{ERROR_PREFIX}通信エラー】{last}"


def ask_ai(prompt: str, model_id: str) -> str:
    """旧来の呼び出し形(ask_ai(prompt, model))との互換用。"""
    return ask(prompt, model_id)


# ==========================================
# 並列実行
# ==========================================
def run_parallel(func, jobs, desc: str, on_result=None, concurrency: int = None,
                 checkpoint=None, checkpoint_every: int = 0) -> int:
    """jobs の各要素に func を並列に適用し、結果を on_result へ渡す。

    on_result はメインスレッドで呼ばれる。結果を items へ書き込む処理は
    ここで行うこと。ワーカー側で書き込むと、中断時のチェックポイント保存と
    書き込みが同時に起きて、保存が壊れることがある。

    Ctrl-C を受けたら、未着手のジョブを取り消し、実行中のジョブにも STOP で
    止まるよう合図してから KeyboardInterrupt をそのまま投げ直す。
    戻り値は完了したジョブの数。
    """
    jobs = list(jobs)
    if not jobs:
        return 0
    STOP.clear()
    ex = concurrent.futures.ThreadPoolExecutor(
        max_workers=concurrency or config.CONCURRENCY)
    done = 0
    bar = tqdm(total=len(jobs), desc=desc, dynamic_ncols=True)
    try:
        futs = {ex.submit(func, j): j for j in jobs}
        pending = set(futs)
        while pending:
            # 一定時間ごとに目を覚まし、何も終わっていなければ応答待ちの
            # 状況を出す。進捗バーは完了時にしか動かないので、これが無いと
            # 「止まったのか、考えているのか」が見分けられなかった。
            finished, pending = concurrent.futures.wait(
                pending, timeout=config.HEARTBEAT_SECONDS,
                return_when=concurrent.futures.FIRST_COMPLETED)
            if not finished:
                line = activity_summary()
                if line:
                    tqdm.write(line)
                continue
            for f in finished:
                try:
                    res = f.result()
                except Exception as e:
                    tqdm.write(f"  [!] 処理中の例外({type(e).__name__}: {e})。"
                               "このジョブは結果なしとして扱います。")
                    res = None
                if on_result is not None:
                    on_result(futs[f], res)
                done += 1
                bar.update(1)
                if checkpoint and checkpoint_every and done % checkpoint_every == 0:
                    checkpoint()
    except KeyboardInterrupt:
        STOP.set()
        bar.close()
        ex.shutdown(wait=False, cancel_futures=True)
        raise
    bar.close()
    ex.shutdown(wait=True)
    if checkpoint:
        checkpoint()
    return done
