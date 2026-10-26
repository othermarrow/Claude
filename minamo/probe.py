"""ミナモ：AI の一括チェック。

候補の AI（PROBE_MODELS）に、同じ短い面接の一場面を同時に送り、
返事の速さと的確さ（日本語・敬語・長さ・書式・話を聞いているか）を調べる。
合格したものを速い順に並べて返す。サーバー（と CUI 版）の起動時に使う。

単独でも動かせる（面接は始めず、結果の表だけ出す）：
  python ~/Claude/minamo/probe.py
"""

import json
import os
import re
import sys
import threading
import time

import minamo

CACHE = os.path.expanduser("~/.cache/minamo/probe.json")

# 試しに送る場面：解釈の段階の 5 回目。観測メモつき
TEST_CONTENTS = [
    {"role": "user", "parts": [{"text":
        "【観測メモ】\n- 面接段階: 導入（1/4）、1回目\n- 面接が始まった。最初のあいさつをすること。"}]},
    {"role": "model", "parts": [{"text": "こんばんは。ミナモです。[間] 今日は、どんなことをお話ししましょうか。"}]},
    {"role": "user", "parts": [{"text":
        "最近、夜になると眠れなくて、仕事のことばかり考えてしまいます。\n\n"
        "【観測メモ】\n- 面接段階: 解釈（2/4）、5回目\n- 入力した文字数: 30\n"
        "- 書きかけて消した文字数: 12\n- 現在時刻: 02時13分（面接開始から9分）"}]},
]
# 話を聞いているか：相手の言葉のどれかに触れていること
TOPIC_WORDS = ["眠", "寝", "仕事", "夜", "考え", "消し", "書きかけ", "02時", "2時", "深夜"]


def grade(text):
    """返事を調べ、問題の一覧を返す（空なら合格）。"""
    if not text:
        return ["空の返事"]
    issues = []
    t = text.replace("[間]", "")
    jp = len(re.findall(r"[぀-ヿ㐀-鿿]", t))
    latin = len(re.findall(r"[A-Za-z]", t))
    if latin > max(6, jp * 0.08):
        issues.append("英語が混ざる")
    if re.search(r"(?m)^\s*([#*•\-]|\d+\.)\s", t) or "**" in t:
        issues.append("マークダウン")
    if re.search(r"</?think>|\b(reasoning|thinking|analysis)\b", text, re.I):
        issues.append("考えが漏れる")
    if "観測メモ" in t or "【" in t:
        issues.append("メモの書式を口にした")
    if not re.search(r"です|ます|ません|でしょう|ください", t):
        issues.append("敬語でない")
    sentences = len(re.findall(r"[。？！?!]", t))
    if not (2 <= sentences <= 7) or not (25 <= len(t) <= 420):
        issues.append(f"長さが外れる（{sentences}文・{len(t)}字）")
    if not any(w in t for w in TOPIC_WORDS):
        issues.append("話を聞いていない")
    return issues


def _make(backend, model, key, system):
    if backend == "gemini":
        return minamo.Gemini(key, model, system)
    llm = minamo.Nvidia(key, model, system)
    llm.candidates = [model]             # チェックでは代わりに切り替えない
    return llm


def candidates(backend=None):
    """キーのある API の候補だけを返す：[(backend, model, key)]。"""
    keys = {"nvidia": minamo.load_key("NVIDIA_API_KEY"), "gemini": minamo.load_key("GEMINI_API_KEY")}
    return [(b, m, keys[b]) for b, m in minamo.PROBE_MODELS
            if keys.get(b) and (not backend or b == backend)]


