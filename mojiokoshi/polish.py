"""読みやすく整える(txt。--no-polish で切る)。

LLM(NVIDIA API のチャット)に、次の3つだけを前後の文脈から直させる。
  - 聞き間違い・変換ミス(音の近い別の言葉や漢字になっている所)
  - 句読点
  - 音声認識が紛れ込ませた定型句(文脈に合わない「ありがとうございました」など)
方言・話し言葉・言いよどみは標準語に直させない。

同じ区間を条件を変えて認識した結果(A: 元の音声、B: 雑音を除いた音声 など)が
あれば一緒に渡し、食い違う所は文脈と日本語として自然な方を選ばせる。複数の
認識結果を LLM に突き合わせさせると、1つだけを直させるより誤りが減ることが
知られている(生成的誤り訂正。N-best の仮説を LLM に渡す方法)。

言葉を足したり要約したりさせないよう、次の2つで守る。
  - 指示で、足す・削る・言い換える・推測で埋めることを禁じる
  - 直した行が、渡したどの認識結果とも似ていなければ(POLISH_MIN_SIMILARITY 未満)、
    元の行(A)を使う

返答は JSON で受け取る(NVIDIA の構造化出力 nvext.guided_json で形を強制する。
research_bot と同じ方法)。受け付けないモデルでは外して送り直し、読めない返答は
作業フォルダに残して知らせる。実際の録音で、行番号つきの文で返させていたときに
1区間も直らなかった(返答の形が読めなかったとみられる)ため、こうした。

research_bot での同じ API の実測から、次の3つも入れてある。
  - 行の数をプロンプトの末尾で明示する(nemotron-3-super は数の明示が無いと、
    最後の1件を書かずに配列を閉じた)
  - 時間切れが続いたら、そのモデルをあきらめて次のモデルにする(応答しなくなる
    モデルがあった)
  - 思考を止める指定を受け付けないモデルでは、外して送り直す

句読点は「必ずすること」として頼む。実際の録音で、句読点を「直してよいこと」の
1つとして並べていたときは、ultra が句読点の無い行をほぼそのまま返した
(10区間のうち直ったのは、2回目の認識を取り入れた2区間だけだった)。
それでも句読点の無い行が残れば、句読点を付けることだけを別に頼み、句読点の
ほかに1文字でも変わった返答は使わない。
"""

import json
import os
import random
import re
import time
import urllib.error
import urllib.request

import textfilter

PROMPT = """以下は、物音の多い場所で録音した日本語の会話を、音声認識(Whisper)で文字にしたものです。
{context}「対象」の各行を、読みやすい文字起こしに整えてください。「前」「後」は前後の部分で、直さずに文脈として使ってください。
{hyp_note}
必ずすること:
- すべての行に句読点を付ける。文の終わりに「。」(問いかけは「？」)、意味の切れ目に「、」。
  意味のはっきりしない行でも、言葉の切れ目に付ける
  例: 「えーと今日の予定なんですけど午前中は買い物に行きます」
      →「えーと、今日の予定なんですけど、午前中は買い物に行きます。」

確かなときだけすること:
- 聞き間違い・変換ミス(音の近い別の言葉や漢字になっている所)を直す。前後の文脈から、本来の言葉が確かに分かるものだけ
  例: 会議を振り返る話の中の「反戦会」→「反省会」
- 音声認識が紛れ込ませた定型句(文脈に合わない「ありがとうございました」「ご視聴ありがとうございました」など)を取り除く

してはいけないこと:
- 方言・話し言葉・言いよどみ(「えー」「あの」「〜やんか」「〜へん」など)を標準語に直す。そのまま残す
- 言葉を足す、要約する、言い換える
- 意味の分からない部分を推測で埋める(分からない言葉はそのまま残し、句読点だけ付ける)
- 行をまとめる、分ける、順番を変える
{glossary}
出力は JSON だけ: {{"lines": [{{"n": 番号, "text": "整えた文"}}, ...]}}
"""

