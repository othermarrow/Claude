"""採用された抄録から研究設計・参加者・場面・質指標を抽出する。

関連度判定(judge.py の FILTER_PROMPT)とは別のパスにしている。
判定側に項目を足すと1応答あたりのJSONが長くなり、苦労して抑えた
「正しい形式のJSONが途中で切れる」問題が再発する。抽出は関連度判定を
通った抄録だけが対象なので件数が数分の一に減り、失敗しても欄が空に
なるだけで文献そのものは失われない。

抽出する項目は、心理・福祉領域で「その知見をどれだけ強く受け取って
よいか」を決めるものに絞っている。

  design  研究設計。応用行動分析では単一事例実験が主流で、群間比較と
          同列には扱えない。設計が分からないとレビューの重みづけが
          できず、「core 41件」の中身が読めない。
  n       参加者数。単一事例では1〜5名が普通で、一般化の限界に直結する。
  setting 場面。入所施設で得られた知見か、学校か、研究室か。日本の
          生活施設に移せるかどうかを判断する材料になる。
  markers 質指標(WWCの単一事例基準の考え方)。ベースライン・観察者間
          一致率・手続きの整合性・般化・維持・社会的妥当性など。
          「実施したか」ではなく「抄録に明記されているか」だけを記録する。
          抄録は紙幅の都合で省略されることが多く、記載が無いことは
          実施していないことを意味しないため。この区別を崩すと、
          カタログが「抄録に書かれていないことは書かない」という
          原則から外れてしまう。
"""

from tqdm import tqdm

import config
import jsonparse
import llm

# 抄録に渡す文字数。関連度判定(900字)より広く取る。設計・参加者・
# 質指標は方法と結果の記述に現れるため、導入部だけでは判断できない。
EXCERPT_CHARS = 1200

# モデルには英語コードを書かせ、日本語ラベルはコード側で与える。
# 自由記述の日本語ラベルを書かせると表記が揺れて集計できなくなる。
DESIGN_LABELS = {
    "SR": "系統的レビュー・メタ分析",
    "RCT": "ランダム化比較試験",
    "QE": "非ランダム化群間比較",
    "SCED": "単一事例実験",
    "PP": "単群前後比較",
    "OBS": "観察・横断・相関",
    "PSY": "心理測定・尺度研究",
    "QUAL": "質的研究",
    "CASE": "事例報告",
    "REV": "総説・解説",
    "THEO": "理論・概念",
    "GUIDE": "ガイドライン・行政資料",
    "NA": "不明",
}

SETTING_LABELS = {
    "RESIDENTIAL": "入所施設",
    "DAY": "通所・日中活動",
    "SCHOOL": "学校・教育機関",
    "HOME": "家庭",
    "CLINIC": "医療機関",
    "LAB": "研究室・実験場面",
    "COMMUNITY": "地域・その他",
    "NA": "不明",
}

MARKER_LABELS = {
    "baseline": "ベースライン",
    "ioa": "観察者間一致率",
    "fidelity": "手続きの整合性",
    "generalization": "般化",
    "maintenance": "維持",
    "social": "社会的妥当性",
    "random": "無作為割付",
    "effect": "効果量",
}

# 集計・表示の並び順。エビデンスの強さの一般的な順に近づけてある。
DESIGN_ORDER = ["SR", "RCT", "QE", "SCED", "PP", "OBS", "PSY", "QUAL",
                "CASE", "REV", "THEO", "GUIDE", "NA"]

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

