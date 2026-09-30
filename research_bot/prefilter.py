#!/usr/bin/env python3
# prefilter.py — 2段階フィルタの1段目(軽い問い合わせで「明らかに無関係」だけ弾く)
import json, os, re, time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

from openai import OpenAI

BASE_URL = "https://integrate.api.nvidia.com/v1"
MODEL = os.environ.get("PREFILTER_MODEL", "nvidia/nemotron-3-super-120b-a12b")
MODE = os.environ.get("PREFILTER_MODE", "dryrun")    # dryrun / on / off
EFFORT = os.environ.get("PREFILTER_EFFORT", "low")  # 空にすると送らない
BATCH_SIZE = int(os.environ.get("PREFILTER_BATCH_SIZE", "15"))
CONCURRENCY = int(os.environ.get("PREFILTER_CONCURRENCY", "3"))
EXCERPT_CHARS = int(os.environ.get("PREFILTER_EXCERPT_CHARS", "500"))
MAX_TOKENS = int(os.environ.get("PREFILTER_MAX_TOKENS", "4096"))
MAX_DROP_RATIO = float(os.environ.get("PREFILTER_MAX_DROP_RATIO", "0.6"))
TIMEOUT = float(os.environ.get("PREFILTER_TIMEOUT", "60"))
RETRIES = int(os.environ.get("PREFILTER_RETRIES", "5"))
LOG_DIR = Path(os.environ.get(
    "PREFILTER_LOG_DIR", "~/.local/share/research_prefilter")).expanduser()

SYSTEM_PROMPT = """あなたは系統的文献検索の一次スクリーニング担当です。
目的は「明らかに無関係な文献だけ」を取り除くことで、精密な判定は後段の別モデルが担います。
取りこぼし(関連文献を誤ってoffにすること)は、無関係文献が残ることよりはるかに重大な失敗です。

各文献に次のいずれかを付けてください。
- "off": 研究分野そのものが違う、または対象者・支援方法・測定している行動のどれもテーマと重ならない
- "maybe": 関連が弱い、部分的、または判断がつかない
- "in": 明らかに関連する

絶対ルール:
- 少しでも迷ったら必ず"maybe"にする。"off"は確信がある場合だけ。
- 抄録が短い・欠けている文献は"off"にしない。
- 対象者の年齢・診断名・障害種別の違いだけでは"off"にしない(例: 成人と子ども、知的障害と自閉スペクトラム症・ダウン症・発達障害全般)。
- 支援方法の別名・下位形態・提示手段の違い(紙とタブレット等)、場面(学校・家庭・施設・地域)の違い、支援者(保護者・教員・職員)を介した介入は"off"の理由にしない。
- 全ての文献に1つずつ判定を付ける。
- 出力はJSONのみ。説明文・前置き・コードブロック記法は書かない。
形式: {"r":[{"i":1,"v":"off"},{"i":2,"v":"maybe"}]}"""

PAIR_RE = re.compile(r'"i"\s*:\s*(\d+)\s*,\s*"v"\s*:\s*"(off|maybe|in)"')
PAIR_RE_REV = re.compile(r'"v"\s*:\s*"(off|maybe|in)"\s*,\s*"i"\s*:\s*(\d+)')

_client = None
_effort_ok = True
_last_seconds = 0.0


def _get_client():
    global _client
    if _client is None:
        _client = OpenAI(base_url=BASE_URL, api_key=os.environ["NVIDIA_API_KEY"],
                         timeout=TIMEOUT, max_retries=0)
    return _client


def _field(p, *keys):
    for k in keys:
        v = p.get(k) if isinstance(p, dict) else getattr(p, k, None)
        if v:
            return str(v)
    return ""