PUNCT_PROMPT = """以下は、日本語の会話を音声認識で文字にしたものです。「対象」の各行に、句読点だけを付けてください。
- 文の終わりに「。」(問いかけは「？」)、意味の切れ目に「、」を付ける
- 意味のはっきりしない行でも、言葉の切れ目に付ける
- 句読点を入れる以外は、1文字も変えない・足さない・消さない
出力は JSON だけ: {{"lines": [{{"n": 番号, "text": "句読点を付けた文"}}, ...]}}
"""

COUNT_NOTE = """
「対象」は全部で {n} 行(番号 1〜{n})です。lines には {n} 個すべてを番号順に入れてください。
"""

HYP_NOTE = """「対象」の行には、同じ音声を条件を変えて認識した結果が A・B… として並んでいます
(A: 元の音声、B: 雑音を除いた音声 など)。A を基本に、食い違う所は前後の文脈から日本語として
自然な方を選んで1つの文にしてください。B が意味の通らない文のときは A を使ってください。
どの結果にも無い内容は足さないでください(音の近い言葉への聞き間違いの直しは、下の決まりのとおりしてよい)。
"""

SCHEMA = {
    "type": "object",
    "properties": {
        "lines": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"n": {"type": "integer"}, "text": {"type": "string"}},
                "required": ["n", "text"],
            },
        }
    },
    "required": ["lines"],
}


class PolishError(Exception):
    pass


def load_glossary(path):
    """よく出る言葉・人名(1行に1つ。# で始まる行は無視)。"""
    words = []
    try:
        with open(os.path.expanduser(path), encoding="utf-8") as f:
            for line in f:
                w = line.strip()
                if w and not w.startswith("#"):
                    words.append(w)
    except OSError:
        pass
    return words


_no_guided = set()      # guided_json を受け付けなかったモデル
_no_think = set()       # 思考を止める指定を受け付けなかったモデル
MAX_TIMEOUTS = 2        # 時間切れがこの回数続いたら、そのモデルをあきらめる
_THINK_HINTS = ("chat_template_kwargs", "enable_thinking", "reasoning_effort")


def _timed_out(e):
    reason = getattr(e, "reason", None)
    return (isinstance(e, TimeoutError) or isinstance(reason, TimeoutError)
            or "timed out" in str(e).lower())


