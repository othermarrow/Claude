"""読みやすく整える(txt。--no-polish で切る)。

LLM(NVIDIA API のチャット)に、次の3つだけを前後の文脈から直させる。
  - 聞き間違い・変換ミス(音の近い別の言葉や漢字になっている所)
  - 句読点
  - 音声認識が紛れ込ませた定型句(文脈に合わない「ありがとうございました」など)
方言・話し言葉・言いよどみは標準語に直させない。

区間ごとに別々に認識しているため、前後を聞けば分かる言葉の取り違えが残りやすい
(実際の録音で「反省会」が「反戦会」になっていた)。それを文脈から直すのが目的。

言葉を足したり要約したりさせないよう、次の2つで守る。
  - 指示で、足す・削る・言い換える・推測で埋めることを禁じる
  - 直した行が元の行と似ていなければ(POLISH_MIN_SIMILARITY 未満)、元の行を使う
元の認識結果は .md にそのまま残る。
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
{context}行の先頭の数字は行番号です。「前」「後」で始まる行は前後の部分で、直さずに文脈として使ってください。

直してよいのは次の3つだけです。
- 聞き間違い・変換ミス(音の近い別の言葉や漢字になっている所)。前後の文脈から、本来の言葉が確かに分かるものだけ
  例: 会議を振り返る話の中の「反戦会」→「反省会」
- 句読点の位置と有無
- 音声認識が紛れ込ませた定型句(文脈に合わない「ありがとうございました」「ご視聴ありがとうございました」など)を取り除く

してはいけないこと:
- 方言・話し言葉・言いよどみ(「えー」「あの」「〜やんか」「〜へん」など)を標準語に直す。そのまま残す
- 言葉を足す、要約する、言い換える
- 意味の分からない部分を推測で埋める(分からない部分はそのまま残す)
- 行をまとめる、分ける、順番を変える
{glossary}
出力の形: 番号の付いた行と同じ数の行を「番号<TAB>直した文」の形で出力し、
ほかの説明は書かないでください。直す所がない行もそのまま出力してください。
"""


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


def _chat(base_url, api_key, model, prompt, timeout=240, retries=4, log=print):
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.0,
        "max_tokens": 8192,
    }
    # 思考を止める(research_bot での実測: Nemotron 等は chat_template_kwargs で止まり、
    # gpt-oss は止まらないので reasoning_effort で少なくする)
    if "gpt-oss" in model:
        body["reasoning_effort"] = "low"
    else:
        body["chat_template_kwargs"] = {"enable_thinking": False}
    data = json.dumps(body).encode("utf-8")
    last = ""
    for attempt in range(retries + 1):
        req = urllib.request.Request(
            base_url.rstrip("/") + "/chat/completions", data=data,
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
            if e.code in (400, 401, 403, 404, 422):
                raise PolishError(last)
        except (urllib.error.URLError, OSError, ValueError, KeyError, IndexError) as e:
            last = f"{type(e).__name__}: {e}"
        if attempt < retries:
            time.sleep(min(60.0, 4.0 * (2 ** attempt)) * (0.8 + 0.4 * random.random()))
    raise PolishError(f"再試行を使い切りました({last})")


def _parse(text, n):
    out = {}
    for line in text.splitlines():
        m = re.match(r"^\s*(\d+)\s*(?:\t|[:：.、)）]|\s{2,})\s*(.*)$", line)
        if not m:
            continue
        i = int(m.group(1)) - 1
        if 0 <= i < n and i not in out:
            out[i] = m.group(2).strip()
    return out


def build_prompt(chunk, before=(), after=(), context="", glossary=()):
    ctx = f"録音の場面: {context}\n" if context else ""
    glo = ""
    if glossary:
        glo = ("\nこの録音に出てきうる言葉・人名(聞き間違いを直すときの手がかり。"
               "無理に当てはめない): " + "、".join(glossary) + "\n")
    prompt = PROMPT.format(context=ctx, glossary=glo) + "\n"
    for c in before:
        prompt += f"前\t{c}\n"
    for i, c in enumerate(chunk, 1):
        prompt += f"{i}\t{c}\n"
    for c in after:
        prompt += f"後\t{c}\n"
    return prompt


def polish_lines(lines, api_key, base_url, models, batch=40, min_sim=0.6,
                 context="", glossary=(), log=print):
    """lines(文字列のリスト)を直したリストと、直した行の数と、使ったモデルを返す。"""
    result = list(lines)
    changed = 0
    model_iter = list(models)
    current = 0
    for b0 in range(0, len(lines), batch):
        chunk = lines[b0:b0 + batch]
        prompt = build_prompt(chunk, lines[max(0, b0 - 8):b0], lines[b0 + batch:b0 + batch + 4],
                              context, glossary)
        reply = None
        while current < len(model_iter):
            try:
                reply = _chat(base_url, api_key, model_iter[current], prompt, log=log)
                break
            except PolishError as e:
                log(f"  [整形] {model_iter[current]} が使えませんでした({str(e)[:120]})")
                current += 1
        if reply is None:
            log("  [整形] 使えるモデルがないため、残りは元のままにします。")
            break
        fixed = _parse(reply, len(chunk))
        for i, new in fixed.items():
            old = chunk[i]
            if not new or new == old:
                continue
            if textfilter.similarity(textfilter.core(old), textfilter.core(new)) < min_sim:
                continue
            result[b0 + i] = new
            changed += 1
        log(f"  [整形] {min(b0 + batch, len(lines))}/{len(lines)} 行")
    return result, changed, (model_iter[current] if current < len(model_iter) else "")
