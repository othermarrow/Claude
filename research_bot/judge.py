"""抄録をLLMに読ませる処理(旧 prefilter.py・judge.py・extract.py・ensemble_check.py)。

  1. prefilter()          1段目。軽い問い合わせで「明らかに無関係」だけを弾く
  2. judge_relevance()    2段目。関連度(0-100)と実測の有無を判定し、クラスタを決める
  3. annotate_features()  採用した抄録から研究設計・参加者・場面・質指標を抽出する
  4. run_ensemble()       生成済みカタログを別のモデルで再判定し、割れた抄録を報告する

問い合わせはすべて llm.py を通す。判定・抽出・再判定は、モデルが応答しなく
なったら config.FALLBACK_ORDER の順に代わりのモデルへ切り替えて続ける。
どの文献をどのモデルで判定したかは it["judge_model"] に残す。
設定値は config.py にある。
"""

import datetime
import hashlib
import json
import os
import re
import time
from collections import Counter

from tqdm import tqdm

import catalog
import config
import llm

UNJUDGED = "未判定"


# ==========================================================================
# 1. 1段目: 粗選別(prefilter)
# ==========================================================================
# 目的は「明らかに無関係な文献だけ」を取り除いて2段目の件数を減らすこと。
# 取りこぼしのほうが重大なので、失敗したバッチは全件通過させる。
# PREFILTER_MODE = "dryrun" では除外せず、2段目のあとで「on にしていたら
# 何を取りこぼしたか」を監査する。on にしてよいかはテーマごとにこれで確かめる。
PREFILTER_SYSTEM_PROMPT = """あなたは系統的文献検索の一次スクリーニング担当です。
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

# JSONとして壊れていても i と v の組だけ拾えれば使えるので、正規表現で読む
_PAIR_RE = re.compile(r'"i"\s*:\s*(\d+)\s*,\s*"v"\s*:\s*"(off|maybe|in)"')
_PAIR_RE_REV = re.compile(r'"v"\s*:\s*"(off|maybe|in)"\s*,\s*"i"\s*:\s*(\d+)')
_ABSTRACT_KEYS = ("content", "abstract", "abs", "summary")

_prefilter_seconds = 0.0


def _text(it: dict, *keys) -> str:
    for k in keys:
        v = it.get(k)
        if v:
            return str(v)
    return ""


def _prefilter_prompt(theme: str, papers) -> str:
    """papers は (タイトル, 抄録) の並び。"""
    parts = [f"【テーマ】\n{theme}\n\n【文献】"]
    for n, (title, abstract) in enumerate(papers, 1):
        ab = (abstract or "")[:config.PREFILTER_EXCERPT_CHARS]
        parts.append(f"[{n}] {title}\n{ab or '(抄録なし)'}")
    return "\n\n".join(parts)


def _parse_verdicts(text: str) -> dict:
    out = {int(i): v for i, v in _PAIR_RE.findall(text or "")}
    for v, i in _PAIR_RE_REV.findall(text or ""):
        out.setdefault(int(i), v)
    return out


def _prefilter_batch(batch, theme: str, model: str) -> list:
    """1バッチを粗選別し、batch と同じ長さの判定(in/maybe/off/unjudged)を返す。"""
    prompt = _prefilter_prompt(
        theme, [(_text(it, "title"), _text(it, *_ABSTRACT_KEYS)) for it in batch])
    raw = llm.ask(prompt, model, system=PREFILTER_SYSTEM_PROMPT, temperature=0,
                  max_tokens=config.PREFILTER_MAX_TOKENS, disable_thinking=False,
                  reasoning_effort=config.PREFILTER_EFFORT or None,
                  timeout=config.PREFILTER_TIMEOUT, mark_dead=False)
    if llm.is_error(raw):
        if "中断" not in raw:
            tqdm.write(f"  [prefilter] 失敗 → この束の{len(batch)}件は全件通過扱い: "
                       f"{raw[:160]}")
        return ["unjudged"] * len(batch)
    got = _parse_verdicts(raw)
    return [got.get(n, "unjudged") for n in range(1, len(batch) + 1)]


def _write_prefilter_log(off, counts, tag, theme, model, guard) -> str:
    os.makedirs(config.PREFILTER_LOG_DIR, exist_ok=True)
    safe = re.sub(r'[\\/:*?"<>|\s]+', "_", tag)[:60]
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M")
    md = os.path.join(config.PREFILTER_LOG_DIR, f"_prefilter__{safe}__{stamp}.md")
    lines = [f"# prefilter: {tag}", "",
             f"- model: {model} / mode: {config.PREFILTER_MODE}",
             f"- in={counts['in']} maybe={counts['maybe']} "
             f"off={counts['off']} 未判定={counts['unjudged']}",
             f"- 除外率ガード発動: {'はい(除外中止)' if guard else 'いいえ'}",
             "", "## テーマ", "", theme, "", "## off判定", ""]
    rec = []
    for it in off:
        title, doi, url = _text(it, "title"), _text(it, "doi"), _text(it, "url")
        ab = _text(it, *_ABSTRACT_KEYS)[:200].replace("\n", " ")
        lines += [f"- **{title}**", f"  {doi or url or '(識別子なし)'}",
                  f"  > {ab or '(抄録なし)'}", ""]
        rec.append({"title": title, "doi": doi, "url": url})
    with open(md, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    with open(os.path.splitext(md)[0] + ".json", "w", encoding="utf-8") as f:
        json.dump(rec, f, ensure_ascii=False, indent=1)
    return md


def prefilter(items, theme: str, tag: str = "theme") -> list:
    """1段目。まだ判定していない文献に it["prefilter"] を書き込む。

    PREFILTER_MODE が on で、off率が上限以下なら、off に関連度0とクラスタ off を
    付けて判定済み扱いにする。戻り値は2段目に渡す文献(除外したもの以外)。
    """
    global _prefilter_seconds
    mode = config.PREFILTER_MODE
    if mode not in ("on", "off", "dryrun"):
        print(f"[prefilter] PREFILTER_MODE={mode!r} は不明な値です。dryrun として扱います。")
        mode = "dryrun"
    if mode == "off":
        return list(items)
    if not llm.have_api_key():
        print(f"[prefilter] {llm.KEY_NAME} が未設定のためスキップ")
        return list(items)
    model = config.PREFILTER_MODEL
    cands = [it for it in items
             if it.get("relevance_score") is None and "prefilter" not in it]
    if cands:
        t0 = time.time()
        print(f"[prefilter] 1段目: {len(cands)}件 model={model} mode={mode} "
              f"batch={config.PREFILTER_BATCH_SIZE} 並列={config.PREFILTER_CONCURRENCY}")
        empty = sum(1 for it in cands if len(_text(it, *_ABSTRACT_KEYS)) < 50)
        if empty > 0.8 * len(cands):
            print(f"[prefilter] ⚠ {empty}件で抄録を読めていません"
                  "(キー名の不一致を疑ってください)")
        size = config.PREFILTER_BATCH_SIZE
        batches = [cands[i:i + size] for i in range(0, len(cands), size)]

        def on_result(batch, verdicts):
            for it, v in zip(batch, verdicts or ["unjudged"] * len(batch)):
                it["prefilter"] = v

        llm.run_parallel(lambda b: _prefilter_batch(b, theme, model), batches,
                         "1段目の粗選別", on_result=on_result,
                         concurrency=config.PREFILTER_CONCURRENCY)
        counts = Counter(it.get("prefilter", "unjudged") for it in cands)
        for k in ("in", "maybe", "off", "unjudged"):
            counts.setdefault(k, 0)
        off = [it for it in cands if it.get("prefilter") == "off"]
        _prefilter_seconds = time.time() - t0
        print(f"[prefilter] in={counts['in']} maybe={counts['maybe']} "
              f"off={counts['off']} 未判定={counts['unjudged']} "
              f"({_prefilter_seconds:.0f}秒)")
        guard = len(off) / len(cands) > config.PREFILTER_MAX_DROP_RATIO
        if guard:
            print(f"[prefilter] ⚠ off率が{config.PREFILTER_MAX_DROP_RATIO:.0%}超 → "
                  "テーマ文やモデル応答の異常を疑い、除外を中止します")
        print(f"[prefilter] ログ: "
              f"{_write_prefilter_log(off, counts, tag, theme, model, guard)}")
        if mode == "on" and not guard:
            for it in off:
                it["relevance_score"] = 0
                it["cluster"] = classify(0, False)
                it["prefilter_dropped"] = True
            print(f"[prefilter] {len(off)}件を除外 → 2段目へ{len(cands) - len(off)}件")
        elif mode != "on":
            print("[prefilter] dryrunのため除外していません"
                  "(判定後に取りこぼし監査を表示します)")
    return [it for it in items if not it.get("prefilter_dropped")]


def prefilter_audit(items, stage2_seconds=None, n_judged=None) -> None:
    """dryrun時: 1段目で off とされた文献が2段目でどう判定されたかを集計する。"""
    threshold = config.RELEVANCE_THRESHOLD
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
              "onにすると取りこぼす論文です:")
        for it in sorted(passed, key=lambda x: -x["relevance_score"])[:15]:
            print(f"    - [{it['relevance_score']}] {_text(it, 'title')[:70]}")
    else:
        print("  ✓ 2段目で採用された論文はゼロ。このテーマではonにしても取りこぼしなし")
    if stage2_seconds and n_judged:
        est = stage2_seconds * len(off) / n_judged - _prefilter_seconds
        print(f"  時間の目安: 2段目{stage2_seconds:.0f}秒・1段目{_prefilter_seconds:.0f}秒"
              f" → onなら約{est:.0f}秒短縮" if est > 0 else
              "  時間の目安: このテーマでは短縮効果はほぼありません")


# 1段目の候補モデルを同じ条件で比べる(旧 prefilter_bench.py)
_BENCH_THEME = "強度行動障害のある成人に対する構造化支援の効果"
_BENCH_PAPERS = [
    ("Structured teaching for adults with autism and severe challenging "
     "behavior in residential settings",
     "We examined the effects of structured teaching on aggression and "
     "self-injury among adults living in a residential facility."),
    ("視覚的スケジュールが知的障害者の行動問題に与える影響",
     "入所施設で暮らす成人の知的障害者を対象に、視覚的スケジュールの"
     "導入前後で行動問題の頻度を比較した。"),
    ("Corrosion resistance of stainless steel welds in marine environments",
     "Weld samples were exposed to seawater for 12 months."),
    ("Nitrogen fertilization and rice yield in paddy fields",
     "Field trials were conducted across three seasons."),
    ("Sleep problems in adults with autism", ""),
]
_BENCH_EXPECT = "in in off off maybe/in"


def bench_prefilter(models, timeout: float = 300) -> None:
    """5件の固定問題で、1段目の候補モデルの速度・思考量・判定を比べる。

    思考の量は low と指定なしの両方を試す(low を拒否されたら指定なしだけ)。
    再試行を挟むと時間が測れないので、llm.ask を使わず1回だけ呼ぶ。
    """
    client = llm.get_client()
    prompt = _prefilter_prompt(_BENCH_THEME, _BENCH_PAPERS)
    for model in models:
        print(f"\n=== {model}")
        for effort in ("low", None):
            label = f"effort={effort or 'なし'}"
            t0 = time.monotonic()
            try:
                res = client.chat.completions.create(
                    model=model, temperature=0,
                    max_tokens=config.PREFILTER_MAX_TOKENS, timeout=timeout,
                    messages=[{"role": "system", "content": PREFILTER_SYSTEM_PROMPT},
                              {"role": "user", "content": prompt}],
                    extra_body=llm._thinking_body(model, effort) if effort else None)
            except Exception as e:
                status = getattr(e, "status_code", None)
                body = getattr(e, "body", None) or e
                print(f"  {label}: 失敗 {time.monotonic() - t0:.0f}秒 status={status} "
                      f"{str(body)[:200]}")
                if status == 400 and effort:
                    continue   # パラメータ拒否 → 付けずに再測定
                break
            ch, u = res.choices[0], res.usage
            det = getattr(u, "completion_tokens_details", None) if u else None
            rt = getattr(det, "reasoning_tokens", None)
            got = _parse_verdicts(ch.message.content)
            v = " ".join(got.get(i, "-") for i in range(1, len(_BENCH_PAPERS) + 1))
            print(f"  {label}: {time.monotonic() - t0:.1f}秒 "
                  f"出力{u.completion_tokens if u else '?'}tok"
                  f"(うち思考{rt if rt is not None else '?'}) "
                  f"finish={ch.finish_reason}")
            print(f"    判定: {v}   (期待: {_BENCH_EXPECT})")
            if not got:
                print(f"    本文先頭: {(ch.message.content or '')[:200]!r}")
            break


# ==========================================================================
# 2. 2段目: 関連度とクラスタの判定
# ==========================================================================
# 本判定と run_ensemble(別モデルでの再判定)の両方がここを使う。以前の
# ensemble_check.py は独自のプロンプトで core/related/off を直接選ばせていたが、
# それは本判定側で「core が9割に膨らんだ」ためにやめた方式だった。プロンプトが
# 違うと、不一致の多くがモデルの差ではなくプロンプトの差から生じる。
# 同じプロンプト・同じ分類規則で判定させ、違いをモデルだけにする。
#
# 判定結果の形(1件ぶん):
#   {"score": 0-100, "measured": True/False/None, "reason": str, "cluster": str}
# cluster は score と measured から classify() で機械的に決める。
FILTER_PROMPT = """You are an expert in academic literature review.

