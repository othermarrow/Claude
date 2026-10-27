"""モデル調べ。サービスの一覧にあるモデルを全部、統合役として試して順位を付ける。

python mojiokoshi.py models                 Groq・NVIDIA・Gemini の全部
python mojiokoshi.py models nvidia          NVIDIA だけ
python mojiokoshi.py models nvidia --quick  応答するかだけ(採点しない)
python mojiokoshi.py models --apply         結果を設定に反映する(models_ranked.py)

試験問題は、録音の悪い会話を3つのエンジンが書き起こした、という作り物の2区間。
正解の文が決まっていて、エンジンごとに典型的な誤り(誤変換・句読点なし・聞き落とし・
無音で出る定型句)を入れてある。統合の結果を正解と比べて、
  一致   正解との一致(読みで比べる)
  残存   正解の内容のうち残った割合(削っていないか)
  追加   候補のどれにも無い言葉の割合(足していないか)
  定型句 「ご視聴ありがとうございました」を消したか
を測る。採点は1回だけの試験なので目安。結果は Output に「モデル調査_日時.md」で残る。
"""

import datetime
import json
import os
import threading
import time

import config
import llm
import net
import textproc as tp

REFERENCE = {
    1: "えー、今日は午後から散歩に行く予定です。雨が降ったら、室内で体操をしましょう。",
    2: "記録は毎日夕方までにつけてください。わからないことがあれば、主任に聞いてください。",
}
CANDS = {
    1: [("A", "今日は午後から散歩に行く予定です。雨が降ったら室内で体操をしましょう。ご視聴ありがとうございました", "系統1"),
        ("B", "えー今日は午後からさんぽに行く予定です雨が降ったら室内で体操しましょう", "系統1"),
        ("C", "えー、今日は午後から散歩に行く予定です。雨が振ったら、室内で退走をしましょう。", "系統2")],
    2: [("A", "記録は毎日夕方までにつけてください。わからないことがあれば主任に聞いてください。", "系統1"),
        ("B", "記録は毎日夕方までにつけてくださいわからないことがあれば手に聞いてください", "系統1"),
        ("C", "記録は毎日夕方までに付けてください。", "系統2")],
}
GLOSSARY = "- 主任"
RANKED_FILE = os.path.expanduser("~/.config/mojiokoshi/models_ranked.py")

# 文字起こしの統合に使えないと分かっている種類(一覧には出るが、会話の文を返さない)
_GEMINI_SKIP = ("embedding", "imagen", "veo", "tts", "native-audio", "live", "transcribe", "image",
                "aqa", "learnlm", "robotics", "computer-use")
_GROQ_SKIP = ("whisper", "tts", "guard", "playai", "orpheus", "distil")


def _items():
    out = []
    for cid, cands in CANDS.items():
        out.append({"id": cid, "time": f"00:00:{(cid - 1) * 30:02d}–00:00:{cid * 30:02d}", "speech": "80%",
                    "cands": cands, "notes": [], "before": "", "after": ""})
    return out


def list_all(provider):
    """そのサービスの一覧(統合に使えない種類は除く)。"""
    key = net.key(provider)
    if not key:
        return None, f"{net.KEY_NAMES[provider]} がありません"
    try:
        if provider == "gemini":
            ids, token = [], ""
            for _ in range(10):
                url = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000"
                if token:
                    url += f"&pageToken={token}"
                j = net.request_json("GET", url, headers={"x-goog-api-key": key}, retries=1, timeout=30,
                                     max_wait=10, timeout_retries=0, what="gemini のモデル一覧")
                for m in j.get("models", []):
                    name = m["name"].removeprefix("models/")
                    if ("generateContent" in (m.get("supportedGenerationMethods") or [])
                            and not any(s in name for s in _GEMINI_SKIP)):
                        ids.append(name)
                token = j.get("nextPageToken")
                if not token:
                    break
        else:
            j = net.request_json("GET", llm.PROVIDERS[provider] + "/models",
                                 headers={"Authorization": f"Bearer {key}"}, retries=1, timeout=30,
                                 max_wait=10, timeout_retries=0, what=f"{provider} のモデル一覧")
            ids = [m["id"] for m in j.get("data", [])]
            if provider == "groq":
                ids = [i for i in ids if not any(s in i for s in _GROQ_SKIP)]
    except net.ApiError as e:
        return None, str(e)[:150]
    return sorted(set(ids)), ""


