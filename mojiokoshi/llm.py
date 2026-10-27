"""統合・校正に使う LLM(Groq・NVIDIA・Gemini。どれも OpenAI 互換の chat/completions)。

統合: 区間ごとの複数エンジンの候補を読み比べ、話された言葉を復元する。
校正: 統合した本文の句読点・誤変換・フィラー・段落を整える(内容は変えない)。
どちらも数区間ずつまとめて送り、<chunk id="番号">…</chunk> の形で受け取る。
"""

import json
import os
import re
import threading
import time

import config
import net

PROVIDERS = {
    "groq": "https://api.groq.com/openai/v1",
    "nvidia": "https://integrate.api.nvidia.com/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
}


class ModelUnavailable(Exception):
    """このモデルは今回の実行では使えない。"""


# ------------------------------------------
# モデル一覧と候補の解決
# ------------------------------------------
_models_lock = threading.Lock()
LIST_ERRORS = {}              # モデル一覧が取れなかったサービス → 理由


def list_models(provider, use_cache=True):
    """そのサービスで今使えるモデル名の集合(取れなければ None)。"""
    cache = os.path.join(config.WORK_DIR, "models_cache.json")
    with _models_lock:
        data = {}
        try:
            data = json.load(open(cache, encoding="utf-8"))
        except Exception:
            pass
        ent = data.get(provider)
        if use_cache and ent and time.time() - ent["t"] < config.MODELS_CACHE_HOURS * 3600:
            return set(ent["ids"])
        key = net.key(provider)
        if not key:
            return None
        if provider in LIST_ERRORS:            # この実行で取れなかったものは取り直さない
            return set(ent["ids"]) if ent else None
        print(f"    … {provider} のモデル一覧を取得中", flush=True)
        # 一覧は 20 秒で打ち切る(取れなければ前に取った一覧か、候補の先頭を使う)
        quick = dict(retries=1, timeout=20, max_wait=10, timeout_retries=0, what=f"{provider} のモデル一覧")
        try:
            if provider == "gemini":
                ids, token = [], ""
                for _ in range(10):
                    url = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000"
                    if token:
                        url += f"&pageToken={token}"
                    j = net.request_json("GET", url, headers={"x-goog-api-key": key}, **quick)
                    ids += [m["name"].removeprefix("models/") for m in j.get("models", [])]
                    token = j.get("nextPageToken")
                    if not token:
                        break
            else:
                j = net.request_json("GET", PROVIDERS[provider] + "/models",
                                     headers={"Authorization": f"Bearer {key}"}, **quick)
                ids = [m["id"] for m in j.get("data", [])]
        except (net.ApiError, KeyError, TypeError) as e:
            LIST_ERRORS[provider] = str(e)[:160]
            print(f"    … {provider} のモデル一覧が取れない — {str(e)[:100]}", flush=True)
            return set(ent["ids"]) if ent else None     # 古くても前に取った一覧を使う
        data[provider] = {"t": time.time(), "ids": ids}
        os.makedirs(config.WORK_DIR, exist_ok=True)
        tmp = cache + ".tmp"
        json.dump(data, open(tmp, "w", encoding="utf-8"))
        os.replace(tmp, cache)
        return set(ids)


def resolve(name, exclude=()):
    """LLMS の名前 → 使うモデルの設定(dict)。使えなければ ModelUnavailable。

    exclude は、実行中に使えないと分かったモデル(404・403)。次の候補を選ぶ。
    """
    cfg = config.LLMS.get(name)
    if cfg is None:
        raise ModelUnavailable(f"LLMS に {name} がありません")
    prov = cfg["provider"]
    if not net.key(prov):
        raise ModelUnavailable(f"{net.KEY_NAMES[prov]} がありません")
    ids = list_models(prov)
    model = None
    unverified = ids is None
    cands = [c for c in cfg["candidates"] if c not in exclude]
    if ids is None:
        model = cands[0] if cands else None   # 一覧が取れないときは先頭を試す
    else:
        for c in cands:
            if c in ids:
                model = c
                break
    if not model:
        raise ModelUnavailable(f"{prov} に候補のモデルがありません: {', '.join(cfg['candidates'])}")
    return dict(cfg, name=name, model=model, unverified=unverified)


# ------------------------------------------
# 問い合わせ
# ------------------------------------------
_no_extra = set()
_THINK_RE = re.compile(r"<think>.*?</think>", re.S)