[Research theme] {topic}
[Definition of the theme] {definition}
{homonym_note}
[Candidate papers]
{listing}

[Judgment criteria]
For each paper, judge both a relevance score (0-100) and measured (boolean).

Guide to the relevance score:
{core}-100: the paper's main subject is the exact target/method the theme's
        definition refers to
{keep}-{core_below}: adjacent evidence that a reader of this theme would want to
        see: the same intervention or phenomenon in a broader or neighboring
        population or setting, a close variant of the target, or a review
        of it. The target itself is not the main subject.
{off_above}-{keep_below}: shares a broad area or a keyword, but would not inform the
        theme
0-{off}: unrelated, or a same-name/same-spelling but different concept

A theme is normally an intersection of conditions, not a single keyword.
Read the definition and identify every condition it states — the
phenomenon, the population, and the setting or context. A paper reaches
90-100 only when its main subject covers that whole intersection. A paper
about the phenomenon in general, or about it in a population the definition
does not cover, belongs in {keep}-{core_below} however central the phenomenon is to that
paper, and however often the keyword appears in it. For a theme about
transference between abused people with intellectual disabilities and their
support workers, a general overview of transference-focused psychotherapy
is {keep}-{core_below}, not 95. Score the intersection, not the keyword.

The definition may say that some kinds of studies are not included — a
broader or narrower population, a different time unit or variant of the
intervention, another setting. A study that is close to the theme but falls
under such a clause is still adjacent evidence: score it {keep}-{core_below},
not lower. Reserve 0-{off} for a same-name/same-spelling concept or a
different field, and {off_above}-{keep_below} for a study that shares only a broad area or a
keyword with the theme.

Judge measured on this single question only:
"Did this study actually measure, evaluate, or apply the target that the
theme's definition refers to?"
  true : the methods or results describe actually measuring, evaluating, or
         applying the target
  false: the target is only mentioned in the introduction or discussion,
         only cited as prior work, only raised as a future research
         direction, or the study uses a different method under the same
         broader concept
A theoretical or conceptual paper, a narrative review, a commentary, an
overview of a therapeutic approach, or a textbook-style explanation reports
no measurement of its own. Mark those false even when the whole paper is
about the target.
If the target's name appears in the title but is not addressed in the
methods/results, mark false. If the abstract is cut off partway through and
you cannot tell, also mark false, and write in reason (in Japanese):
"測定の有無が抄録から判断できない".

