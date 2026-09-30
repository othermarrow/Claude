"""関連度とクラスタの判定。

research_bot.py(本判定)と ensemble_check.py(別モデルでの再判定)の
両方がここを使う。以前の ensemble_check.py は独自のプロンプトで
core/related/off を直接選ばせていたが、それは本判定側で「core が9割に
膨らんだ」ためにやめた方式だった。プロンプトが違うと、不一致の多くが
モデルの差ではなくプロンプトの差から生じ、再判定の意味が薄れる。
同じプロンプト・同じ分類規則で判定させ、違いをモデルだけにする。

判定結果の形(1件ぶん):
  {"score": 0-100, "measured": True/False/None, "reason": str, "cluster": str}
cluster は score と measured から classify() で機械的に決める。
"""

import config
import jsonparse
import llm
from tqdm import tqdm

FILTER_PROMPT = """You are an expert in academic literature review.

[Research theme] {topic}
[Definition of the theme] {definition}
{homonym_note}
[Candidate papers]
{listing}

[Judgment criteria]
For each paper, judge both a relevance score (0-100) and measured (boolean).

Guide to the relevance score:
90-100: the paper's main subject is the exact target/method the theme's
        definition refers to
60-89 : addresses the same broader concept or an adjacent area, but the
        target itself is not the main subject
21-59 : some relevance but weak, or the target is somewhat off
0-20  : unrelated, or a same-name/same-spelling but different concept

A theme is normally an intersection of conditions, not a single keyword.
Read the definition and identify every condition it states — the
phenomenon, the population, and the setting or context. A paper reaches
90-100 only when its main subject covers that whole intersection. A paper
about the phenomenon in general, or about it in a population the definition
does not cover, belongs in 60-89 however central the phenomenon is to that
paper, and however often the keyword appears in it. For a theme about
transference between abused people with intellectual disabilities and their
support workers, a general overview of transference-focused psychotherapy
is 60-89, not 95. Score the intersection, not the keyword.

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
form "同名異義語: 〇〇". Any paper whose content falls outside psychology,
welfare, medicine, and education scores 20 or below.

[Output]
Output only the following JSON array. You must output exactly one entry for
every paper, with no omissions. Write the reason field in Japanese, briefly
(under 40 characters). Leave it empty when there is nothing to note.
[{{"index": 0, "score": 95, "measured": true, "reason": ""}},
 {{"index": 1, "score": 85, "measured": false, "reason": "導入で言及するのみ"}},
 {{"index": 2, "score": 10, "measured": false, "reason": "同名異義語: 運動機能評価尺度"}}]"""

# guided_json(config.USE_GUIDED_JSON)を使うときのスキーマ
FILTER_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "index": {"type": "integer"},
            "score": {"type": "integer", "minimum": 0, "maximum": 100},
            "measured": {"type": "boolean"},
            "reason": {"type": "string"},
        },
        "required": ["index", "score", "measured", "reason"],
    },
}

UNJUDGED = "未判定"


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


def _listing(batch) -> str:
    return "\n".join(
        f"{i}. [{it.get('src', '')}] {it.get('title', 'Untitled')}\n"
        f"   Abstract: {(it.get('content') or '')[:config.FILTER_EXCERPT_CHARS]}"
        for i, it in enumerate(batch))


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
    return (f"\n\nThere are exactly {n} candidate papers (index 0 to {n - 1}). "
            f"Your array must contain exactly {n} entries.")


def judge_batch(batch, topic, definition, hom, model, max_tokens=None):
    """1バッチを判定し、batch と同じ長さのリストを返す。

    要素は判定結果の辞書、または判定できなかった場合の
    {"error": 理由} 。items には書き込まない(書き込みは呼び出し側が
    メインスレッドで行う)。
    """
    prompt = FILTER_PROMPT.format(topic=topic, definition=definition,
                                  homonym_note=hom, listing=_listing(batch))
    prompt += _count_note(len(batch))
    # guided_json を使う場合にも件数を強制する(使わない場合は無害)
    schema = dict(FILTER_SCHEMA, minItems=len(batch), maxItems=len(batch))
    raw = ""
    for attempt in range(config.JUDGE_BATCH_RETRIES + 1):
        raw = llm.ask(prompt, model, schema=schema, max_tokens=max_tokens)
        if llm.is_error(raw):
            # ask は内部で再試行を済ませている。ここで再送しても同じ失敗を
            # 重ねるだけなので打ち切る。
            if "中断" not in raw:
                tqdm.write(f"  [!] AIへの問い合わせ自体が失敗しました"
                           f"(このバッチ{len(batch)}件は未判定): {raw[:160]}")
            return [{"error": "判定失敗(AIへの問い合わせが失敗)"}] * len(batch)
        recs, mode = jsonparse.parse_json_array(raw)
        m = jsonparse.index_records(recs, len(batch))
        if m and (len(m) >= len(batch) or attempt >= config.JUDGE_BATCH_RETRIES):
            if mode != "strict":
                tqdm.write(f"  [i] 応答に余分な出力があったため先頭のJSONだけ"
                           f"使いました(mode={mode} / {len(m)}件)")
            return [(_coerce(m[i]) if i in m
                     else {"error": "判定失敗(応答に該当indexなし)"})
                    for i in range(len(batch))]
        if attempt < config.JUDGE_BATCH_RETRIES:
            why = (f"{len(batch)}件中{len(m)}件しか読めない" if m
                   else "JSONとして読める部分が無い")
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
                measured=res["measured"], exclusion_reason=res["reason"])


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


def rebalance_clusters(kept) -> str:
    """core が少なすぎるとき、最高スコア帯を中心として扱う。戻り値は注記。

    判定の手引きに「テーマの交差を満たす文献だけが90点以上」と明記して
    以降、交差が薄いテーマでは90点が空集合になりうる(実測で47件すべてが
    related になった)。core が CORE_MIN_ITEMS 件未満のときだけ、最高スコア
    から順に帯を広げる。基準を変えた事実は注記としてカタログに明記する。
    """
    scored = [it for it in kept if it.get("relevance_score") is not None]
    if not scored:
        return ""
    core_now = sum(1 for it in kept if it.get("cluster") == "core")
    if core_now >= config.CORE_MIN_ITEMS:
        return ""
    levels = sorted({it["relevance_score"] for it in scored}, reverse=True)
    cut, n = levels[0], 0
    for lv in levels:
        n = sum(1 for it in scored if it["relevance_score"] >= lv)
        cut = lv
        if n >= config.CORE_MIN_ITEMS:
            break
    if n <= core_now:
        return ""
    for it in scored:
        if it["relevance_score"] >= cut:
            it["cluster"] = "core"
    reason = (f"関連度{config.CORE_SCORE}以上の文献が1件も無かった" if core_now == 0
              else f"本来の基準(関連度{config.CORE_SCORE}以上かつ実測あり)を満たす"
                   f"文献が{core_now}件しか無かった")
    note = (f"{reason}ため、最高スコア帯({cut}点以上・{n}件)を"
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