class _limits:
    """調べる間は、待ち時間を短くし、送り直しを減らす。"""
    NAMES = {"REQUEST_TIMEOUT": 120, "MAX_RETRIES": 1, "MAX_WAIT_SEC": 60, "TIMEOUT_RETRIES": 0}

    def __enter__(self):
        self.old = {k: getattr(config, k) for k in self.NAMES}
        for k, v in self.NAMES.items():
            setattr(config, k, v)

    def __exit__(self, *a):
        for k, v in self.old.items():
            setattr(config, k, v)


def score(got):
    """統合の結果(区間 id → 文)を正解と比べる。"""
    sims, keeps, adds, fixed = [], [], [], True
    for cid, ref in REFERENCE.items():
        out = got.get(cid, "")
        rn, on = tp.norm(ref), tp.norm(tp.strip_marks(out))
        cn = [tp.norm(t) for _, t, _ in CANDS[cid]]
        sims.append(tp.ratio(rn, on))
        keeps.append(tp.coverage(rn, [on], 3))
        adds.append(1 - tp.coverage(on, cn, 3) if on else 0.0)
        if "視聴" in out:
            fixed = False
    sim, keep, add = sum(sims) / len(sims), sum(keeps) / len(keeps), sum(adds) / len(adds)
    total = sim - (0.0 if fixed else 0.15) - max(0.0, add - 0.05)
    return {"一致": round(sim, 3), "残存": round(keep, 3), "追加": round(add, 3),
            "定型句": "消した" if fixed else "残した", "点": round(total, 3)}


def probe(provider, model, quick):
    m = {"provider": provider, "model": model, "name": model, "extra": None,
         "temperature": None if provider == "gemini" else 0.0}
    row = {"provider": provider, "model": model}
    t0 = time.time()
    try:
        with _limits():
            if quick:
                llm.chat(m, "短く答える。", "「はい」とだけ答えてください。", max_tokens=300)
                row.update(状態="応答あり")
            else:
                got, finish = llm.merge(m, _items(), GLOSSARY)
                row.update(状態="応答あり" if got else "形式が違う")
                row.update(score(got))
                row["出力"] = {k: v[:80] for k, v in got.items()}
    except llm.ModelUnavailable as e:
        row.update(状態="使えない", 理由=str(e)[:120])
    except net.QuotaExhausted as e:
        row.update(状態="上限", 理由=str(e)[:120])
    except net.NoResponse as e:
        row.update(状態="応答なし", 理由=str(e)[:120])
    except net.ApiError as e:
        row.update(状態="エラー", 理由=str(e)[:120])
    row["秒"] = round(time.time() - t0, 1)
    return row


def good(r):
    return (r.get("状態") == "応答あり" and r.get("点", 0) >= 0.85 and r.get("残存", 0) >= 0.9
            and r.get("定型句") == "消した")


def run(providers, quick=False, apply=False, workers=3):
    providers = providers or ["nvidia", "groq", "gemini"]
    rows, lock = [], threading.Lock()
    for prov in providers:
        ids, err = list_all(prov)
        if ids is None:
            print(f"✗ {prov}: 一覧が取れない — {err}", flush=True)
            continue
        print(f"\n[{prov}] {len(ids)} 個を調べます(同時に {workers} 個まで。1 個あたり最長 2 分)", flush=True)
        todo = list(ids)

        def worker():
            while True:
                with lock:
                    if not todo:
                        return
                    model = todo.pop(0)
                r = probe(prov, model, quick)
                with lock:
                    rows.append(r)
                    n = sum(1 for x in rows if x["provider"] == prov)
                    mark = "✓" if r["状態"] == "応答あり" else "✗"
                    extra = (f" 点 {r['点']:.2f}・残存 {r['残存']:.0%}・定型句を{r['定型句']}" if "点" in r
                             else f" {r.get('理由', '')[:60]}")
                    print(f"  [{n}/{len(ids)}] {mark} {model}({r['秒']}秒){extra}", flush=True)
        ts = [threading.Thread(target=worker, daemon=True) for _ in range(workers)]
        for t in ts:
            t.start()
        for t in ts:
            while t.is_alive():
                t.join(0.5)
    path = write_report(rows, quick)
    print(f"\n書き出しました: {path}", flush=True)
    if not quick:
        snippet = ranked_config(rows)
        if apply and snippet:
            os.makedirs(os.path.dirname(RANKED_FILE), exist_ok=True)
            with open(RANKED_FILE, "w", encoding="utf-8") as f:
                f.write(snippet)
            print(f"設定に反映しました: {RANKED_FILE}", flush=True)
            if os.path.exists(config.LOCAL_CONFIG):
                print(f"(注意) {config.LOCAL_CONFIG} があると、そちらの MERGE_MODELS などが優先されます", flush=True)
        elif snippet:
            print("この順位を使うには: python ~/mojiokoshi/mojiokoshi.py models --apply(調べ直してから反映する)",
                  flush=True)
    return rows


