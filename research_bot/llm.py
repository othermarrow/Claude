"""LLM(NVIDIA API)への問い合わせと、応答の読み取り。

1段目の粗選別・関連度判定・設計の抽出・再判定は、すべてここを通す
(旧 jsonparse.py もここへ統合した)。以前は prefilter.py だけが独自に API を
呼んでおり、Ctrl-C で止まらない・送信間隔の制御を通らない、というずれが
残っていた。

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
  5. 応答しなくなったモデルを、config.FALLBACK_ORDER(再判定は
     ENSEMBLE_FALLBACK_ORDER)の順に代わりのモデルへ切り替える(ask_fallback)
  6. 応答からJSONのレコード配列を取り出す(parse_json_array)

戻り値の約束: ask() は失敗時に例外を投げず、ERROR_PREFIX で始まる文字列を
返す。呼び出し側は is_error() で見分ける。
"""

import concurrent.futures
import difflib
import itertools
import json
import os
import re
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
_no_thinking_param = set()    # 思考制御パラメータを拒否した (モデル, 種類)
_no_stream = set()            # ストリーミングで何も返ってこなかったモデル(以後まとめて受け取る)
_giveups = {}                 # モデル → 続けて諦めたバッチ数
_dead = set()                 # 応答していないとみなしたモデル(以後は問い合わせない)
_switched = set()             # 切り替えを知らせた (元のモデル, 代わりのモデル)
_switch_lock = threading.Lock()


def is_error(text: str) -> bool:
    return (text or "").startswith(ERROR_PREFIX)


KEY_NAME = "NVIDIA_API_KEY"


def have_api_key() -> bool:
    return bool(os.environ.get(KEY_NAME))


def get_client() -> OpenAI:
    global _client
    with _client_lock:
        if _client is None:
            # max_retries=0: openai ライブラリは既定で時間切れ等を黙って
            # 2回やり直す。こちらでも再試行するので、待ち時間が最大3倍に
            # 膨らんでいた(実測: 240秒の上限で最初の時間切れ表示が約720秒後)。
            _client = OpenAI(base_url=config.NVIDIA_BASE_URL,
                             api_key=os.environ.get(KEY_NAME, ""), max_retries=0)
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


def _probe_one(model: str) -> str:
    """1トークンだけ生成させて、モデルが呼べるか確かめる。成功なら空文字。"""
    try:
        get_client().chat.completions.create(
            model=model, messages=[{"role": "user", "content": "OK"}],
            max_tokens=1, timeout=60)
        return ""
    except Exception as e:
        return f"{type(e).__name__}: {str(e)[:200]}"


def preflight(models, fallbacks=None) -> None:
    """使う予定のモデルが実在するか確かめ、無ければ処理を始める前に止める。

    一覧(/v1/models)に載っていれば合格。載っていない場合は、一覧に
    出ないだけで呼べるモデルもありうるため、1トークンだけ試しに呼ぶ。
    それも 404 なら打ち間違いとみなして止める。

    fallbacks(代わりのモデル。省略時は FALLBACK_ORDER と ENSEMBLE_FALLBACK_ORDER)は
    止める理由にしない。一覧に無いものは切り替え先から外すだけにする。
    """
    if not have_api_key():
        raise SystemExit(f"[エラー] {KEY_NAME} が設定されていません。\n"
                         f"        {config.KEYS_FILE} に {KEY_NAME}=... と書くか、"
                         "環境変数で渡してください。")
    available = list_models()
    for m in dict.fromkeys(x for x in models if x):
        if m in _verified_models:
            continue
        if available and m in available:
            _verified_models.add(m)
            continue
        err = _probe_one(m)
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
    if fallbacks is None:
        fallbacks = list(dict.fromkeys(config.fallback_models()
                                       + config.fallback_models("ensemble")))
    if available:
        missing = [m for m in fallbacks if m not in available and m not in _verified_models]
        for m in missing:
            _dead.add(m)
        if missing:
            tqdm.write("[モデル確認] 一覧に無いため切り替え先から外しました: "
                       + " / ".join(missing))
    for label, order in (("判定", config.fallback_models()),
                         ("再判定", config.fallback_models("ensemble"))):
        usable = [m for m in order if m in fallbacks and m not in _dead]
        if usable:
            tqdm.write(f"[モデル確認] {label}の切り替え先: " + " → ".join(usable))