def default_extra(provider, model):
    m = model.lower()
    if "gpt-oss" in m:
        return {"reasoning_effort": "low"}
    if provider == "groq" and "qwen" in m:
        return {"reasoning_effort": "none"}
    if provider == "nvidia" and any(x in m for x in ("nemotron", "qwen", "deepseek", "glm", "kimi")):
        return {"chat_template_kwargs": {"enable_thinking": False}}
    if provider == "gemini":
        return {"reasoning_effort": "low"}
    return {}


def chat(llm, system, user, max_tokens=16384):
    prov, model = llm["provider"], llm["model"]
    key = net.key(prov)
    body = {"model": model, "max_tokens": max_tokens,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
    if llm.get("temperature") is not None:
        body["temperature"] = llm["temperature"]
    extra = llm.get("extra")
    if extra is None:
        extra = default_extra(prov, model)
    if model not in _no_extra:
        body.update(extra)
    rpm = config.RPM[prov]
    lim = net.limiter("nvidia" if prov == "nvidia" else f"{prov}:{model}", rpm)
    url = PROVIDERS[prov] + "/chat/completions"
    hdr = {"Authorization": f"Bearer {key}"}
    j = None
    for _ in range(3):
        try:
            j = net.request_json("POST", url, body, headers=hdr, limit=lim, what=llm["name"])
            break
        except net.QuotaExhausted:
            raise
        except net.ApiError as e:
            low = (e.message or "").lower()
            if e.status == 400 and extra and model not in _no_extra and any(
                    k in low for k in ("reasoning", "chat_template", "thinking", "unrecognized", "unsupported", "extra")):
                _no_extra.add(model)
                for k in extra:
                    body.pop(k, None)
                continue
            if e.status == 400 and ("max_tokens" in low or "max_completion_tokens" in low):
                nums = [int(x) for x in re.findall(r"\b(\d{3,6})\b", low)]
                lim_tok = min([n for n in nums if n < body["max_tokens"]] or [body["max_tokens"] // 2])
                body["max_tokens"] = max(256, lim_tok)
                continue
            if e.status in (401, 403, 404):
                raise ModelUnavailable(str(e))
            raise
    if j is None:
        raise net.ApiError(400, "パラメータを外しても受け付けられなかった", llm["name"])
    try:
        ch = j["choices"][0]
        text = ch["message"].get("content") or ""
    except (KeyError, IndexError, TypeError):
        raise net.ApiError(200, f"応答の形が違う: {str(j)[:200]}", llm["name"])
    return _THINK_RE.sub("", text).strip(), ch.get("finish_reason")


_CHUNK_RE = re.compile(r'<chunk\s+id\s*=\s*["\']?(\d+)["\']?[^>]*>(.*?)</chunk>', re.S)


def parse_chunks(text):
    out = {}
    for m in _CHUNK_RE.finditer(text or ""):
        out[int(m.group(1))] = m.group(2).strip()
    return out


# ------------------------------------------
# 統合
# ------------------------------------------
MERGE_SYSTEM = """あなたは日本語の音声書き起こしの統合担当です。同じ音声区間を、仕組みの違う複数の音声認識エンジンが書き起こした候補(A, B, C…)を読み比べ、実際に話された言葉を復元します。録音の状態が悪く、どの候補にも誤りがあります。

守ること:
1. どの候補にも根拠の無い言葉を足さない。要約・言い換え・補完・推測による文の追加は一切しない。
2. 言葉を削らない。区間で話された発言はすべて書く。省略・要約・短縮をしない。出力の長さは、最も詳しい候補とおおむね同じになるはず。
3. 語の聞き取りが候補で違うときは、2つ以上の候補が一致するものを優先する。とくに「系統」の違う候補どうしの一致を信頼する。
4. 1つの候補にしか無い語句も、話の流れに合うなら残す(他の候補が聞き落としたことが多い)。消してよいのは次の 5 の典型的な幻覚だけ。迷ったら残して直後に〔?〕を付ける。
5. 音声認識の典型的な幻覚は消す: 動画の定型句(「ご視聴ありがとうございました」「チャンネル登録」「字幕」等)、同じ語句の不自然な繰り返し、他の候補にまったく無い長い文。注記で「外れ値」「多すぎる」とされた候補は特に疑う。
6. 候補が食い違い、どれが正しいか決めきれない語は、最も妥当なものを書いて直後に〔?〕を付ける。どの候補も聞き取れていない・意味をなさない所は〔聞き取れず〕と書く。迷ったら〔?〕を付ける。
7. 用語集の語は、音が合うときに限り用語集の表記にする。音が合わないのに用語集の語に置き換えない。
8. 句読点(、。?)を付ける。言い間違い・言い直し・フィラー(えー、あのー 等)も、候補にあれば残す(消すのは後の工程)。
9. 区間の境目で文が切れていてよい。区間をまたぐ言葉は、どちらか一方の区間に1回だけ書く。「前の文脈」「次の文脈」は参考で、出力には含めない。
10. 候補がすべて空、または意味のない雑音だけなら、その区間は空にする: <chunk id="番号"></chunk>

出力: 各区間を <chunk id="番号">本文</chunk> の形で、区間の順にすべて出力する。それ以外(説明・見出し・前置き)は書かない。"""


def build_merge_prompt(items, glossary_text):
    """items: [{"id", "time", "speech", "cands": [(label, text, note)], "notes": [..],
                "before": str, "after": str}]"""
    out = []
    if glossary_text:
        out.append("用語集:\n" + glossary_text + "\n")
    if items and items[0].get("before"):
        out.append(f"前の文脈(出力しない): …{items[0]['before']}\n")
    for it in items:
        out.append(f'<区間 id="{it["id"]}" 時刻="{it["time"]}" 声の割合="{it["speech"]}">')
        for label, text, note in it["cands"]:
            out.append(f"[{label}]{('(' + note + ')') if note else ''} {text if text else '(出力なし)'}")
        if it.get("notes"):
            out.append("注記: " + " ".join(it["notes"]))
        out.append("</区間>")
    if items and items[-1].get("after"):
        out.append(f"\n次の文脈(出力しない): {items[-1]['after']}…")
    ids = ", ".join(str(it["id"]) for it in items)
    out.append(f"\n区間 {ids} を、それぞれ <chunk id=\"番号\">…</chunk> で出力してください。")
    return "\n".join(out)


def out_tokens(chars, base):
    """出力に要るトークン数の見積もり(日本語は1字 1〜1.5 トークン。思考の分を base で足す)。"""
    return max(1024, min(16384, int(chars * 1.6) + base))


def merge(llm, items, glossary_text):
    prompt = build_merge_prompt(items, glossary_text)
    longest = sum(max((len(t) for _, t, _ in it["cands"]), default=0) for it in items)
    text, finish = chat(llm, MERGE_SYSTEM, prompt, max_tokens=out_tokens(longest, 1500))
    return parse_chunks(text), finish


# ------------------------------------------
# 校正
# ------------------------------------------
PROOF_SYSTEM_BASE = """あなたは日本語の書き起こし原稿の校正者です。次の原稿は録音の書き起こしで、区間ごとに <chunk id="番号"> で区切られています。読みやすく整えてください。

すること:
- 句読点を整える。明らかな誤変換(同音異義語・送り仮名・漢字の誤り)を直す。
- 用語集の表記にそろえる(音が同じときだけ)。
{filler}
- 区間の中で話題が変わる所に改行を入れてよい。

してはいけないこと:
- 内容の追加・削除・要約・言い換え・語順の入れ替え。意味が通らない所も、推測で直さない。
- 〔?〕〔聞き取れず〕の記号を消したり動かしたりすること(そのまま残す)。
- 話し言葉を書き言葉に直すこと(「〜っていうか」「〜じゃん」などの口調は残す)。
- 区間をまたいで文を動かすこと。

出力: 入力と同じ <chunk id="番号">…</chunk> の形で、全区間を順に出力する。それ以外は書かない。"""

FILLER_REMOVE = "- フィラー(えー、あー、あのー、えっと、うーん、まあ 等)と、語の途中の言いよどみ(「そ、そうだね」の「そ、」)だけを消す。それ以外の言葉は1語も消さない。"
FILLER_KEEP = "- フィラー(えー、あのー 等)や言い直しは消さずに残す。"


def proof_system():
    return PROOF_SYSTEM_BASE.format(filler=FILLER_REMOVE if config.FILLER_MODE == "remove" else FILLER_KEEP)


def build_proof_prompt(items, glossary_text):
    out = []
    if glossary_text:
        out.append("用語集:\n" + glossary_text + "\n")
    out.append("原稿:")
    for it in items:
        out.append(f'<chunk id="{it["id"]}">{it["text"]}</chunk>')
    return "\n".join(out)


def proof(llm, items, glossary_text):
    total = sum(len(it["text"]) for it in items)
    text, finish = chat(llm, proof_system(), build_proof_prompt(items, glossary_text),
                        max_tokens=out_tokens(total, 800))
    return parse_chunks(text), finish