If the title looks similar but refers to a different concept, scale, or
field (a same-name/same-spelling but unrelated case), score 20 or below,
and write in reason (in Japanese) what it is being confused with, in the
form "同名異義語: 〇〇". A homonym is a different thing that happens to share
the name. An outdated term for the same population (e.g. "mentally
retarded"), a broader or narrower population, or a related method is not a
homonym. Any paper whose content falls outside psychology,
welfare, medicine, and education scores 20 or below.

[Output]
Output only a JSON array in the following format. You must output exactly one
entry for every paper, with no omissions. Write the reason field in Japanese,
briefly (under 40 characters). Leave it empty when there is nothing to note.
Each entry also has "t": the first three words of that paper's title,
copied exactly as listed (for a Japanese title, its first 10 characters),
without the source in brackets. It shows which paper the entry is about, so
take it from the paper you are judging at that moment.
The example below shows the format only. Judge each paper from its own
abstract and write your own reason; never copy the example scores or reasons.
"〇〇" is a slot to fill in, never output it as is.
[{{"index": 0, "t": "〇〇", "score": 95, "measured": true, "reason": ""}},
 {{"index": 1, "t": "〇〇", "score": 85, "measured": false, "reason": "導入で言及するのみ"}},
 {{"index": 2, "t": "〇〇", "score": 10, "measured": false, "reason": "同名異義語: 〇〇"}}]"""

# 例の枠("〇〇")。これが残った理由は、抄録を読まずに例を写したとみなす。
EXAMPLE_SLOT = "〇〇"

# guided_json(config.USE_GUIDED_JSON)を使うときのスキーマ
FILTER_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "index": {"type": "integer"},
            "t": {"type": "string"},
            "score": {"type": "integer", "minimum": 0, "maximum": 100},
            "measured": {"type": "boolean"},
            "reason": {"type": "string"},
        },
        "required": ["index", "t", "score", "measured", "reason"],
    },
}


def _score_bands() -> dict:
    """判定の手引きの点数帯。config の閾値と揃える。

    実測: 手引きが「隣接領域は60-89」、採用の閾値が70で、隣接領域の帯の
    真ん中で採否が分かれていた。同じ種類の文献が65点で除外、75点で採用と
    なり(知的障害者への視覚的活動スケジュールのメタ分析が65点で除外)、
    取り直すたびに採否が入れ替わった。隣接領域の帯を閾値から始めれば、
    採否は「このテーマの読み手に役立つか」という一つの問いで決まる。
    """
    return {"core": config.CORE_SCORE, "core_below": config.CORE_SCORE - 1,
            "keep": config.RELEVANCE_THRESHOLD,
            "keep_below": config.RELEVANCE_THRESHOLD - 1,
            "off": config.OFF_SCORE, "off_above": config.OFF_SCORE + 1}


def homonym_note(homonyms) -> str:
    return ("【同名異義語として区別すべき概念】\n" + " / ".join(homonyms) + "\n"
            if homonyms else "")


def classify(score, measured) -> str:
    """スコアと measured からクラスタを決める。

    core/related のラベルを直接選ばせると「話題として関連するか」に流れ、
    実測で core が9割に膨らんだ。測定の有無という一つの問いに答えさせ、
    クラスタはここで機械的に導く。
    """
    if score is None:
        return UNJUDGED
    if score <= config.OFF_SCORE:
        return "off"
    if measured is True and score >= config.CORE_SCORE:
        return "core"
    return "related"


def _coerce(rec: dict) -> dict:
    """モデルの1件分の応答を正規化する。

    実測: score が "95" のような文字列で返ると比較で TypeError になり、
    バッチ全体が未判定になっていた。measured も "true" の文字列で返ることがある。
    """
    try:
        score = int(float(rec.get("score", 0)))
    except (TypeError, ValueError):
        score = 0
    score = max(0, min(100, score))
    measured = rec.get("measured")
    if isinstance(measured, str):
        measured = measured.strip().lower() in ("true", "yes", "1")
    elif not isinstance(measured, bool):
        measured = None
    reason = str(rec.get("reason") or "").strip()
    return {"score": score, "measured": measured, "reason": reason,
            "cluster": classify(score, measured)}


def _flat(text) -> str:
    """改行・連続した空白を1つの空白にする。抄録の中の「2. 方法」のような
    行が、並べた論文の番号に見えないように。"""
    return re.sub(r"\s+", " ", str(text or "")).strip()


def _listing(batch) -> str:
    return "\n".join(
        f"{i}. [{it.get('src', '')}] {_flat(it.get('title')) or 'Untitled'}\n"
        f"   Abstract: {_flat((it.get('content') or '')[:config.FILTER_EXCERPT_CHARS])}"
        for i, it in enumerate(batch))


# 「この番号の論文は無い」という応答。モデルが途中で1件読み落とし、判定を
# 1件ずつずらして書いたときに、最後の番号に出る(実測: 1回の収集で6〜8件、
# 「該当する論文が存在しない(候補に5件のみ)」等)。
_MISSING_RE = re.compile(r"(論文|抄録|文献)が(提供され|与えられ|存在し|見当たら|含まれ)"
                         r"|候補に\s*\d+\s*件")


def _title_key(s) -> str:
    s = re.sub(r"^\s*\[[^\]]*\]\s*", "", str(s or ""))
    return re.sub(r"[\W_]+", "", s.lower())


def _realign(m: dict, titles: list) -> tuple:
    """判定と論文の対応を、各判定の "t"(タイトルの書き出し)で確かめて直す。

    実測: モデルが6件のうち1件を読み落とすと、以降の判定を1件ずつ前の番号に
    書き、最後の番号に「論文が無い」と書いた。関連の明らかな研究(ビデオ
    活動スケジュール)が0点になり、その判定は無関係な本(PRT の手引き)に
    付いていた。抽出でも、2件の参加者数が入れ替わっていた。
    t が別の1件のタイトルと一致すればそちらへ付け替える。t が無い・読めない
    判定は番号どおりに置く(付け替えた判定と重なれば捨てる)。
    「論文が無い」と答えた判定は捨てる(判定し直しになる)。
    戻り値は (付け替えた数, 捨てた数)。
    """
    keys = [_title_key(t) for t in titles]
    dropped = 0
    for i in [i for i, r in m.items()
              if _MISSING_RE.search(str((r or {}).get("reason") or ""))]:
        del m[i]
        dropped += 1

    def where(r):
        tk = _title_key((r or {}).get("t"))[:30]
        if len(tk) < 4:
            return None
        return [j for j, k in enumerate(keys) if k.startswith(tk)]

    ok, move, unsure = {}, [], []
    for i, r in m.items():
        hit = where(r)
        if hit and i in hit:
            ok[i] = r
        elif hit and len(hit) == 1:
            move.append((hit[0], r))
        else:
            unsure.append((i, r))
    moved = 0
    for j, r in move:
        if j in ok:
            dropped += 1
        else:
            ok[j] = r
            moved += 1
    for i, r in unsure:
        if i in ok:
            dropped += 1
        else:
            ok[i] = r
    m.clear()
    m.update(ok)
    return moved, dropped


def _diagnose(raw: str, n: int) -> None:
    """再送を使い切った応答の失敗の型を表示する。"""
    s = raw.strip()
    tqdm.write(f"  [!] 判定応答の解析に失敗(再送{config.JUDGE_BATCH_RETRIES}回も失敗、"
               f"{n}件は未判定): {raw[:200]!r}")
    if s and not s.startswith(("[", "```")) and s.lower().startswith(
            ("we need", "given that", "let's", "i'll", "let me", "okay",
             "first,", "the user")):
        tqdm.write("      応答が英語の思考過程で始まっています。思考がcontentに"
                   "漏れています。FILTER_BATCH_SIZE を下げるか、別のモデルを"
                   "試してください。")
    elif s and s[-1] not in "]}":
        tqdm.write("      応答が閉じ括弧なしで終わっており、途中で切れた"
                   "可能性があります。")


def _count_note(n: int) -> str:
    """件数をプロンプトの末尾で明示する。

    実測: nemotron-3-super は件数の明示が無いと、6件のバッチで最後の1件を
    書かずに配列を閉じた(毎回 index 0〜4)。再送しても同じで、全バッチの
    6件目が未判定になっていた。この一文で6件そろうことを確かめてある。
    """
    return (f"\n\nThere are exactly {n} papers (index 0 to {n - 1}). "
            f"Your array must contain exactly {n} entries.")


_extra_shown = set()          # JSON 以外の出力を知らせたモデル


def _note_extra(raw: str, model: str) -> None:
    """JSON の前後に余分な出力が付いた応答を、モデルごとに1回だけ知らせる。

    実測: 判定の応答の全バッチで JSON の前後に何かが付き、毎回
    「余分な出力があった」と表示されて、他の表示が読めなくなった。読み取り
    には影響しない(先頭の JSON だけを使う)ので、何が付いているかの例を
    1回見せて、以後は表示しない。
    """
    if model in _extra_shown:
        return
    _extra_shown.add(model)
    s = (raw or "").strip()
    lead, tail = "", ""
    i = s.find("[")
    if i >= 0:
        try:
            _, end = json.JSONDecoder().raw_decode(s, i)
            lead, tail = s[:i].strip(), s[end:].strip()
        except ValueError:
            pass
    parts = ([f"前 {lead[:60]!r}"] if lead else []) + \
            ([f"後ろ {tail[:80]!r}"] if tail else [])
    tqdm.write(f"  [i] {model} の応答に JSON 以外の出力が付いています。先頭の JSON "
               "だけを使うので判定には影響しません(以後この表示は省略)。"
               + (f"\n      例: {' / '.join(parts)}" if parts else ""))


def _drop_copied(m: dict) -> set:
    """例の枠("〇〇")が残った判定を m から取り除き、その index を返す。

    実測: 同名異義語の概念が無いテーマで、nemotron-nano-omni-reasoning が
    明らかに関連する文献(問題行動の機能分析など)にも、プロンプトの例の
    「score 10 / 同名異義語: 運動機能評価尺度」をそのまま写した(再判定
    321件中45件、本判定の除外にも36件)。例を枠にしておけば写したことが
    分かるので、その判定は使わずに判定し直す。
    """
    copied = {i for i, r in m.items()
              if EXAMPLE_SLOT in str((r or {}).get("reason") or "")}
    for i in copied:
        del m[i]
    return copied


def judge_batch(batch, topic, definition, hom, model, max_tokens=None, avoid=(),
                order=None):
    """1バッチを判定し、batch と同じ長さのリストを返す。

    要素は判定結果の辞書(実際に判定したモデルを "model" に持つ)、または
    判定できなかった場合の {"error": 理由} 。items には書き込まない
    (書き込みは呼び出し側がメインスレッドで行う)。
    model が応答しなくなっていれば、order(省略時は FALLBACK_ORDER)の順で、
    avoid 以外の代わりのモデルで判定する。
    """
    prompt = FILTER_PROMPT.format(topic=topic, definition=definition,
                                  homonym_note=hom, listing=_listing(batch),
                                  **_score_bands())
    prompt += _count_note(len(batch))
    # guided_json を使う場合にも件数を強制する(使わない場合は無害)
    schema = dict(FILTER_SCHEMA, minItems=len(batch), maxItems=len(batch))
    raw = ""
    for attempt in range(config.JUDGE_BATCH_RETRIES + 1):
        raw, used = llm.ask_fallback(prompt, model, avoid=avoid, order=order,
                                     schema=schema, max_tokens=max_tokens)
        if llm.is_error(raw):
            # ask は内部で再試行を済ませている。ここで再送しても同じ失敗を
            # 重ねるだけなので打ち切る。
            if "中断" not in raw:
                tqdm.write(f"  [!] AIへの問い合わせ自体が失敗しました"
                           f"(このバッチ{len(batch)}件は未判定): {raw[:160]}")
            return [{"error": "判定失敗(AIへの問い合わせが失敗)"}] * len(batch)
        recs, mode = llm.parse_json_array(raw)
        m = llm.index_records(recs, len(batch))
        moved, dropped = _realign(m, [it.get("title") for it in batch])
        if moved or dropped:
            tqdm.write(f"  [i] 判定と論文の番号がずれていました(付け替え {moved}件"
                       f" / 判定し直し {dropped}件)。")
        # 例文を写した分は送り直さない(温度0では同じ応答が返りやすい)。
        # 未判定として、あとで1件ずつ判定し直す。
        copied = _drop_copied(m)
        if m and (len(m) + len(copied) >= len(batch)
                  or attempt >= config.JUDGE_BATCH_RETRIES):
            if mode == "prefix":
                _note_extra(raw, used)
            elif mode != "strict":
                tqdm.write(f"  [i] 応答の形が崩れていたため、読める{len(m)}件を"
                           f"拾いました(mode={mode})")
            if copied:
                tqdm.write(f"  [!] {used} が{len(copied)}件で例文を写したため、"
                           "その分は未判定として後で判定し直します。")
            return [(dict(_coerce(m[i]), model=used) if i in m
                     else {"error": "判定失敗(例文の写し)" if i in copied
                           else "判定失敗(応答に該当indexなし)"})
                    for i in range(len(batch))]
        if attempt < config.JUDGE_BATCH_RETRIES:
            why = (f"{len(batch)}件中{len(m)}件しか読めない" if m
                   else "JSONとして読める部分が無い")
            if copied:
                why += f"、{len(copied)}件は例文の写し"
            tqdm.write(f"  [!] 判定応答の解析に失敗({why}, mode={mode})。"
                       f"再送します ({attempt + 1}/{config.JUDGE_BATCH_RETRIES})")
    _diagnose(raw, len(batch))
    return [{"error": "判定失敗(JSON解析エラー)"}] * len(batch)


def apply_result(item: dict, res: dict) -> None:
    """判定結果を収集リストの1件へ書き込む(メインスレッドから呼ぶ)。"""
    if not res or "error" in res:
        item.update(relevance_score=None, cluster=UNJUDGED, measured=None,
                    exclusion_reason=(res or {}).get("error", "判定失敗"))
        return
    item.update(relevance_score=res["score"], cluster=res["cluster"],
                measured=res["measured"], exclusion_reason=res["reason"],
                judge_model=res.get("model", ""))


def split_by_threshold(items) -> tuple:
    """判定済みの items を (採用, 除外) に分ける。

    未判定(スコアなし)は捨てずに採用側へ回す。無関係と分かったわけでは
    ないため。カタログ側で本体から分離される。
    """
    kept, excluded = [], []
    for it in items:
        s = it.get("relevance_score")
        (kept if s is None or s >= config.RELEVANCE_THRESHOLD else excluded).append(it)
    return kept, excluded


def _run(items, batch_size, topic, definition, homonyms, model, desc, save):
    batches = [items[i:i + batch_size] for i in range(0, len(items), batch_size)]
    hom = homonym_note(homonyms)

    def work(batch):
        return judge_batch(batch, topic, definition, hom, model)

    def on_result(batch, results):
        results = results or [{"error": "判定失敗(処理中の例外)"}] * len(batch)
        for it, r in zip(batch, results):
            apply_result(it, r)

    llm.run_parallel(work, batches, desc, on_result=on_result,
                     checkpoint=save, checkpoint_every=config.JUDGE_CHECKPOINT_EVERY)


def judge_relevance(items, topic, definition, homonyms, model, save=None) -> tuple:
    """関連度と measured を判定し、(採用, 除外) を返す。

    すでに cluster が入っている要素は判定済みとみなして飛ばすので、
    --resume で中断したところから再開できる。
    """
    if not items or not llm.have_api_key():
        return split_by_threshold(items)
    pending = [it for it in items if not it.get("cluster")]
    if not pending:
        print("   → すべて判定済みです。判定を飛ばします。")
        return split_by_threshold(items)
    if len(pending) < len(items):
        print(f"   → 判定済み {len(items) - len(pending)}件を飛ばし、"
              f"残り {len(pending)}件を判定します。")
    _run(pending, config.FILTER_BATCH_SIZE, topic, definition, homonyms, model,
         "関連度判定中", save)
    return split_by_threshold(items)


def rescue_unjudged(items, topic, definition, homonyms, model, save=None) -> int:
    """未判定の抄録を少数ずつ判定し直す。

    まとめて投げたバッチは、1件の抄録が原因で応答全体が壊れると全件が
    未判定になる。実測で154件中128件が未判定になった回があった。
    """
    targets = [it for it in items if it.get("cluster") == UNJUDGED]
    if not targets or not llm.have_api_key():
        return 0
    print(f"\n   未判定 {len(targets)}件を{config.RESCUE_BATCH_SIZE}件ずつ判定し直します...")
    _run(targets, config.RESCUE_BATCH_SIZE, topic, definition, homonyms, model,
         "未判定を再判定", save)
    still = sum(1 for it in targets if it.get("cluster") == UNJUDGED)
    now_excluded = sum(1 for it in targets
                       if it.get("relevance_score") is not None
                       and it["relevance_score"] < config.RELEVANCE_THRESHOLD)
    solved = len(targets) - still
    print(f"   → 判定できた {solved}件(うち関連度不足で除外 {now_excluded}件) / "
          f"なお未判定 {still}件")
    return solved


def second_look(items, topic, definition, homonyms, model, save=None) -> int:
    """除外の中間帯(OFF_SCORE より上・閾値未満)を、組み合わせを変えてもう一度判定する。

    実測: 同じ検索計画・同じ1375件を同じモデルで2回判定すると、一方で
    採用した文献のうち26件が他方では除外された。多くは同じ抄録に75点と
    25点を付け分けたもの(「隣接する研究」か「分野が重なるだけ」かの
    揺れ)で、中心的なレビュー(Spriggs2016)も95点と65点に割れた。
    除外を一度で確定させず、中間帯だけをバッチの顔ぶれを変えて判定し直し、
    どちらかで採用相当なら採用する(二人で選別し、片方が残せば残す方式)。
    0〜OFF_SCORE(別分野・同名異義語)は見直さない。戻した数を返す。
    """
    if not config.SECOND_LOOK or not llm.have_api_key():
        return 0
    lo, hi = config.OFF_SCORE, config.RELEVANCE_THRESHOLD
    targets = [it for it in items if it.get("relevance_score") is not None
               and lo < it["relevance_score"] < hi and not it.get("second_looked")]
    if not targets:
        return 0
    # 1回目と同じ並びで送ると、同じ顔ぶれのバッチになり同じ判定になりやすい
    targets.sort(key=lambda it: hashlib.md5(
        (it.get("title") or "").encode("utf-8")).hexdigest())
    first = {id(it): {k: it.get(k) for k in ("relevance_score", "cluster", "measured",
                                              "exclusion_reason", "judge_model")}
             for it in targets}
    print(f"\n   除外した中間帯({lo + 1}〜{hi - 1}点)の {len(targets)}件を、"
          "組み合わせを変えてもう一度判定します...")
    _run(targets, config.FILTER_BATCH_SIZE, topic, definition, homonyms, model,
         "除外の再確認", save)
    back = 0
    for it in targets:
        before = first[id(it)]
        it["second_looked"] = True
        s2 = it.get("relevance_score")
        if s2 is not None and s2 >= hi:
            back += 1
            it["exclusion_reason"] = (f"(再確認で採用。1回目は{before['relevance_score']}点) "
                                      + (it.get("exclusion_reason") or ""))
        else:
            it.update(before)
    print(f"   → 再確認で採用に戻した {back}件 / 除外のまま {len(targets) - back}件")
    return back


def rebalance_clusters(kept) -> str:
    """core が少なすぎるとき、最高スコア帯を中心として扱う。戻り値は注記。

    判定の手引きに「テーマの交差を満たす文献だけが90点以上」と明記して
    以降、交差が薄いテーマでは90点が空集合になりうる(実測で47件すべてが
    related になった)。core が CORE_MIN_ITEMS 件未満のときだけ、最高スコア
    から順に帯を広げる。基準を変えた事実は注記としてカタログに明記する。

    広げるのは、実測を伴い(core の本来の条件の半分)、関連度が core と
    採用の閾値の中間以上のものに限る。実測: 隣接する研究の帯を70〜89点に
    してから、隣接する研究がほぼ一律に75点になり、帯を広げると75点の30件
    (総説・本の章・対象の違う研究を含む)がまとめて core になった。
    """
    scored = [it for it in kept if it.get("relevance_score") is not None]
    if not scored:
        return ""
    core_now = sum(1 for it in kept if it.get("cluster") == "core")
    if core_now >= config.CORE_MIN_ITEMS:
        return ""
    floor = (config.CORE_SCORE + config.RELEVANCE_THRESHOLD) // 2
    cands = [it for it in scored if it.get("cluster") != "core"
             and it.get("measured") is True and it["relevance_score"] >= floor]
    top = max(it["relevance_score"] for it in scored)
    if not cands:
        if core_now:
            return ""
        note = (f"関連度{config.CORE_SCORE}以上かつ実測ありの文献が無く、"
                f"{floor}点以上で実測を伴う文献も無かったため、中心クラスタは"
                f"空とした(最高は{top}点)。テーマの中核を直接扱った研究が"
                "見当たらない可能性が高い。周辺クラスタの隣接する研究が主な材料になる。")
        print(f"   → {note}")
        return note
    levels = sorted({it["relevance_score"] for it in cands}, reverse=True)
    cut, n = levels[0], 0
    for lv in levels:
        n = sum(1 for it in cands if it["relevance_score"] >= lv)
        cut = lv
        if core_now + n >= config.CORE_MIN_ITEMS:
            break
    for it in cands:
        if it["relevance_score"] >= cut:
            it["cluster"] = "core"
    reason = (f"関連度{config.CORE_SCORE}以上の文献が1件も無かった" if core_now == 0
              else f"本来の基準(関連度{config.CORE_SCORE}以上かつ実測あり)を満たす"
                   f"文献が{core_now}件しか無かった")
    note = (f"{reason}ため、実測を伴う最高スコア帯({cut}点以上・{n}件)を"
            "中心クラスタとして扱った。テーマの交差が薄く、全条件を満たす"
            "文献が存在しない可能性がある。中心クラスタの文献も、交差の"
            "一部しか満たしていないことがある。")
    print(f"   → {note}")
    return note


def write_reject_log(path, items, header):
    ordered = sorted(items, key=lambda x: (x.get("relevance_score")
                                           if x.get("relevance_score") is not None else -1),
                     reverse=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"{header}\n件数: {len(items)}\n\n")
        for it in ordered:
            s = it.get("relevance_score")
            line = f"[{'判定失敗' if s is None else s}] {it.get('title', 'Untitled')}"
            r = (it.get("exclusion_reason") or "").strip()
            f.write(line + (f" — {r}" if r else "") + "\n")


# ==========================================================================
# 3. 研究設計・参加者・場面・質指標の抽出
# ==========================================================================
# 関連度判定とは別のパスにしている。判定側に項目を足すと1応答あたりのJSONが
# 長くなり、苦労して抑えた「正しい形式のJSONが途中で切れる」問題が再発する。
# 抽出は関連度判定を通った抄録だけが対象なので件数が数分の一に減り、失敗
# しても欄が空になるだけで文献そのものは失われない。
#
# 抽出する項目は、心理・福祉領域で「その知見をどれだけ強く受け取って
# よいか」を決めるものに絞っている。
#   design  研究設計。応用行動分析では単一事例実験が主流で、群間比較と
#           同列には扱えない。設計が分からないとレビューの重みづけが
#           できず、「core 41件」の中身が読めない。
#   n       参加者数。単一事例では1〜5名が普通で、一般化の限界に直結する。
#   setting 場面。入所施設で得られた知見か、学校か、研究室か。日本の
#           生活施設に移せるかどうかを判断する材料になる。
#   markers 質指標(WWCの単一事例基準の考え方)。「実施したか」ではなく
#           「抄録に明記されているか」だけを記録する。抄録は紙幅の都合で
#           省略されることが多く、記載が無いことは実施していないことを
#           意味しないため。
#
# モデルには英語コードを書かせ、日本語ラベルはコード側(catalog.DESIGN_LABELS
# 等)で与える。自由記述の日本語ラベルを書かせると表記が揺れて集計できない。
EXTRACT_PROMPT = """You are a systematic reviewer extracting study characteristics
from abstracts.

[Research theme] {topic}
[Definition of the theme] {definition}

[Papers]
{listing}

[Rules]
Extract ONLY what the abstract itself states in words. Never infer from the
title alone, from your knowledge of the field, or from what a study of this
kind usually does. When the abstract does not say, use the unknown value.

design - choose exactly one code:
  SR    systematic review, scoping review, or meta-analysis
  RCT   randomized controlled trial / randomized group comparison
  QE    non-randomized group comparison, quasi-experiment, or cohort study
  SCED  single-case experimental design with experimental control
        (reversal/ABAB, multiple baseline, alternating treatments,
        changing criterion)
  PP    single-group pre-post or AB design with no experimental control
  OBS   cross-sectional, correlational, survey, epidemiological, or
        descriptive observational study
  PSY   psychometric study: scale development, reliability, validity,
        or factor structure
  QUAL  qualitative study (interviews, focus groups, thematic analysis)
  CASE  case report or case series with no experimental control
  REV   narrative review, commentary, or overview that is not systematic
  THEO  theoretical or conceptual paper
  GUIDE guideline, position statement, policy or administrative document
  NA    cannot be determined from the abstract

detail - for SCED, name the specific design in Japanese (多層ベースライン,
  反転法, 交代処遇法, 基準変更法). For SR write 系統的レビュー or メタ分析.
  Otherwise "". Keep it under 15 characters.

n - number of participants, as an integer. For SR the number of included
  studies is NOT n; use null. Use null if the abstract states no number.

setting - where the study took place. One code only:
  RESIDENTIAL residential/institutional living setting
  DAY         day service or day activity setting
  SCHOOL      school, classroom, or educational institution
  HOME        the participant's home
  CLINIC      hospital, outpatient clinic, or medical setting
  LAB         a laboratory or analogue setting arranged for research
  COMMUNITY   community or other everyday setting
  NA          the abstract does not say
  Do not guess the setting from the authors' affiliation.

pop - the participants, in Japanese, 25 characters or less. Give the
  disability or diagnosis and the age band as the abstract states them
  (e.g. 重度知的障害のある成人, 自閉症児(3〜6歳), 施設職員).
  Empty string if the abstract does not say.

markers - an array of codes for methodological details EXPLICITLY stated in
  the abstract. Include a code only when the abstract says so in words.
  Never add a code because that design normally involves it.
  baseline       a baseline phase or baseline measurement is described
  ioa            interobserver agreement or interrater reliability reported
  fidelity       treatment/procedural fidelity or integrity reported
  generalization generalization across settings, people, or materials
  maintenance    follow-up or maintenance data
  social         social validity or acceptability data
  random         random assignment is stated
  effect         an effect size is reported
  Empty array if none are stated.

t - the first three words of that paper's title, copied exactly as listed
  (for a Japanese title, its first 10 characters). It shows which paper the
  entry is about, so take it from the paper you are reading at that moment.

[Output]
Output only the following JSON array. Exactly one entry per paper, no
omissions, no explanatory text, no code fences. The values below show the
format only; "〇〇" is a slot to fill in.
[{{"index": 0, "t": "〇〇", "design": "SCED", "detail": "多層ベースライン", "n": 3,
  "setting": "SCHOOL", "pop": "自閉症児(5〜8歳)",
  "markers": ["baseline", "ioa", "maintenance"]}},
 {{"index": 1, "t": "〇〇", "design": "SR", "detail": "メタ分析", "n": null,
  "setting": "NA", "pop": "", "markers": ["effect"]}}]"""

EXTRACT_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "index": {"type": "integer"},
            "t": {"type": "string"},
            "design": {"type": "string", "enum": list(catalog.DESIGN_LABELS)},
            "detail": {"type": "string"},
            "n": {"type": ["integer", "null"]},
            "setting": {"type": "string", "enum": list(catalog.SETTING_LABELS)},
            "pop": {"type": "string"},
            "markers": {"type": "array",
                        "items": {"type": "string",
                                  "enum": list(catalog.MARKER_LABELS)}},
        },
        "required": ["index", "design", "n", "setting", "markers"],
    },
}


def _blank(item):
    """抽出できなかった項目に入れる既定値。欄が空になるだけで内容は失わない。"""
    item.setdefault("design_code", "NA")
    item.setdefault("design", catalog.DESIGN_LABELS["NA"])
    item.setdefault("design_detail", "")
    item.setdefault("participants_n", None)
    item.setdefault("setting", catalog.SETTING_LABELS["NA"])
    item.setdefault("population", "")
    item.setdefault("quality_markers", [])


def apply_extraction(item, rec):
    """モデルの1件分の抽出結果を正規化して item に書き込む。"""
    code = str(rec.get("design") or "NA").strip().upper()
    if code not in catalog.DESIGN_LABELS:
        code = "NA"
    setting = str(rec.get("setting") or "NA").strip().upper()
    if setting not in catalog.SETTING_LABELS:
        setting = "NA"

    n = rec.get("n")
    try:
        n = int(n) if n is not None and str(n).strip() != "" else None
    except (TypeError, ValueError):
        n = None
    # 参加者数として現実的でない値は捨てる。抄録中の別の数値(年・件数)を
    # 拾ってしまう誤りが起きうるため。
    if n is not None and not (0 < n < 100000):
        n = None

    markers = []
    for m in (rec.get("markers") or []):
        k = str(m).strip().lower()
        label = catalog.MARKER_LABELS.get(k)
        if label and label not in markers:
            markers.append(label)

    item["design_code"] = code
    item["design"] = catalog.DESIGN_LABELS[code]
    item["design_detail"] = str(rec.get("detail") or "").strip()[:20]
    item["participants_n"] = n
    item["setting"] = catalog.SETTING_LABELS[setting]
    item["population"] = str(rec.get("pop") or "").strip()[:30]
    item["quality_markers"] = markers


def extract_records(papers, topic, definition, model, retries=2) -> dict:
    """papers は (タイトル, 本文ラベル, 本文) の並び。{index: レコード} を返す。

    本文ラベルは抄録なら "Abstract"、全文由来なら Methods の抜粋である旨を
    書く(fulltext.py が使う)。読めなかった分は含まれない。items には書き込まない。
    """
    listing = "\n".join(f"{i}. {_flat(t)}\n   {label}: {_flat(body)}"
                        for i, (t, label, body) in enumerate(papers))
    prompt = EXTRACT_PROMPT.format(topic=topic, definition=definition,
                                   listing=listing)
    # 実測: 判定と同じく、件数を明示しないと最後の1件を書かずに配列を閉じる
    # (5件中4件、が再送しても続いた)。判定と同じ一文を付ける。
    prompt += _count_note(len(papers))
    schema = dict(EXTRACT_SCHEMA, minItems=len(papers), maxItems=len(papers))
    m = {}
    for attempt in range(retries + 1):
        raw, _used = llm.ask_fallback(prompt, model, schema=schema)
        if llm.is_error(raw):
            if "中断" not in raw:
                tqdm.write(f"  [!] 抽出の問い合わせが失敗: {raw[:160]}")
            return {}
        recs, mode = llm.parse_json_array(raw)
        m = llm.index_records(recs, len(papers))
        moved, dropped = _realign(m, [p[0] for p in papers])
        if moved or dropped:
            tqdm.write(f"  [i] 抽出と論文の番号がずれていました(付け替え {moved}件"
                       f" / 抽出し直し {dropped}件)。")
        if len(m) >= len(papers):
            return m
        if attempt < retries:
            tqdm.write(f"  [!] 抽出応答が{len(papers)}件中{len(m)}件しか読めない"
                       f"(mode={mode})。再送します ({attempt + 1}/{retries})")
        else:
            tqdm.write(f"  [!] 抽出に失敗(再送{retries}回も不完全): {raw[:200]!r}")
    return m


def _by_design(items) -> dict:
    return dict(Counter(it.get("design_code") or "NA" for it in items))


def annotate_features(items, topic, definition, model, checkpoint=None) -> dict:
    """items に design / participants_n / setting / population 等を書き込む。

    既に design_code が入っているものは飛ばす(--resume で再開できる)。
    戻り値は集計用の辞書。
    """
    size = config.EXTRACT_BATCH_SIZE
    pending = [it for it in items if not it.get("design_code")]
    if not pending:
        for it in items:
            _blank(it)
        return {"done": 0, "failed": 0, "by_design": _by_design(items)}

    batches = [pending[i:i + size] for i in range(0, len(pending), size)]
    done = 0

    def work(batch):
        papers = [(it.get("title", "Untitled"), "Abstract",
                   (it.get("content") or "")[:config.EXTRACT_EXCERPT_CHARS])
                  for it in batch]
        return extract_records(papers, topic, definition, model)

    def on_result(batch, m):
        nonlocal done
        for i, it in enumerate(batch):
            if m and i in m:
                apply_extraction(it, m[i])
                done += 1
            else:
                _blank(it)

    llm.run_parallel(work, batches, "設計を抽出中", on_result=on_result,
                     checkpoint=checkpoint,
                     checkpoint_every=config.JUDGE_CHECKPOINT_EVERY)

    for it in items:
        _blank(it)
    by_design = _by_design(items)
    failed = len(pending) - done
    print(f"   → 抽出 {done}件 / 失敗・不明 {failed}件")
    shown = " / ".join(f"{catalog.DESIGN_LABELS[c]} {by_design[c]}件"
                       for c in catalog.DESIGN_ORDER if by_design.get(c))
    if shown:
        print(f"   → 設計の内訳: {shown}")
    return {"done": done, "failed": failed, "by_design": by_design}


# ==========================================================================
# 4. 別モデルでの再判定(アンサンブル)
# ==========================================================================
# 本判定と同じプロンプト・分類規則で2本目のモデルに判定させ、分類が割れた
# 抄録を報告する。一致率と Cohen の κ(core / related / 除外相当 の3区分)も
# 出すので、2人の評定者の一致度と同じ読み方ができる。表にはタイトルと
# 両モデルの判定メモを載せ、読み直すべきかをその場で判断できるようにする。
EXCLUDED = "除外相当"     # 2本目のスコアが RELEVANCE_THRESHOLD 未満


def _bucket(cluster: str, score) -> str:
    """κの計算に使う3区分。off と閾値未満はまとめて「除外相当」。"""
    if cluster == "off" or (isinstance(score, int)
                            and score < config.RELEVANCE_THRESHOLD):
        return EXCLUDED
    return cluster


def _bias_note(bias: float, mean_gap) -> str:
    """スコアの差が一方向に偏っていれば、κ の読み方の注記を返す。

    実測: 2本目が42件中40件を「除外相当」とし、κ=-0.07 になった回がある。
    スコアの差は平均36点で、ほぼすべて2本目のほうが低かった。この場合の
    不一致は判定の揺れではなく、テーマの定義(除外条件)の当てはめ方の
    違いであり、見直すべきは個々の抄録より定義のほうになる。
    """
    if mean_gap is None or abs(bias) < config.ENSEMBLE_SCORE_GAP / 2 \
            or abs(bias) < mean_gap * 0.7:
        return ""
    who = "2本目" if bias > 0 else "1本目"
    return (f"スコアの差はほぼ一方向で、{who}のほうが一貫して厳しく付けています"
            f"(平均 {abs(bias):.1f}点)。κ の低さは判定の揺れというより、テーマの"
            "定義の当てはめ方の違いによる可能性があります。定義が文献の実態より"
            "狭くないか(除外条件が近い研究まで外していないか)を確かめてください。")


def cohen_kappa(pairs):
    """[(評定A, 評定B), ...] から Cohen の κ を返す。計算できなければ None。

    どちらかの評定が1種類しかないとき(例: 判定できた抄録の1本目がすべて
    related)、κ は一致の多少にかかわらず 0 に張り付き、「一致していない」と
    誤読される。実測で、core の抄録がすべて応答欠落になった回に κ=0.00 と
    出た。その場合は算出しない。
    """
    n = len(pairs)
    if not n:
        return None
    if len({a for a, _ in pairs}) < 2 or len({b for _, b in pairs}) < 2:
        return None
    cats = sorted({c for p in pairs for c in p})
    po = sum(1 for a, b in pairs if a == b) / n
    pe = sum((sum(1 for a, _ in pairs if a == c) / n)
             * (sum(1 for _, b in pairs if b == c) / n) for c in cats)
    if pe >= 1.0:
        return None
    return (po - pe) / (1 - pe)


def kappa_label(k) -> str:
    """Landis & Koch (1977) の目安。"""
    if k is None:
        return "算出不可"
    for lim, lab in ((0.0, "一致していない"), (0.20, "わずかに一致"),
                     (0.40, "まずまず一致"), (0.60, "中程度に一致"),
                     (0.80, "かなり一致")):
        if k <= lim:
            return lab
    return "ほぼ完全に一致"


def _ensemble_entries(theme: dict) -> tuple:
    """索引(JSON)とカタログ本文から判定対象を組み立てる。(索引, entries)"""
    idx = catalog.load_index(theme["index"])
    abstracts = (catalog.read_catalog_abstracts(theme["catalog"])
                 if theme["catalog"] else {})
    entries = []
    for key, rec in idx["items"].items():
        entries.append({
            "key": key, "title": rec.get("title") or "",
            "src": rec.get("src") or "",
            "content": abstracts.get(key, ""),
            "score_a": rec.get("score") if isinstance(rec.get("score"), int) else None,
            "cluster_a": (rec.get("cluster") or UNJUDGED).strip(),
            "reason_a": rec.get("reason") or "",
            "model_a": rec.get("judge_model") or "",
        })
    return idx, entries


def _second_pass(entries, topic, definition, hom, model, avoid) -> int:
    """再判定の3つ目のモデルで全件を判定し、score_c 等を書き込む。得られた件数を返す。

    代わりのモデルへの切り替えはしない(3つ目が止まったら、その分は報告に
    載せない。別のモデルが混ざると「別系統の2つ」でなくなる)。
    """
    size = config.FILTER_BATCH_SIZE
    batches = [entries[i:i + size] for i in range(0, len(entries), size)]

    def work(batch):
        return judge_batch(batch, topic, definition, hom, model,
                           max_tokens=config.ENSEMBLE_MAX_TOKENS, avoid=avoid,
                           order=())

    def on_result(batch, results):
        for e, r in zip(batch, results or []):
            if r and "error" not in r:
                e.update(score_c=r["score"], cluster_c=r["cluster"],
                         reason_c=r["reason"], model_c=r.get("model") or model)

    llm.run_parallel(work, batches, "確認の再判定中", on_result=on_result)
    return sum(1 for e in entries if "cluster_c" in e)


def run_ensemble(theme_arg: str, model: str = "", dry_run: bool = False,
                 preflight: bool = True) -> str:
    """アンサンブル判定を行い、報告ファイル(_ensemble__テーマ.md)のパスを返す。"""
    theme = catalog.resolve_theme(theme_arg)
    if not theme["index"]:
        raise FileNotFoundError(f"[index] …json が見つかりません: {theme['dir']}")
    idx, entries = _ensemble_entries(theme)
    topic = idx.get("topic") or theme["name"]
    definition = idx.get("theme_definition") or f"{topic} に関する研究"
    homonyms = idx.get("homonyms") or []
    explicit = bool(model)
    model = model or config.ENSEMBLE_MODEL
    order = config.fallback_models("ensemble")
    # 1本目の判定に使ったモデル(途中で切り替わっていれば複数)。2本目が
    # 代わりのモデルへ切り替わるときも、これらは使わない。
    first_pass = Counter(e["model_a"] for e in entries if e["model_a"])
    if not first_pass and idx.get("filter_model"):
        first_pass[idx["filter_model"]] = len(entries)
    model_a = catalog.models_label(first_pass) or "(記録なし)"
    if not explicit and model in first_pass:
        # 本判定が途中で ENSEMBLE_MODEL に切り替わっていた回。同じモデルで
        # 再判定しても意味がないので、再判定の順番で次のモデルにする。
        alt = llm.pick_model(model, avoid=set(first_pass), order=order)
        if alt:
            print(f"[アンサンブル] {model} は1本目の判定にも使われたため、"
                  f"{alt} で再判定します。")
            model = alt
    avoid = set(first_pass) - {model}

    print(f"[アンサンブル] テーマ: {theme['name']}")
    print(f"[アンサンブル] 対象 {len(entries)}件 / 1本目: {model_a} / 2本目: {model}")
    no_abs = sum(1 for e in entries if not e["content"])
    if no_abs:
        print(f"[警告] カタログ本文から抄録を読めなかった項目: {no_abs}件"
              "(タイトルだけで判定されます)")
    if model in first_pass:
        print("[警告] 1本目と同じモデルです。再判定の意味が薄れます。"
              "--model で別系統のモデルを指定してください。")
    if dry_run:
        for e in entries[:3]:
            print("-" * 40)
            print(f"key={e['key']} score={e['score_a']} cluster={e['cluster_a']}")
            print(f"title={e['title'][:80]}")
            print(e["content"][:200])
        print("\n[dry-run] APIは呼んでいません。")
        return ""
    if not entries:
        print("[アンサンブル] 対象がありません。")
        return ""
    if preflight:
        llm.preflight([model])

    hom = homonym_note(homonyms)
    size = config.FILTER_BATCH_SIZE
    batches = [entries[i:i + size] for i in range(0, len(entries), size)]

    def work(batch):
        return judge_batch(batch, topic, definition, hom, model,
                           max_tokens=config.ENSEMBLE_MAX_TOKENS, avoid=avoid,
                           order=order)

    def on_result(batch, results):
        for e, r in zip(batch, results or []):
            if r and "error" not in r:
                e.update(score_b=r["score"], cluster_b=r["cluster"],
                         reason_b=r["reason"], measured_b=r["measured"],
                         model_b=r.get("model") or model)

    llm.run_parallel(work, batches, "再判定中", on_result=on_result)

    # 欠落を一度だけやり直す。途中でモデルが切り替わった回は、切り替わる
    # 前に失敗したバッチが欠落のまま残る(実測: 52件中24件)ので切り替え先で。
    # 切り替わっていなければ、例文の写し・読めない応答で欠けた分なので、
    # 本判定の未判定の拾い直しと同じく少数ずつ送る。
    left = [e for e in entries if "cluster_b" not in e]
    now = llm.pick_model(model, avoid, order) if left else None
    if left and now:
        if now != model:
            print(f"\n[アンサンブル] 切り替え前に判定できなかった {len(left)}件を、"
                  f"{now} で判定し直します。")
        else:
            size = config.RESCUE_BATCH_SIZE
            print(f"\n[アンサンブル] 判定できなかった {len(left)}件を、"
                  f"{size}件ずつ判定し直します。")
        retry = [left[i:i + size] for i in range(0, len(left), size)]
        llm.run_parallel(work, retry, "再判定(やり直し)", on_result=on_result)

    got = sum(1 for e in entries if "cluster_b" in e)
    if got == 0:
        # 以前の結果ファイルを空の報告で上書きしないよう、何も書かずに終える
        print(f"[アンサンブル] {model} から1件も判定を得られませんでした。"
              "報告ファイルは書き出していません(前回の結果はそのまま残ります)。")
        print("    応答するモデルを確かめる: python research_bot.py probe")
        return ""
    if got < len(entries) / 2:
        print(f"[警告] 判定を得られたのは {got}/{len(entries)}件だけです。"
              "κ係数などは参考程度に見てください。")

    demote, promote, other, missing, pairs = [], [], [], [], []
    for e in entries:
        if "cluster_b" not in e:
            missing.append(e)
            continue
        a, b = e["cluster_a"], e["cluster_b"]
        e["gap"] = (abs(e["score_a"] - e["score_b"])
                    if e["score_a"] is not None else None)
        e["bucket_b"] = _bucket(b, e["score_b"])
        if a in ("core", "related"):
            pairs.append((a, e["bucket_b"]))
        if a == "core" and e["bucket_b"] == EXCLUDED:
            demote.append(e)
        elif a == "related" and b == "core":
            promote.append(e)
        elif a != e["bucket_b"] or (e["gap"] is not None
                                    and e["gap"] >= config.ENSEMBLE_SCORE_GAP):
            other.append(e)

    model_b = catalog.models_label(Counter(e["model_b"] for e in entries
                                           if e.get("model_b")))
    # 3つ目のモデル(--model を指定した比較のときは使わない)
    model_c, both = "", []
    m3 = config.ENSEMBLE_SECOND_MODEL
    if m3 and not explicit:
        used_b = {e["model_b"] for e in entries if e.get("model_b")}
        if m3 in first_pass or m3 in used_b:
            print(f"[アンサンブル] 3つ目のモデル {m3} は1本目か2本目で使われたため、"
                  "3つ目の判定は行いません。")
        else:
            print(f"\n[アンサンブル] 3つ目のモデル {m3} でも判定します...")
            got3 = _second_pass(entries, topic, definition, hom, m3,
                                avoid=set(first_pass) | used_b | {model})
            if got3:
                model_c = catalog.models_label(Counter(
                    e["model_c"] for e in entries if e.get("model_c")))
                both = [e for e in entries
                        if "cluster_c" in e and e.get("bucket_b") == EXCLUDED
                        and _bucket(e["cluster_c"], e["score_c"]) == EXCLUDED]
            else:
                print(f"[警告] {m3} から判定を得られなかったため、3つ目の判定は"
                      "報告に載せません。")
    agree = sum(1 for a, b in pairs if a == b)
    kappa = cohen_kappa(pairs)
    gaps = [e["gap"] for e in entries if e.get("gap") is not None]
    mean_gap = sum(gaps) / len(gaps) if gaps else None
    signed = [e["score_a"] - e["score_b"] for e in entries
              if e.get("gap") is not None]
    bias = sum(signed) / len(signed) if signed else 0.0
    bias_note = _bias_note(bias, mean_gap)

    out_path = os.path.join(theme["dir"], f"_ensemble__{theme['name']}.md")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("---\n")
        f.write(f"catalog_source: \"{os.path.basename(theme['catalog'] or '')}\"\n")
        f.write(f"model_a: \"{model_a}\"\nmodel_b: \"{model_b}\"\n")
        if model_c:
            f.write(f"model_c: \"{model_c}\"\n")
        f.write(f"checked_at: {datetime.datetime.now().isoformat(timespec='seconds')}\n")
        f.write(f"kappa: {round(kappa, 3) if kappa is not None else 'null'}\n")
        f.write("---\n\n")
        f.write(f"# 判定アンサンブル結果 — {theme['name']}\n\n")
        f.write(f"- 対象抄録: {len(entries)}件 / 2本目の判定取得: "
                f"{len(entries) - len(missing)}件 / 応答欠落: {len(missing)}件\n")
        if pairs:
            line = f"- 分類の一致: {agree}/{len(pairs)}件({agree / len(pairs):.1%})"
            if kappa is not None:
                line += f" / Cohen の κ = {kappa:.2f}({kappa_label(kappa)})"
            else:
                line += (" / κ は算出不可(どちらかの判定が1種類だけ。"
                         "応答欠落が多い回に起きやすい)")
            f.write(line + "\n")
        if mean_gap is not None:
            side = ("方向の偏りなし" if abs(bias) < 1 else
                    f"2本目のほうが平均 {abs(bias):.1f}点{'低い' if bias > 0 else '高い'}")
            f.write(f"- 関連度スコアの差: 平均 {mean_gap:.1f}点({side})\n")
        f.write(f"- 判定モデル: 1本目 {model_a} / 2本目 {model_b}"
                + (f" / 3本目 {model_c}" if model_c else "") + "\n")
        f.write(f"- 判定基準: 両モデルとも同じプロンプト(関連度{config.CORE_SCORE}以上"
                "かつ実測あり→core、関連度"
                f"{config.RELEVANCE_THRESHOLD}未満→除外相当)\n\n")
        if bias_note:
            f.write(f"> [!note] 判定の厳しさの違い\n> {bias_note}\n\n")
        f.write("> [!warning] 不一致は誤りの証拠ではなく、抄録を読み直すべき"
                "箇所の手がかりです。どちらのモデルも「正解」ではありません。\n\n")

        def dump(rows, title, note):
            f.write(f"## {title}({len(rows)}件)\n\n{note}\n\n")
            if not rows:
                f.write("なし。\n\n")
                return
            f.write("| 引用キー | 1本目 | 2本目 | 1本目のメモ | 2本目のメモ | タイトル |\n")
            f.write("|---|---|---|---|---|---|\n")
            for e in sorted(rows, key=lambda x: -(x.get("gap") or 0)):
                t = catalog.cell(e["title"], 50)
                ra = catalog.cell(e["reason_a"] or "-", 40)
                rb = catalog.cell(e.get("reason_b") or "-", 40)
                sa = e["score_a"] if e["score_a"] is not None else "-"
                f.write(f"| [{e['key']}] | {e['cluster_a']} {sa} "
                        f"| {e['bucket_b']} {e['score_b']} | {ra} | {rb} | {t} |\n")
            f.write("\n")

        sec = 0

        def num(title):
            nonlocal sec
            sec += 1
            return f"{sec}. {title}"

        if model_c:
            f.write(f"## {num('最優先: 別系統の2つのモデルが、どちらも除外相当と判定')}"
                    f"({len(both)}件)\n\n"
                    "1本目は残したのに、2本目と3本目が共に除外相当と判定した抄録。"
                    "主題と無関係なものが多いが、同じ介入を別の対象で行った近縁の"
                    "研究も含まれる。抄録を読み、無関係なら対象外、近縁なら周辺の"
                    "補助根拠とする。\n\n")
            if not both:
                f.write("なし。\n\n")
            else:
                f.write("| 引用キー | 1本目 | 2本目 | 3本目 | 1本目のメモ | "
                        "3本目のメモ | タイトル |\n|---|---|---|---|---|---|---|\n")
                for e in sorted(both, key=lambda x: -(x.get("score_a") or 0)):
                    sa = e["score_a"] if e["score_a"] is not None else "-"
                    f.write(f"| [{e['key']}] | {e['cluster_a']} {sa} "
                            f"| {e['score_b']} | {e['score_c']} "
                            f"| {catalog.cell(e['reason_a'] or '-', 40)} "
                            f"| {catalog.cell(e.get('reason_c') or '-', 40)} "
                            f"| {catalog.cell(e['title'], 50)} |\n")
                f.write("\n")
        dump(demote, num("中心クラスタからの除外候補"),
             "1本目は core、2本目は無関係または関連度不足と判定した抄録。"
             "中心的な根拠に使う前に抄録を読み直す。")
        dump(promote, num("中心クラスタへの昇格候補"),
             "1本目は related、2本目は core と判定した抄録。"
             "測定を伴う研究だと確認できたものだけを主要な根拠に加える。")
        dump(other, num("その他の不一致"),
             f"周辺クラスタからの除外候補、およびスコア差"
             f"{config.ENSEMBLE_SCORE_GAP}点以上の不一致。")
        f.write(f"## {num('応答が得られなかった抄録')}\n\n")
        if not missing:
            f.write("なし。\n")
        for e in missing:
            f.write(f"- [{e['key']}](1本目: {e['cluster_a']})\n")

    print(f"[アンサンブル] 出力: {out_path}")
    if kappa is not None:
        print(f"[アンサンブル] 一致率 {agree}/{len(pairs)} / κ={kappa:.2f}"
              f"({kappa_label(kappa)})")
    elif pairs:
        print(f"[アンサンブル] 一致率 {agree}/{len(pairs)} / κ は算出不可"
              "(どちらかの判定が1種類だけ)")
    if bias_note:
        print(f"[アンサンブル] {bias_note}")
    if model_c:
        print(f"[アンサンブル] 別系統の2つが両方とも除外相当: {len(both)}件 ← 最優先で確認")
    print(f"[アンサンブル] 除外候補(core→除外相当) {len(demote)}件 ← 最優先で確認 / "
          f"昇格候補 {len(promote)}件 / その他 {len(other)}件 / 欠落 {len(missing)}件")
    return out_path