def probe(models, limit: int = 60) -> None:
    """モデルが今応答するかを、短い問い合わせで確かめて表示する。

    無料枠のモデルは時間帯によって全く応答しないことがある。長い処理を
    始める前に、1分ほどで確かめられるようにする。
    """
    client = get_client()
    print(f"短い問い合わせで応答を確かめます(1回あたり最大{limit}秒)\n")
    for m in models:
        body = _thinking_body(m, None)
        msgs = [{"role": "user", "content": "Reply with the single word OK."}]
        row = [m]
        # まとめて受け取る方式
        t0 = time.monotonic()
        try:
            r = _with_deadline(lambda: client.chat.completions.create(
                model=m, messages=msgs, max_tokens=64, temperature=0,
                stream=False, timeout=float(limit), extra_body=body), limit)
            txt = ((r.choices[0].message.content or "").strip()
                   if r.choices else "")
            row.append(f"まとめて: {time.monotonic() - t0:.1f}秒 ({txt[:12]!r})")
        except Exception as e:
            row.append(f"まとめて: 失敗 {time.monotonic() - t0:.0f}秒 "
                       f"({type(e).__name__}: {str(e)[:60]})")
        # ストリーミング
        t0, first = time.monotonic(), None
        try:
            def run_stream():
                nonlocal first
                s = client.chat.completions.create(
                    model=m, messages=msgs, max_tokens=64, temperature=0,
                    stream=True, timeout=float(limit), extra_body=body)
                for _ in s:
                    if first is None:
                        first = time.monotonic() - t0
                return True
            _with_deadline(run_stream, limit)
            row.append(f"ストリーミング: 最初の応答 {first or 0:.1f}秒 / "
                       f"完了 {time.monotonic() - t0:.1f}秒")
        except Exception as e:
            row.append(f"ストリーミング: 失敗 {time.monotonic() - t0:.0f}秒 "
                       f"({type(e).__name__})")
        print(f"■ {row[0]}\n    {row[1]}\n    {row[2]}")
    print("\n両方失敗するモデルは、今は使えません。時間をおくか別のモデルを"
          "選んでください(一覧: python research_bot.py models)。")


# ==========================================
# 問い合わせ
# ==========================================
def _thinking_body(model: str, effort) -> dict:
    """思考の量を指定する追加パラメータ。

    effort が None なら思考を止める(または最小にする)。
      Nemotron 等は chat_template_kwargs.enable_thinking=false で止まるが、
      gpt-oss はこれを無視して考え続ける。gpt-oss は reasoning_effort で
      思考の量を指定する(low が最小。完全には止められない)。
    effort に "low" 等を渡すと、その量で考えさせる(1段目の粗選別が使う)。
    """
    if effort or "gpt-oss" in model.lower():
        return {"reasoning_effort": effort or "low"}
    return {"chat_template_kwargs": {"enable_thinking": False}}


class ResponseTooLong(Exception):
    """応答全体が上限時間を超えた。"""


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
                   "いる可能性があります(config.FALLBACK_ORDER に代わりのモデルが"
                   "あれば、そちらで続けます)。")


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
    limit = max(r["limit"] for r in rows)
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
            f"(上限 {limit:.0f}秒) / {what}")