[Output]
Output only the following JSON array. Exactly one entry per paper, no
omissions, no explanatory text, no code fences.
[{{"index": 0, "design": "SCED", "detail": "多層ベースライン", "n": 3,
  "setting": "SCHOOL", "pop": "自閉症児(5〜8歳)",
  "markers": ["baseline", "ioa", "maintenance"]}},
 {{"index": 1, "design": "SR", "detail": "メタ分析", "n": null,
  "setting": "NA", "pop": "", "markers": ["effect"]}}]"""


def _blank(item):
    """抽出できなかった項目に入れる既定値。欄が空になるだけで内容は失わない。"""
    item.setdefault("design_code", "NA")
    item.setdefault("design", DESIGN_LABELS["NA"])
    item.setdefault("design_detail", "")
    item.setdefault("participants_n", None)
    item.setdefault("setting", SETTING_LABELS["NA"])
    item.setdefault("population", "")
    item.setdefault("quality_markers", [])


def _apply(item, rec):
    code = str(rec.get("design") or "NA").strip().upper()
    if code not in DESIGN_LABELS:
        code = "NA"
    setting = str(rec.get("setting") or "NA").strip().upper()
    if setting not in SETTING_LABELS:
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
        if k in MARKER_LABELS and MARKER_LABELS[k] not in markers:
            markers.append(MARKER_LABELS[k])

    item["design_code"] = code
    item["design"] = DESIGN_LABELS[code]
    item["design_detail"] = str(rec.get("detail") or "").strip()[:20]
    item["participants_n"] = n
    item["setting"] = SETTING_LABELS[setting]
    item["population"] = str(rec.get("pop") or "").strip()[:30]
    item["quality_markers"] = markers


EXTRACT_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {
            "index": {"type": "integer"},
            "design": {"type": "string", "enum": list(DESIGN_LABELS)},
            "detail": {"type": "string"},
            "n": {"type": ["integer", "null"]},
            "setting": {"type": "string", "enum": list(SETTING_LABELS)},
            "pop": {"type": "string"},
            "markers": {"type": "array",
                        "items": {"type": "string", "enum": list(MARKER_LABELS)}},
        },
        "required": ["index", "design", "n", "setting", "markers"],
    },
}


def build_prompt(topic, definition, papers) -> str:
    """papers は (タイトル, 本文ラベル, 本文) の並び。

    本文ラベルは抄録なら "Abstract"、全文由来なら Methods の抜粋である旨を
    書く(fulltext.py が使う)。
    """
    listing = "\n".join(f"{i}. {t}\n   {label}: {body}"
                        for i, (t, label, body) in enumerate(papers))
    return EXTRACT_PROMPT.format(topic=topic, definition=definition,
                                 listing=listing)


def extract_records(papers, topic, definition, model, retries=2) -> dict:
    """papers(build_prompt と同じ形)の抽出結果を {index: レコード} で返す。

    読めなかった分は含まれない。items には書き込まない。
    """
    prompt = build_prompt(topic, definition, papers)
    m = {}
    for attempt in range(retries + 1):
        raw = llm.ask(prompt, model, schema=EXTRACT_SCHEMA)
        if llm.is_error(raw):
            if "中断" not in raw:
                tqdm.write(f"  [!] 抽出の問い合わせが失敗: {raw[:160]}")
            return {}
        recs, mode = jsonparse.parse_json_array(raw)
        m = jsonparse.index_records(recs, len(papers))
        if len(m) >= len(papers):
            return m
        if attempt < retries:
            tqdm.write(f"  [!] 抽出応答が{len(papers)}件中{len(m)}件しか読めない"
                       f"(mode={mode})。再送します ({attempt + 1}/{retries})")
        else:
            tqdm.write(f"  [!] 抽出に失敗(再送{retries}回も不完全): {raw[:200]!r}")
    return m


def annotate_features(items, topic, definition, model,
                      batch_size=None, retries=2, checkpoint=None):
    """items に design / participants_n / setting / population 等を書き込む。

    既に design_code が入っているものは飛ばす(--resume で再開できる)。
    戻り値は集計用の辞書。
    """
    batch_size = batch_size or config.EXTRACT_BATCH_SIZE
    pending = [it for it in items if not it.get("design_code")]
    if not pending:
        for it in items:
            _blank(it)
        return {"done": 0, "failed": 0, "by_design": _by_design(items)}

    batches = [pending[i:i + batch_size] for i in range(0, len(pending), batch_size)]
    done = 0

    def work(batch):
        papers = [(it.get("title", "Untitled"), "Abstract",
                   (it.get("content") or "")[:EXCERPT_CHARS]) for it in batch]
        return extract_records(papers, topic, definition, model, retries)

    def on_result(batch, m):
        nonlocal done
        for i, it in enumerate(batch):
            if m and i in m:
                _apply(it, m[i])
                done += 1
            else:
                _blank(it)

    llm.run_parallel(work, batches, "設計を抽出中", on_result=on_result,
                     checkpoint=checkpoint, checkpoint_every=20)

    for it in items:
        _blank(it)
    by_design = _by_design(items)
    failed = len(pending) - done
    print(f"   → 抽出 {done}件 / 失敗・不明 {failed}件")
    shown = " / ".join(f"{DESIGN_LABELS[c]} {by_design[c]}件"
                       for c in DESIGN_ORDER if by_design.get(c))
    if shown:
        print(f"   → 設計の内訳: {shown}")
    return {"done": done, "failed": failed, "by_design": by_design}


def _by_design(items) -> dict:
    out = {}
    for it in items:
        c = it.get("design_code") or "NA"
        out[c] = out.get(c, 0) + 1
    return out