def _ask(text, label):
    global _effort_ok
    attempt = 0
    while attempt < RETRIES:
        kw = dict(model=MODEL, temperature=0, max_tokens=MAX_TOKENS,
                  messages=[{"role": "system", "content": SYSTEM_PROMPT},
                            {"role": "user", "content": text}])
        if EFFORT and _effort_ok:
            kw["reasoning_effort"] = EFFORT
        if not _throttle():
            return ""
        try:
            res = _get_client().chat.completions.create(**kw)
            ch = res.choices[0]
            if ch.finish_reason == "length":
                print(f"  [prefilter] {label}: max_tokens到達(読めた分だけ採用)")
            return ch.message.content or ""
        except Exception as e:
            status = getattr(e, "status_code", None)
            body = getattr(e, "body", None) or str(e)
            if status == 400 and "reasoning_effort" in kw:
                _effort_ok = False
                print("  [prefilter] reasoning_effortが拒否されたため外して再試行")
                continue
            attempt += 1
            if status in (429, 500, 502, 503, 504) and attempt < RETRIES:
                # 429 は短い間隔で送り直すほど長引くので、倍々で待つ
                wait = 10 * 2 ** (attempt - 1) if status == 429 else 5 * attempt
                print(f"  [prefilter] {label}: {status} → {wait}秒後に再試行")
                time.sleep(wait)
                continue
            print(f"  [prefilter] {label}: 失敗 status={status} "
                  f"{str(body)[:300]} → この束は全件通過扱い")
            return ""
    return ""


def _throttle():
    """llm.py の送信間隔の制御(全スレッド合計で REQUESTS_PER_MINUTE 以下)を共有する。

    prefilter は独自に API を呼んでおり、この制御を通っていなかったため、
    並列で一斉に送って 429 を連発していた。llm を読み込めない環境
    (prefilter_bench.py を単体で動かす等)では制御なしで続ける。
    """
    try:
        import llm
    except Exception:
        return True
    return llm._throttle()


def _parse(text):
    out = {int(i): v for i, v in PAIR_RE.findall(text or "")}
    for v, i in PAIR_RE_REV.findall(text or ""):
        out.setdefault(int(i), v)
    return out


def judge_all(papers, theme):
    batches = [list(range(s, min(s + BATCH_SIZE, len(papers))))
               for s in range(0, len(papers), BATCH_SIZE)]

    def work(bi, idxs):
        parts = [f"【テーマ】\n{theme}\n\n【文献】"]
        for n, idx in enumerate(idxs, 1):
            p = papers[idx]
            ab = _field(p, "content", "abstract", "abs", "summary")[:EXCERPT_CHARS]
            parts.append(f"[{n}] {_field(p, 'title')}\n{ab or '(抄録なし)'}")
        got = _parse(_ask("\n\n".join(parts), f"束{bi + 1}/{len(batches)}"))
        return {idx: got.get(n, "unjudged") for n, idx in enumerate(idxs, 1)}

    verdicts = {}
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
        futs = [ex.submit(work, bi, idxs) for bi, idxs in enumerate(batches)]
        for f in as_completed(futs):
            verdicts.update(f.result())
    return verdicts