def ask(prompt: str, model: str, *, system: str = None, max_tokens: int = None,
        temperature: float = None, schema: dict = None,
        disable_thinking: bool = True, reasoning_effort: str = None,
        timeout: float = None, mark_dead: bool = True) -> str:
    """1回問い合わせて本文を返す。失敗時は ERROR_PREFIX で始まる文字列。

    schema を渡し、config.USE_GUIDED_JSON が True なら、NVIDIA NIM の
    構造化出力(nvext.guided_json)で JSON の形を強制する。拒否されたら
    そのモデルでは以後使わない。

    reasoning_effort  "low" 等を渡すと、思考を止める代わりにその量で考えさせる。
    timeout           応答全体の上限(秒)。省略時は config.REQUEST_TIMEOUT。
    mark_dead         False なら、時間切れが続いてもモデルを「応答しない」と
                      みなさない。1段目の粗選別は短い上限で待つため、その
                      時間切れで2段目の判定まで止めてしまわないようにする。
    """
    if not have_api_key():
        return f"{ERROR_PREFIX}エラー】{KEY_NAME} が設定されていません。"
    if model in _dead:
        return f"{ERROR_PREFIX}通信エラー】{model} は応答していないため省略"
    client = get_client()
    messages = ([{"role": "system", "content": system}] if system else []) + \
               [{"role": "user", "content": prompt}]
    max_tokens = max_tokens or config.MAX_TOKENS
    temperature = config.TEMPERATURE if temperature is None else temperature
    limit = float(timeout or config.REQUEST_TIMEOUT)

    think_key = (model, reasoning_effort or "off")
    use_think = ((reasoning_effort or disable_thinking)
                 and think_key not in _no_thinking_param)
    use_guided = (schema is not None and config.USE_GUIDED_JSON
                  and model not in _no_guided)

    last = None
    attempt = 0
    timeouts = 0
    # ストリーミングでは、この値は「何も届かない時間」の上限として効く。
    # 応答全体の上限は下のループで limit と比べて打ち切る。
    # (httpx を直接使わないのは、openai のバージョンによって下回りの
    #  HTTP ライブラリが httpx / httpx2 と異なるため)
    read_timeout = min(float(config.READ_TIMEOUT), limit)
    while attempt < config.MAX_RETRIES:
        if not _throttle():
            return f"{ERROR_PREFIX}中断】"
        extra_body = {}
        if use_think:
            extra_body.update(_thinking_body(model, reasoning_effort))
        if use_guided:
            extra_body["nvext"] = {"guided_json": schema}
        use_stream = model not in _no_stream
        rid = next(_active_ids)
        info = {"model": model, "start": time.monotonic(), "content": 0,
                "reasoning": 0, "stream": use_stream, "limit": limit}
        with _active_lock:
            _active[rid] = info
        try:
            if not use_stream:
                # まとめて受け取る。応答全体の上限をそのままタイムアウトにする。
                resp = _with_deadline(lambda: client.chat.completions.create(
                    model=model, messages=messages, timeout=limit,
                    max_tokens=max_tokens, temperature=temperature, stream=False,
                    extra_body=extra_body or None), limit)
                ch = resp.choices[0] if resp.choices else None
                text = (ch.message.content or "") if ch else ""
                if ch and getattr(ch, "finish_reason", None) == "length":
                    tqdm.write(f"    [!] max_tokens({max_tokens})に達し、応答が途中で"
                               "打ち切られました。")
                _giveups[model] = 0
                return text
            stream = client.chat.completions.create(
                model=model, messages=messages, timeout=read_timeout,
                max_tokens=max_tokens, temperature=temperature, stream=True,
                extra_body=extra_body or None)
            parts, finish = [], None
            # 1文字も届かなくても limit で打ち切れるよう、外から閉じる
            left = limit - (time.monotonic() - info["start"])
            killer = threading.Timer(max(1.0, left), _kill_stream, (stream, info))
            killer.daemon = True
            killer.start()
            try:
                for chunk in stream:
                    if STOP.is_set():
                        return f"{ERROR_PREFIX}中断】"
                    if time.monotonic() - info["start"] > limit:
                        raise ResponseTooLong(
                            f"応答全体が{limit:.0f}秒を超えました"
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
                        f"応答全体が{limit:.0f}秒を超えました"
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
                    f"応答全体が{limit:.0f}秒を超えました"
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
                    why = f"{read_timeout:.0f}秒間サーバーから何も届きませんでした"
                else:
                    why = f"{limit:.0f}秒以内に応答がありませんでした"
                if timeouts >= config.MAX_TIMEOUTS or model in _dead:
                    tqdm.write(f"    [!] 時間切れが{timeouts}回続いたため、このバッチを"
                               f"諦めます({model}): {why}")
                    if mark_dead:
                        _record_giveup(model)
                    return f"{ERROR_PREFIX}通信エラー】timeout: {why}"
                tqdm.write(f"    [!] 時間切れ({model}): {why}。もう一度送ります。")
                continue

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
            if use_think and (param_hint or status == 404 or "404" in msg):
                tqdm.write(f"    [!] 思考制御パラメータが拒否された可能性があります。"
                           f"外して再送します(遅くなることがあります): {msg[:160]}")
                _no_thinking_param.add(think_key)
                use_think = False
                continue

            # パラメータを外しても 404 → モデル名の誤りか提供終了。待っても直らない
            # ので、以後は呼ばない(代わりのモデルがあればそちらへ切り替わる)。
            if status == 404 or "404" in msg:
                tqdm.write(f"    [!] 404: モデル '{model}' が見つかりません。"
                           "モデル名を確認してください(python research_bot.py models)。")
                if mark_dead:
                    _dead.add(model)
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
                # 429 は短い間隔で送り直すほど長引くので、倍々で待つ
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


# ==========================================
# 代わりのモデルへの切り替え
# ==========================================
def pick_model(model: str, avoid=(), order=None):
    """今使うモデル。model が使えなければ order(省略時は FALLBACK_ORDER)の順で次の候補。

    応答しないと判定したモデルと avoid に入っているモデルは飛ばす。
    候補が尽きたら None。
    """
    for m in [model] + (config.fallback_models() if order is None else list(order)):
        if m in _dead or m in avoid:
            continue
        if m != model:
            with _switch_lock:
                first = (model, m) not in _switched
                _switched.add((model, m))
            if first:
                tqdm.write(f"  [切替] {model} が使えないため、以後は {m} で続けます"
                           "(config.py の切り替えの順番による)。")
        return m
    return None


def ask_fallback(prompt: str, model: str, *, avoid=(), order=None,
                 any_error: bool = False, **kw) -> tuple:
    """ask() と同じだが、model が使えなくなったら代わりのモデルで送り直す。

    戻り値は (本文, 実際に使ったモデル)。
    any_error=False(既定): モデルが「応答しない」と判定されたときだけ切り替える。
        数百回呼ぶ判定・抽出向け。1回の失敗で切り替えると、判定するモデルが
        頻繁に入れ替わり、カタログの中で判定の基準が揺れる。
    any_error=True: 失敗したら即座に次のモデルへ。1回しか呼ばないファセット
        抽出向け。
    """
    skip = set(avoid)
    while True:
        use = pick_model(model, skip, order)
        if use is None:
            return f"{ERROR_PREFIX}通信エラー】応答するモデルが残っていません", model
        raw = ask(prompt, use, **kw)
        if not is_error(raw) or "中断" in raw:
            return raw, use
        if any_error:
            skip.add(use)
        elif use not in _dead:
            return raw, use


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


# ==========================================
# 応答の読み取り(旧 jsonparse.py)
# ==========================================
# 厳密な json.loads は応答全体が正しいJSONであることを要求するため、
# 本体は正しく書けているのに前後に余計なものが付いただけで全滅する。
# 実測した失敗の大半はこの型だった。
#
#   [{...}]\n]                     末尾に余分な閉じ括弧
#   [{...}]}                       同上
#   [{...}]\n[{...}]               同じ配列を2回出力
#   [{...}], [{...}]               同上(カンマ区切り)
#   [{...}]\n\nNote: Only one ...  JSONの後ろに英語の説明文
#   [{...}]\nfalse: 対象外分野...  JSONの後ろに崩れた続き
#
# いずれも先頭の完全なJSON値だけを読めば救える。読めない場合でも、
# 完結している {...} を1件ずつ拾えば、途中で切れた応答から手前の分だけ
# 回収できる。6件のバッチが1件の破損で全滅するのを防ぐのが目的。
#
# なお「応答が閉じ括弧なしで終わっている＝max_tokens不足」という従来の
# 診断は、上記の型では誤診になる。JSONは完結していて、その後ろに
# 余計なものが付いているだけだからである。
_FENCE_RE = re.compile(r"```(?:json)?", re.IGNORECASE)


def _as_records(value) -> list:
    """JSON値をレコードの配列にそろえる。単一オブジェクトも1件の配列とみなす。"""
    if isinstance(value, list):
        return [v for v in value if isinstance(v, dict)]
    if isinstance(value, dict):
        return [value]
    return []


def _salvage_objects(s: str) -> list:
    """完結している {...} を先頭から順に拾う。文字列の中の括弧は数えない。"""
    out, depth, start, in_str, esc = [], 0, None, False, False
    for i, ch in enumerate(s):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            if depth:
                depth -= 1
                if depth == 0 and start is not None:
                    try:
                        v = json.loads(s[start:i + 1])
                    except ValueError:
                        v = None
                    if isinstance(v, dict):
                        out.append(v)
                    start = None
    return out


def parse_json_array(raw: str):
    """応答からレコードの配列を取り出す。戻り値は (records, mode)。

    mode は記録用で、次の値を取る。
      strict  … 応答全体がそのままJSONだった
      prefix  … 先頭のJSONだけを読み、後ろの余分を捨てた
      salvage … 完結しているオブジェクトだけを拾った(途中で切れた応答)
      empty   … 応答が空
      fail    … 読み取れなかった
    records が空なら読み取れなかったということ。
    """
    s = _FENCE_RE.sub("", raw or "").strip()
    if not s:
        return [], "empty"

    try:
        recs = _as_records(json.loads(s))
        if recs:
            return recs, "strict"
    except ValueError:
        pass

    # 先頭の完全なJSON値だけを読む。後ろに何が付いていても無視する。
    dec = json.JSONDecoder()
    truncated_array = False
    for opener in ("[", "{"):
        i = s.find(opener)
        if i < 0:
            continue
        try:
            value, _ = dec.raw_decode(s, i)
        except ValueError:
            # 配列を開いたのに閉じられない＝応答が途中で切れている。
            truncated_array = truncated_array or opener == "["
            continue
        recs = _as_records(value)
        if not recs:
            continue
        if not truncated_array:
            return recs, "prefix"
        # 途中で切れた配列では、先頭の {…} を1件読んで打ち切ると、その後ろに
        # 完結して並んでいるオブジェクトを取りこぼす。実測: 6件バッチが2件目の
        # 途中で切れた応答から1件しか回収できず、残り5件が未判定になっていた。
        salvaged = _salvage_objects(s)
        if len(salvaged) > len(recs):
            return salvaged, "salvage"
        return recs, "prefix"

    recs = _salvage_objects(s)
    if recs:
        return recs, "salvage"
    return [], "fail"


def index_records(records: list, batch_size: int) -> dict:
    """レコードを index → レコード の辞書にする。

    index が欠けている、文字列になっている、といった応答が実測であった。
    1件だけの応答で index が無い場合は 0 とみなす(再判定は1件ずつ投げる
    ため、この形が出やすい)。

    件数がバッチと一致し、どのレコードにも index が無い場合は、出力順が
    入力順と同じだとみなして位置で対応づける。以前は batch_size == 1 の
    ときしか救えず、6件バッチで index を省いた「JSONとしては完全に正しい
    応答」が返ると6件とも未判定になっていた。判定の指示は必ず index を
    書かせているが、守られないことがある。
    """
    if (records and len(records) == batch_size
            and not any("index" in r for r in records)):
        return dict(enumerate(records))

    m = {}
    for r in records:
        if "index" not in r and len(records) == 1 and batch_size == 1:
            m[0] = r
            continue
        try:
            m[int(r["index"])] = r
        except (KeyError, TypeError, ValueError):
            continue
    return m