def run(backend=None, timeout=None, system=None, out=sys.stdout):
    """候補を同時に試す。結果を速い順（合格が先）に返す：
    [{"backend", "model", "sec", "ok", "why", "sample"}]。"""
    timeout = timeout or minamo.PROBE_TIMEOUT
    system = system or minamo.SYSTEM_PROMPT
    cands = candidates(backend)
    if not cands:
        return []
    results, lock, done = [], threading.Lock(), threading.Event()
    print(f"AI の一括チェック：{len(cands)} 個に同時に送ります（最大 {timeout} 秒）", file=out, flush=True)

    def one(b, m, key):
        t0 = time.monotonic()
        try:
            text = _make(b, m, key, system).ask(TEST_CONTENTS)
            sec = time.monotonic() - t0
            issues = grade(text)
            r = {"backend": b, "model": m, "sec": round(sec, 1), "ok": not issues,
                 "why": "・".join(issues), "sample": (text or "")[:120]}
        except minamo.Offline:
            r = {"backend": b, "model": m, "sec": None, "ok": False, "why": "つながらない", "sample": ""}
        except RuntimeError as e:
            code = str(e)[:8]
            why = {"HTTP 404": "見つからない", "HTTP 410": "提供終了", "HTTP 401": "キーが通らない",
                   "HTTP 403": "使えない（権限）", "HTTP 429": "混雑・回数制限"}.get(code, str(e)[:60])
            r = {"backend": b, "model": m, "sec": None, "ok": False, "why": why, "sample": ""}
        except Exception as e:           # 想定外の返り方でも、ほかのチェックは続ける
            r = {"backend": b, "model": m, "sec": None, "ok": False, "why": f"{type(e).__name__}: {e}"[:60], "sample": ""}
        with lock:
            if done.is_set():
                return                   # 締め切りのあとに届いたものは数えない
            results.append(r)
            print("  " + line(r), file=out, flush=True)
            if len(results) == len(cands):
                done.set()

    for b, m, key in cands:
        threading.Thread(target=one, args=(b, m, key), daemon=True).start()
    done.wait(timeout)
    with lock:
        done.set()
        answered = {(r["backend"], r["model"]) for r in results}
        for b, m, _ in cands:
            if (b, m) not in answered:
                r = {"backend": b, "model": m, "sec": None, "ok": False, "why": f"{timeout}秒で返事がない", "sample": ""}
                results.append(r)
                print("  " + line(r), file=out, flush=True)
    results.sort(key=lambda r: (not r["ok"], r["sec"] if r["sec"] is not None else 1e9))
    save(results)
    return results


def line(r):
    mark = "✓" if r["ok"] else ("△" if r["sec"] is not None else "×")
    sec = f"{r['sec']:5.1f}秒" if r["sec"] is not None else "   ── "
    return f"{mark} {sec}  {r['backend']:<6} {r['model']}" + ("" if r["ok"] else f"  （{r['why']}）")


def summary(results):
    ok = [r for r in results if r["ok"]]
    if ok:
        return f"→ いちばん速く的確だった {ok[0]['model']}（{ok[0]['sec']}秒）を使います。" + \
               (f"答えないときは {'・'.join(r['model'] for r in ok[1:3])} の順に替えます。" if len(ok) > 1 else "")
    if results and all(r["why"] == "つながらない" for r in results):
        return "→ どれにもつながりません（電波がない？）。いつもの設定のまま始め、つながらなければ端末内モデルで話します。"
    return "→ 合格した AI がありません。いつもの設定のまま始めます。"


def save(results):
    try:
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        with open(CACHE + ".tmp", "w", encoding="utf-8") as f:
            json.dump({"at": time.strftime("%Y-%m-%d %H:%M"), "results": results}, f, ensure_ascii=False, indent=1)
        os.replace(CACHE + ".tmp", CACHE)
    except OSError:
        pass


def main():
    import argparse
    ap = argparse.ArgumentParser(description="ミナモで使う AI を一括チェックする（面接は始めない）")
    ap.add_argument("--backend", choices=["gemini", "nvidia"], help="この API の候補だけ試す")
    ap.add_argument("--timeout", type=int, default=minamo.PROBE_TIMEOUT, help="待つ秒数")
    ap.add_argument("--show", action="store_true", help="合格した返事の書き出しも見る")
    a = ap.parse_args()
    if not candidates(a.backend):
        print("APIキーが見つかりません（README の「APIキー」）。")
        return
    results = run(a.backend, a.timeout)
    print(summary(results))
    if a.show:
        for r in results:
            if r["sample"]:
                print(f"\n[{r['model']}] {r['sample']}")


if __name__ == "__main__":
    main()