def _write_log(off, counts, tag, theme, guard):
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r'[\\/:*?"<>|\s]+', "_", tag)[:60]
    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    md = LOG_DIR / f"_prefilter__{safe}__{stamp}.md"
    lines = [f"# prefilter: {tag}", "",
             f"- model: {MODEL} / mode: {MODE}",
             f"- in={counts['in']} maybe={counts['maybe']} "
             f"off={counts['off']} 未判定={counts['unjudged']}",
             f"- 除外率ガード発動: {'はい(除外中止)' if guard else 'いいえ'}",
             "", "## テーマ", "", theme, "", "## off判定", ""]
    rec = []
    for p in off:
        title, doi, url = _field(p, "title"), _field(p, "doi"), _field(p, "url")
        ab = _field(p, "content", "abstract", "abs", "summary")[:200].replace("\n", " ")
        lines += [f"- **{title}**", f"  {doi or url or '(識別子なし)'}",
                  f"  > {ab or '(抄録なし)'}", ""]
        rec.append({"title": title, "doi": doi, "url": url})
    md.write_text("\n".join(lines), encoding="utf-8")
    md.with_suffix(".json").write_text(
        json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")
    return md


def annotate(items, theme, tag="theme", off_cluster="off"):
    """未判定の文献に it["prefilter"] を書き込む。
    onかつガード非発動なら、offに relevance_score=0 とクラスタを付けて判定済み扱いにする。
    戻り値: 2段目に渡す文献(除外したもの以外)。失敗時は全件通過。"""
    global _last_seconds
    if MODE == "off":
        return list(items)
    if not os.environ.get("NVIDIA_API_KEY"):
        print("[prefilter] NVIDIA_API_KEY未設定のためスキップ")
        return list(items)
    cands = [it for it in items
             if it.get("relevance_score") is None and "prefilter" not in it]
    if cands:
        t0 = time.time()
        print(f"[prefilter] 1段目: {len(cands)}件 model={MODEL} mode={MODE} "
              f"batch={BATCH_SIZE} 並列={CONCURRENCY}")
        empty = sum(1 for it in cands
                    if len(_field(it, "content", "abstract", "abs", "summary")) < 50)
        if empty > 0.8 * len(cands):
            print(f"[prefilter] ⚠ {empty}件で抄録を読めていません"
                  f"(キー名の不一致を疑ってください)")
        v = judge_all(cands, theme)
        for i, it in enumerate(cands):
            it["prefilter"] = v.get(i, "unjudged")
        counts = Counter(it["prefilter"] for it in cands)
        for k in ("in", "maybe", "off", "unjudged"):
            counts.setdefault(k, 0)
        off = [it for it in cands if it["prefilter"] == "off"]
        _last_seconds = time.time() - t0
        print(f"[prefilter] in={counts['in']} maybe={counts['maybe']} "
              f"off={counts['off']} 未判定={counts['unjudged']} "
              f"({_last_seconds:.0f}秒)")
        guard = len(off) / len(cands) > MAX_DROP_RATIO
        if guard:
            print(f"[prefilter] ⚠ off率が{MAX_DROP_RATIO:.0%}超 → テーマ文や"
                  f"モデル応答の異常を疑い、除外を中止します")
        print(f"[prefilter] ログ: {_write_log(off, counts, tag, theme, guard)}")
        if MODE == "on" and not guard:
            for it in off:
                it["relevance_score"] = 0
                it["cluster"] = off_cluster
                it["prefilter_dropped"] = True
            print(f"[prefilter] {len(off)}件を除外 → 2段目へ"
                  f"{len(cands) - len(off)}件")
        elif MODE != "on":
            print("[prefilter] dryrunのため除外していません"
                  "(判定後に取りこぼし監査を表示します)")
    return [it for it in items if not it.get("prefilter_dropped")]


def audit(items, threshold, stage2_seconds=None, n_judged=None):
    """dryrun時: 1段目off判定の論文が2段目でどう判定されたかを集計する。"""
    dropped = sum(1 for it in items if it.get("prefilter_dropped"))
    if dropped:
        print(f"\n[prefilter] 1段目で{dropped}件を除外済み(除外一覧にスコア0で載ります)")
    off = [it for it in items
           if it.get("prefilter") == "off" and not it.get("prefilter_dropped")]
    if not off:
        return
    passed = [it for it in off if it.get("relevance_score") is not None
              and it["relevance_score"] >= threshold]
    dist = Counter(str(it.get("cluster")) for it in off)
    print(f"\n[prefilter 監査] 1段目でoffの{len(off)}件 → 2段目の判定: {dict(dist)}")
    for cat in ("maybe", "in"):
        grp = [it for it in items if it.get("prefilter") == cat]
        if grp:
            ok = sum(1 for it in grp if it.get("relevance_score") is not None
                     and it["relevance_score"] >= threshold)
            print(f"  参考: 1段目{cat}の{len(grp)}件 → 2段目で採用{ok}件"
                  f"({ok / len(grp):.1%})")
    if passed:
        print(f"  ⚠ うち{len(passed)}件が2段目で採用(スコア{threshold}以上)。"
              f"onにすると取りこぼす論文です:")
        for it in sorted(passed, key=lambda x: -x["relevance_score"])[:15]:
            print(f"    - [{it['relevance_score']}] {_field(it, 'title')[:70]}")
    else:
        print("  ✓ 2段目で採用された論文はゼロ。このテーマではonにしても取りこぼしなし")
    if stage2_seconds and n_judged:
        est = stage2_seconds * len(off) / n_judged - _last_seconds
        print(f"  時間の目安: 2段目{stage2_seconds:.0f}秒・1段目{_last_seconds:.0f}秒"
              f" → onなら約{est:.0f}秒短縮" if est > 0 else
              "  時間の目安: このテーマでは短縮効果はほぼありません")