def _chat(base_url, api_key, model, prompt, timeout=240, retries=4, log=print):
    use_guided = model not in _no_guided
    use_think = model not in _no_think
    last = ""
    attempt = 0
    timeouts = 0
    while attempt <= retries:
        body = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.0,
            "max_tokens": 8192,
        }
        # 思考を止める(research_bot での実測: Nemotron 等は chat_template_kwargs で止まり、
        # gpt-oss は止まらないので reasoning_effort で少なくする)
        if use_think and "gpt-oss" in model:
            body["reasoning_effort"] = "low"
        elif use_think:
            body["chat_template_kwargs"] = {"enable_thinking": False}
        if use_guided:
            body["nvext"] = {"guided_json": SCHEMA}
        req = urllib.request.Request(
            base_url.rstrip("/") + "/chat/completions", data=json.dumps(body).encode("utf-8"),
            headers={"Authorization": f"Bearer {api_key}",
                     "Content-Type": "application/json", "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                resp = json.loads(r.read().decode("utf-8"))
            msg = resp["choices"][0]["message"]
            text = msg.get("content") or ""
            return re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            last = f"HTTP {e.code}: {detail}"
            low = detail.lower()
            if use_think and e.code in (400, 404, 422) and any(k in low for k in _THINK_HINTS):
                # 思考を止める指定を受け付けないモデル → 外して送り直す(試行回数は使わない)
                _no_think.add(model)
                use_think = False
                log(f"  [整形] {model} は思考を止める指定を受け付けないため、外して送り直します")
                continue
            if use_guided and (e.code in (400, 422) or "guided" in low or "nvext" in low):
                # 構造化出力を受け付けないモデル → 外して送り直す(試行回数は使わない)
                _no_guided.add(model)
                use_guided = False
                log(f"  [整形] {model} は JSON の形の指定を受け付けないため、外して送り直します")
                continue
            if e.code in (400, 401, 403, 404, 422):
                raise PolishError(last)
            timeouts = 0
        except (urllib.error.URLError, OSError, ValueError, KeyError, IndexError) as e:
            last = f"{type(e).__name__}: {e}"
            if _timed_out(e):
                # 同じ条件で送り直しても同じになりやすい。続いたら次のモデルへ
                timeouts += 1
                if timeouts >= MAX_TIMEOUTS:
                    raise PolishError(f"{timeout:.0f}秒以内に応答がない状態が{timeouts}回続きました")
                log(f"  [整形] {model} から{timeout:.0f}秒以内に応答がありませんでした。もう一度送ります")
            else:
                timeouts = 0
        attempt += 1
        if attempt <= retries:
            time.sleep(min(60.0, 4.0 * (2 ** (attempt - 1))) * (0.8 + 0.4 * random.random()))
    raise PolishError(f"再試行を使い切りました({last})")


_FENCE = re.compile(r"^```[a-zA-Z]*\s*|\s*```$", re.M)


def parse_reply(text, n):
    """返答から {行の番号(0始まり): 文} を取り出す。JSON を優先し、だめなら行の形で読む。"""
    s = _FENCE.sub("", text or "").strip()
    out = {}
    recs = None
    try:
        v = json.loads(s)
        recs = v.get("lines") if isinstance(v, dict) else v
    except ValueError:
        i = s.find("{")
        if i >= 0:
            try:
                v, _ = json.JSONDecoder().raw_decode(s, i)
                recs = v.get("lines") if isinstance(v, dict) else None
            except ValueError:
                recs = None
        if recs is None:
            # 途中で切れた返答から、閉じている {"n":…,"text":…} だけを拾う
            recs = []
            for m in re.finditer(r'\{\s*"n"\s*:\s*(\d+)\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}', s):
                try:
                    recs.append({"n": int(m.group(1)), "text": json.loads(f'"{m.group(2)}"')})
                except ValueError:
                    continue
    if isinstance(recs, list) and recs:
        with_n = [r for r in recs if isinstance(r, dict) and isinstance(r.get("text"), str)]
        has_n = all(isinstance(r.get("n"), int) for r in with_n)
        for k, r in enumerate(with_n):
            i = (r["n"] - 1) if has_n else k
            if 0 <= i < n and i not in out:
                out[i] = r["text"].strip()
        if out:
            return out
    # 行の形(「番号<TAB>文」「番号. 文」「番号 文」)
    for line in s.splitlines():
        m = re.match(r"^\s*(?:対象\s*)?(\d+)\s*(?:[\t:：.、)）]\s*|\s+)(.+)$", line)
        if not m:
            continue
        i = int(m.group(1)) - 1
        if 0 <= i < n and i not in out:
            out[i] = m.group(2).strip()
    return out


def build_prompt(chunk, before=(), after=(), context="", glossary=(), alts=None):
    """chunk: 直す行。alts: 行ごとの別の認識結果のリスト(無ければ None)。"""
    ctx = f"録音の場面: {context}\n" if context else ""
    glo = ""
    if glossary:
        glo = ("\nこの録音に出てきうる言葉・人名(聞き間違いを直すときの手がかり。"
               "無理に当てはめない): " + "、".join(glossary) + "\n")
    has_alt = bool(alts) and any(a for a in alts)
    prompt = PROMPT.format(context=ctx, glossary=glo,
                           hyp_note=HYP_NOTE if has_alt else "") + "\n"
    for c in before:
        prompt += f"前\t{c}\n"
    for i, c in enumerate(chunk):
        if has_alt:
            prompt += f"対象 {i + 1}\tA: {c}\n"
            for k, a in enumerate(alts[i] or [], 1):
                prompt += f"\t{chr(ord('A') + k)}: {a or '(なし)'}\n"
        else:
            prompt += f"対象 {i + 1}\t{c}\n"
    for c in after:
        prompt += f"後\t{c}\n"
    return prompt + COUNT_NOTE.format(n=len(chunk))


_END_MARK = re.compile(r"[。．.！？!?…」』)）]\s*$")
_COMMA = re.compile(r"[、，,]")
_SENT_SPLIT = re.compile(r"(?<=[。．！？!?])")
_DOUBLE = re.compile(r"([。、！？])\1+")
_COMMA_END = re.compile(r"、+(?=[。！？])")


def needs_punct(text):
    """句読点が足りない行か(終わりに句点などが無い・読点の無い長い文がある)。"""
    if len(textfilter.core(text)) < 4:
        return False
    if not _END_MARK.search(text):
        return True
    return any(len(textfilter.core(x)) >= 25 and not _COMMA.search(x)
               for x in _SENT_SPLIT.split(text))


def tidy(text):
    """返答に混ざりやすい「。。」「、。」をまとめる。"""
    return _COMMA_END.sub("", _DOUBLE.sub(r"\1", text.strip()))


def build_punct_prompt(chunk):
    prompt = PUNCT_PROMPT + "\n"
    for i, c in enumerate(chunk):
        prompt += f"対象 {i + 1}\t{c}\n"
    return prompt + COUNT_NOTE.format(n=len(chunk))


def _keep_reply(raw_dir, name, reply):
    if not raw_dir:
        return
    try:
        os.makedirs(raw_dir, exist_ok=True)
        with open(os.path.join(raw_dir, name), "w", encoding="utf-8") as f:
            f.write(reply)
    except OSError:
        pass


def polish_lines(lines, api_key, base_url, models, batch=40, min_sim=0.6,
                 context="", glossary=(), alts=None, raw_dir="", log=print):
    """lines(文字列のリスト)を直したリストと、直した行の数と、使ったモデルを返す。

    alts: 行ごとの別の認識結果のリスト(lines と同じ長さ。無ければ None)。
    raw_dir: 読めなかった返答を残すフォルダ。
    使ったモデルは、聞き間違いなどを直す段で返答を受け取れた最後のモデル
    (1つも受け取れなければ空)。
    """
    result = list(lines)
    model_iter = list(models)
    current = 0
    answered = ""

    def ask(prompt):
        nonlocal current, answered
        while current < len(model_iter):
            try:
                reply = _chat(base_url, api_key, model_iter[current], prompt, log=log)
                answered = model_iter[current]
                return reply
            except PolishError as e:
                log(f"  [整形] {model_iter[current]} が使えませんでした({str(e)[:120]})")
                current += 1
        log("  [整形] 使えるモデルがないため、残りは元のままにします。")
        return None

    def read(reply, n, name):
        fixed = parse_reply(reply, n)
        if len(fixed) < n / 2:
            _keep_reply(raw_dir, name, reply)
            log(f"  [整形] 返答のうち読めたのは {len(fixed)}/{n} 行でした"
                + (f"(返答は {raw_dir} に残しました)" if raw_dir else ""))
        return fixed

    for b0 in range(0, len(lines), batch):
        chunk = lines[b0:b0 + batch]
        calts = alts[b0:b0 + batch] if alts else None
        prompt = build_prompt(chunk, lines[max(0, b0 - 8):b0], lines[b0 + batch:b0 + batch + 4],
                              context, glossary, calts)
        reply = ask(prompt)
        if reply is None:
            break
        for i, new in read(reply, len(chunk), f"polish_reply_{b0 // batch + 1}.txt").items():
            new = tidy(new)
            old = chunk[i]
            if not new or new == old:
                continue
            refs = [old] + [a for a in ((calts[i] if calts else None) or []) if a]
            best = max(textfilter.similarity(textfilter.core(r), textfilter.core(new)) for r in refs)
            if best < min_sim:
                continue
            result[b0 + i] = new
        log(f"  [整形] {min(b0 + batch, len(lines))}/{len(lines)} 行")

    used = answered

    # 句読点がまだ足りない行は、句読点を付けることだけを頼む。句読点のほかに
    # 1文字でも変わった行は使わない
    todo = [i for i, t in enumerate(result) if needs_punct(t)] if used else []
    if todo:
        log(f"  [整形] 句読点の足りない {len(todo)}行に、句読点だけを付けます")
    for b0 in range(0, len(todo), batch):
        part = todo[b0:b0 + batch]
        chunk = [result[i] for i in part]
        reply = ask(build_punct_prompt(chunk))
        if reply is None:
            break
        for k, new in read(reply, len(chunk), f"punct_reply_{b0 // batch + 1}.txt").items():
            new = tidy(new)
            if new and new != chunk[k] and textfilter.core(new) == textfilter.core(chunk[k]):
                result[part[k]] = new
    changed = sum(1 for a, b in zip(lines, result) if a != b)
    return result, changed, used