def write_report(rows, quick):
    os.makedirs(config.OUTPUT_DIR, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M")
    path = os.path.join(config.OUTPUT_DIR, f"モデル調査_{stamp}.md")
    ok = sorted([r for r in rows if "点" in r], key=lambda r: -r["点"])
    rest = sorted([r for r in rows if "点" not in r], key=lambda r: (r["provider"], r["状態"], r["model"]))
    lines = [f"# モデル調査 {stamp}", "",
             "応答するかだけを見た結果。" if quick else
             "統合役の試験(作り物の2区間)の結果。点 = 正解との一致 − 定型句を残した罰 − 足した言葉の罰。"
             "◎ は点 0.85 以上・残存 90% 以上・定型句を消したもの。1回だけの試験なので目安。", ""]
    if ok:
        lines += ["| | サービス | モデル | 点 | 一致 | 残存 | 追加 | 定型句 | 秒 |", "|---|---|---|---|---|---|---|---|---|"]
        for r in ok:
            lines.append(f"| {'◎' if good(r) else ''} | {r['provider']} | {r['model']} | {r['点']:.2f} | {r['一致']:.2f} | "
                         f"{r['残存']:.0%} | {r['追加']:.0%} | {r['定型句']} | {r['秒']} |")
        lines.append("")
    if quick:
        lines += ["| サービス | モデル | 状態 | 秒 | 理由 |", "|---|---|---|---|---|"]
        for r in sorted(rows, key=lambda r: (r["provider"], r["状態"] != "応答あり", r["model"])):
            lines.append(f"| {r['provider']} | {r['model']} | {r['状態']} | {r['秒']} | {r.get('理由', '')} |")
    elif rest:
        lines += ["## 使えなかったもの", "", "| サービス | モデル | 状態 | 理由 |", "|---|---|---|---|"]
        for r in rest:
            lines.append(f"| {r['provider']} | {r['model']} | {r['状態']} | {r.get('理由', '')} |")
    if ok:
        lines += ["", "## 統合の出力(先頭 80 字)", ""]
        for r in ok:
            lines.append(f"- **{r['model']}**: " + " / ".join(r.get("出力", {}).values()))
        snippet = ranked_config(rows)
        if snippet:
            lines += ["", "## この順位を使う設定(models --apply で書き出す内容)", "", "```python", snippet.rstrip(), "```"]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    json.dump(rows, open(os.path.join(config.WORK_DIR, "bench_results.json"), "w", encoding="utf-8"),
              ensure_ascii=False)
    return path


def ranked_config(rows):
    """◎ のモデルを、サービスごとに点の順に並べた設定(config.py が読み込む)。"""
    by = {}
    for r in sorted([r for r in rows if good(r)], key=lambda r: -r["点"]):
        by.setdefault(r["provider"], []).append(r["model"])
    if not by:
        return ""
    out = ["# models --apply で書き出した設定(モデル調べの ◎ を点の順に)。消せば既定に戻る。",
           f"# {datetime.datetime.now():%Y-%m-%d %H:%M}"]
    slots = []
    for prov in ("nvidia", "groq", "gemini"):
        ms = by.get(prov, [])
        if not ms:
            continue
        batch = {"nvidia": 4, "groq": 2, "gemini": 8}[prov]
        temp = "None" if prov == "gemini" else "0.0"
        out.append(f'LLMS["{prov}-1"] = dict(provider="{prov}", batch={batch}, temperature={temp}, extra=None, '
                   f'candidates={ms!r})')
        slots.append(f"{prov}-1")
        if len(ms) >= 2 and prov != "gemini":
            out.append(f'LLMS["{prov}-2"] = dict(provider="{prov}", batch={batch}, temperature={temp}, extra=None, '
                       f'candidates={ms[1:]!r})')
            slots.append(f"{prov}-2")
    out.append(f"MERGE_MODELS = {slots[:5]!r}")
    out.append(f"PROOF_MODELS = {slots!r} + [\"gemini-lite\"]")
    return "\n".join(out) + "\n"
