"""自由記述のテーマ文から、データベース別の検索式を組み立てる。

設計の要点:
  LLMにブール検索式そのものを書かせない。LLM生成のブール式は人手の検索式より
  再現率が落ちること、過度に限定的な制約を紛れ込ませてヒットを潰すことが
  知られている。そこでLLMの役割は「ファセット抽出と同義語展開」に限定し、
  演算子の組み立てとDB別の構文変換はコード側で決定論的に行う。

ファセットの枠組み:
  PCC    Population / Concept / Context   横断的レビュー(既定)
  PICO   Population / Intervention / Comparison / Outcome  介入効果
  SPIDER Sample / Phenomenon / Design / Evaluation  当事者や職員の体験

同名異義語(MAS = Motivation Assessment Scale / Motor Assessment Scale 等)は
NOT で消すのではなく、フルスペル併記と文脈語ANDで抑える。NOTは、除外語を
含みつつ関連する文献まで落とすため再現率を下げる。

組み込みの同義語辞書(BUILTIN_SYNONYMS)と、検索式に使うファセット数・
日本語DBの検索回数の上限は config.py にある。
"""

import json
import re

import config

# 測定特性(信頼性・妥当性)を扱う研究を拾うためのフィルタ。
# COSMIN の考え方に沿った簡易版で、尺度・アセスメント道具が主題のときに足す。
PSYCHOMETRIC_FILTER = [
    "reliability", "validity", "psychometric", "measurement propert*",
    "internal consistency", "interrater", "test-retest", "factor structure",
]

# 研究デザイン語。介入効果を問うテーマのときに足す。
DESIGN_FILTER = [
    "randomized", "controlled trial", "single case", "single subject",
    "multiple baseline", "intervention study", "quasi-experimental",
]

FACET_PROMPT = """You are an information specialist who designs search strategies for
systematic reviews. Read the research theme below and break it down into
facets (clusters of concepts) for use in search.

[Research theme (free-text description from the user)]
{topic}

[Steps]
1. Decide which framework best fits this theme.
   PCC   : a cross-cutting review surveying the breadth of a concept
           (default — use this when in doubt)
   PICO  : asks about the effect of a specific intervention
   SPIDER: asks about the lived experience of the person concerned or of
           supporters, or qualitative research
2. Extract facets that follow the chosen framework. Use 2-4 facets.
   Too many facets starves the result count when AND-combined.
   Order them so that facet 1 is the concept the theme is actually asking
   about — the phenomenon, construct, intervention, or measure under study
   — and not the population it happens to occur in. Only the first
   {max_facets} facets are used to build the search, so a core concept placed
   after them is never searched at all. For "transference between abused people with
   intellectual disabilities and their support workers", facet 1 is
   transference, not intellectual disability. Put the population later.
3. For each facet, list 5-10 English synonyms/related terms.
   - For facet 1, also include the broader parent concept and its close
     variants, not only the exact narrow form the theme names. Direct
     evidence on a narrow variant is usually scarce, and the reader needs
     the nearest evidence. For a weekly visual schedule: visual schedule,
     activity schedule, picture schedule, picture prompt. A search limited
     to "weekly schedule" misses the whole activity-schedule literature.
   - Include both controlled-vocabulary terms (the kind you would expect in
     MeSH or the ERIC thesaurus) and free-text terms
   - Give an abbreviation together with its full spelled-out form (e.g.,
     FBA and functional behavior assessment), but only when it has three or
     more letters. Never list a one- or two-letter abbreviation such as ID:
     it also matches identity, identifier and many unrelated papers.
   - For a population, list the group the theme names, its synonyms, and
     its obsolete names. Do not add a broader category that mostly covers
     other conditions: for intellectual disability, "neurodevelopmental
     disorders" is mostly autism and ADHD. Add such a category only when the
     theme itself names it.
   - Search terms are for what the theme includes. Do not add terms for
     something the theme places outside it.
   - Terms in one facet are joined with OR. Do not put an age word (adult,
     adults, children, 成人) alone into a facet that names a condition:
     "adult" OR "intellectual disability" matches every study of adults,
     whatever the condition. Write it as a phrase (adults with intellectual
     disability) or leave the age restriction to the definition.
   - When the facet names a population, a disorder, or a diagnosis, include
     the terms that were standard in earlier editions of the diagnostic
     manuals and are now obsolete. A search for intellectual disability
     that omits "mental retardation" loses most of the literature published
     before 2013; one for autism that omits "Asperger" and "pervasive
     developmental disorder" loses the whole DSM-IV era. Historical terms
     may read as offensive today, but they are what the older papers are
     indexed under, so they must be in the search.
   - Do not use the truncation wildcard (*). Some databases treat
     "disabilit*" as the literal fragment "disabilit" and return zero hits.
     Instead spell out the singular, plural, US/UK spelling, and derived
     forms separately (e.g., behavior, behaviors, behavioral, behaviour,
     behavioural).
4. For each facet, list 2-5 Japanese synonyms. Write these in Japanese —
   they are used as-is against Japanese-language databases. Apply the same
   rule about obsolete terminology here: 知的障害 also needs 精神遅滞 and
   精神薄弱; 自閉スペクトラム症 also needs 広汎性発達障害 and
   アスペルガー症候群. Japanese usage differs from English here: 学習障害
   means a specific learning disorder (LD), and 発達障害 mostly means
   autism, ADHD and LD. Neither is a synonym of 知的障害 (the English
   "learning disability", the UK term for intellectual disability, does
   belong in the English list).
5. For each facet, list 0-3 candidate MeSH headings (the controlled
   vocabulary of PubMed) in the "mesh" array, written exactly as MeSH
   spells them (e.g. "Intellectual Disability", "Self-Injurious Behavior",
   "Behavior Therapy"). Every candidate is checked against PubMed before
   use and unknown headings are discarded, so a wrong guess is not fatal —
   but do not pad the list. An empty array is better than an invented
   heading.
6. If the theme's core concept shares a spelling or abbreviation with an
   unrelated concept in another field, list it. Example: in addition to the
   Motivation Assessment Scale, MAS is also used for the Motor Assessment
   Scale and the Modified Ashworth Scale. Use an empty array if none apply.
7. Set psychometric to true if the theme concerns a scale or assessment
   instrument itself; set intervention to true if it concerns the effect of
   a specific intervention. Both may be false.
8. Define in 1-2 sentences, in Japanese, what this theme refers to: its
   center. Write what the theme is, not lists of what it is not. The
   definition is handed to the relevance judge. Do not add
   exclusion rules — not for a broader or narrower population (e.g.
   intellectual disability in general, with no separate data for the
   severe group), another setting, or a close variant (e.g. a daily or
   activity schedule when the theme names a weekly one). When direct
   evidence is scarce those studies are what the reader needs, and the
   judge scores them as adjacent evidence. The one exception: if there are
   same-name/same-spelling concepts, state explicitly which one this theme
   is about and which ones it is not.

[Output]
Output only the following JSON. No explanatory text and no code-block
formatting.
{{
  "framework": "PCC",
  "definition": "Definition of what this theme refers to, in Japanese, including how it is distinguished from any same-name/same-spelling concepts.",
  "anchor_en": "core concept, in English",
  "anchor_ja": "core concept, in Japanese",
  "facets": [
    {{"name": "the facet's role (e.g. Population)",
      "en": ["synonym1", "synonym2"],
      "ja": ["Japanese synonym 1", "Japanese synonym 2"],
      "mesh": ["Intellectual Disability"]}}
  ],
  "homonyms": ["list any same-name concepts from other fields, if any"],
  "psychometric": false,
  "intervention": false
}}"""


def facet_prompt(topic: str) -> str:
    """ファセット抽出の問い合わせ文。"""
    return FACET_PROMPT.format(topic=topic, max_facets=config.MAX_FACETS)


def _anchor_score(facet: dict, anchor_en: str, anchor_ja: str) -> int:
    """ファセットがテーマの中心概念をどれだけ含むかを大まかに測る。"""
    ae = (anchor_en or "").strip().lower()
    aj = (anchor_ja or "").strip()
    score = 0
    for t in (facet.get("en") or []):
        tl = t.strip().lower()
        if not tl or not ae:
            continue
        if tl == ae:
            score += 3
        elif len(tl) >= 5 and (tl in ae or ae in tl):
            score += 2
    for t in (facet.get("ja") or []):
        if not aj or not t:
            continue
        if t == aj:
            score += 3
        elif len(t) >= 2 and (t in aj or aj in t):
            score += 2
    return score


def _reorder_by_anchor(facets: list, anchor_en: str, anchor_ja: str) -> list:
    """中心概念を含むファセットを先頭へ移す。

    LLMは枠組みの名前の順(PCCならPopulationが先)にファセットを並べる
    ことが多く、テーマの中心概念が3番目・4番目に来ることがある。
    build_queries は先頭 MAX_FACETS 件しか使わないため、中心概念がその後ろに
    置かれるとその語が一度も検索されない。実測で、投影・転移を主題とするテーマの
    検索式から当該語が丸ごと抜け落ちた(2340件を集めてcore判定0件)。
    anchorと一致する語を持つファセットが無ければ、順序は変えない。
    """
    if len(facets) < 2:
        return facets
    scored = [(_anchor_score(f, anchor_en, anchor_ja), i) for i, f in enumerate(facets)]
    best_score, idx = max(scored)
    if best_score <= 0 or idx == 0:
        return facets
    return [facets[idx]] + [f for i, f in enumerate(facets) if i != idx]


def _facet_matches(facet: dict, key: str, syns: list) -> bool:
    """このファセットが組み込み同義語のキーと同じ概念を指しているか。

    英語側は部分一致も見る(intellectual disability と intellectual
    disabilities のような揺れを拾うため)。短い語での偶然の一致を避けるため、
    部分一致は双方6文字以上のときだけ認める。日本語側はキーがファセットの
    日本語語彙に現れるかで見る。
    """
    en_low = [x.lower() for x in (facet.get("en") or [])]
    for s in syns:
        sl = s.lower()
        for e in en_low:
            if sl == e:
                return True
            if len(sl) >= 6 and len(e) >= 6 and (sl in e or e in sl):
                return True
    return any(key in j for j in (facet.get("ja") or []))


_THINK_RE = re.compile(r"<think>.*?</think>", re.S | re.I)


def extract_plan_json(raw: str) -> dict:
    """応答から計画の JSON を取り出す。見つからなければ空の辞書。

    以前は最初の { から最後の } までを1つの JSON として読んでいた。思考させた
    応答では、本文の前に思考(<think>…</think> や、形式を検討する文に含まれる
    { })が混ざることがあり、そこから読み始めると全体が壊れていた。
    ここでは { の位置ごとに JSON として読める範囲を試し、facets を持つ最初の
    オブジェクトを使う。末尾の余計なカンマ({"a": 1,})も直してから読む。
    """
    s = re.sub(r"```(?:json)?", "", raw or "")
    s = _THINK_RE.sub("", s)
    if "</think>" in s.lower():
        s = s[s.lower().rindex("</think>") + len("</think>"):]
    s = s.strip()
    dec = json.JSONDecoder()
    for text in (s, re.sub(r",\s*([}\]])", r"\1", s)):
        try:
            v = json.loads(text)
            if isinstance(v, dict) and v.get("facets"):
                return v
        except ValueError:
            pass
        for m in re.finditer(r"\{", text):
            try:
                v, _ = dec.raw_decode(text, m.start())
            except ValueError:
                continue
            if isinstance(v, dict) and isinstance(v.get("facets"), list):
                return v
    return {}


def is_degenerate(plan: dict, topic: str) -> bool:
    """応答を読めず、テーマ文だけの1ファセットに縮退した計画か。"""
    f = plan.get("facets") or []
    return len(f) == 1 and f[0].get("name") == "topic" and topic in (f[0].get("en") or [])


def parse_facet_response(raw: str, topic: str) -> dict:
    """LLM応答をファセット計画に変換する。壊れていてもテーマ文だけで動かす。"""
    plan = extract_plan_json(raw)

    facets = []
    for f in plan.get("facets") or []:
        en = [str(x).strip() for x in (f.get("en") or []) if str(x).strip()]
        ja = [str(x).strip() for x in (f.get("ja") or []) if str(x).strip()]
        mesh = [str(x).strip() for x in (f.get("mesh") or []) if str(x).strip()]
        if en or ja:
            facets.append({"name": f.get("name") or "facet", "en": en,
                           "ja": ja, "mesh": mesh})

    # 組み込みの同義語(config.BUILTIN_SYNONYMS)で下支えする。LLMの展開が
    # 薄いときの保険。以前は英語の完全一致でしか発火せず、LLMが複数形や
    # 英国綴りで出すと旧診断名を足せないまま終わっていた。
    for key, syns in config.BUILTIN_SYNONYMS.items():
        if key not in topic:
            continue
        target = next((f for f in facets if _facet_matches(f, key, syns["en"])),
                      None)
        if target is None:
            # どのファセットの概念か決められない場合は何も足さない。
            # 取り違えて足すとAND条件が緩み、精度が落ちる。
            continue
        low = [x.lower() for x in target["en"]]
        for s in syns["en"]:
            if s.lower() not in low:
                target["en"].append(s)
        for s in syns["ja"]:
            if s not in target["ja"]:
                target["ja"].append(s)

    if not facets:
        # 完全に失敗した場合はテーマ文をそのまま1ファセットとして扱う
        facets = [{"name": "topic", "en": [topic], "ja": [topic], "mesh": []}]

    anchor_en = plan.get("anchor_en") or topic
    anchor_ja = plan.get("anchor_ja") or topic
    facets = _reorder_by_anchor(facets, anchor_en, anchor_ja)
    pruned = prune_terms(facets, topic)

    return {
        "framework": plan.get("framework") or "PCC",
        "definition": plan.get("definition") or f"{topic} に関する研究",
        "anchor_en": anchor_en,
        "anchor_ja": anchor_ja,
        "facets": facets,
        "homonyms": [str(x) for x in (plan.get("homonyms") or [])],
        "psychometric": bool(plan.get("psychometric")),
        "intervention": bool(plan.get("intervention")),
        "pruned": pruned,
    }


# 知的障害のテーマで、対象の語として入ると広がりすぎる語。テーマ文そのものが
# 含んでいれば残す(「知的障害と発達障害」のようなテーマ)。
# 実測(キーパーソン支援, 2026-10): 対象のファセットに 学習障害・発達障害・
# 神経発達症・neurodevelopmental disorder が入り、カタログ525件のうち39件が
# 自閉症か ADHD だけを扱う研究だった。日本語の 学習障害 は LD を指す
# (英語の learning disability は英国で知的障害を指すので残す)。
_BROAD_FOR_ID = {
    "ja": ("学習障害", "発達障害", "神経発達症", "神経発達障害"),
    "en": ("neurodevelopmental disorder", "neurodevelopmental disorders"),
}


# 年齢だけを表す語。障害名と同じファセットに OR で並ぶと、その年齢の研究が
# 障害を問わずすべて当たる。実測(成人の知的障害者へのキーパーソン支援):
# 対象のファセットが (adult OR adults OR "intellectual disability" …) になり、
# PubMed では "Adult"[Mesh] も同じ OR に入った。
_AGE_EN = {"adult", "adults", "adulthood", "child", "children", "childhood",
           "adolescent", "adolescents", "adolescence", "youth", "youths",
           "aged", "elderly", "older adult", "older adults", "infant", "infants"}
_AGE_JA = {"成人", "成人期", "成年", "児童", "子ども", "子供", "小児", "青年",
           "青年期", "思春期", "高齢者", "高齢期", "乳幼児", "幼児"}
_AGE_MESH = {"Adult", "Young Adult", "Middle Aged", "Aged", "Aged, 80 and over",
             "Child", "Child, Preschool", "Infant", "Adolescent"}


def prune_terms(facets: list, topic: str) -> list:
    """検索語から、無関係な文献を招く語を落とす。落とした語を返す。

    - 2文字以下の略語(ID など)。実測: 知的障害の略として ID が検索式に入った。
      identity や identifier にも当たる
    - 知的障害のテーマの対象のファセットに入った、より広い診断名(_BROAD_FOR_ID)
    - 年齢だけを表す語(_AGE_EN 等)。ほかの語と同じファセットにあるときだけ。
      年齢だけのファセットなら AND で効くので残す
    語を全部落とすとファセットが空になる場合は落とさない。
    """
    dropped = []
    low_topic = (topic or "").lower()
    for f in facets:
        mixed = (any(t.lower() not in _AGE_EN for t in f["en"])
                 or any(t not in _AGE_JA for t in f["ja"]))
        if mixed:
            mesh = [m for m in f.get("mesh") or [] if m not in _AGE_MESH]
            dropped += [m for m in f.get("mesh") or [] if m not in mesh]
            f["mesh"] = mesh
        en = [t for t in f["en"]
              if (len(re.sub(r"[^0-9A-Za-z]", "", t)) > 2 or not t.isascii())
              and not (mixed and t.lower() in _AGE_EN)]
        is_id = any("知的" in t for t in f["ja"]) or any(
            "intellectual" in t.lower() or "mental retardation" in t.lower()
            for t in f["en"])
        ja = [t for t in f["ja"] if not (mixed and t in _AGE_JA)]
        if is_id:
            en = [t for t in en if t.lower() not in _BROAD_FOR_ID["en"]
                  or t.lower() in low_topic]
            ja = [t for t in ja if t not in _BROAD_FOR_ID["ja"] or t in topic]
        if not (en or ja):
            continue
        dropped += [t for t in f["en"] if t not in en]
        dropped += [t for t in f["ja"] if t not in ja]
        f["en"], f["ja"] = en, ja
    return list(dict.fromkeys(dropped))


def apply_validated_mesh(plan: dict, valid) -> int:
    """PubMedでの照合を通ったMeSH統制語だけを各ファセットに残す。

    LLMはそれらしいが存在しない見出し語を作ることがある。存在しない語を
    [Mesh]タグで投げると検索式が静かに壊れるため、照合を通らない語は捨てる。
    戻り値は残った統制語の総数。
    """
    low = {str(v).strip().lower() for v in (valid or [])}
    kept = 0
    for f in plan.get("facets") or []:
        f["mesh"] = [m for m in (f.get("mesh") or [])
                     if m.strip().lower() in low]
        kept += len(f["mesh"])
    return kept


def _quote(term: str) -> str:
    """複数語はフレーズ検索にする。切り捨て記号付きは引用符で囲めない。"""
    t = term.strip()
    if "*" in t:
        return t
    return f'"{t}"' if " " in t else t


def _drop_wildcards(terms: list) -> list:
    """ワイルドカードを含む語を落とす。

    * を単に削除すると "disabilit*" が "disabilit" という語断片になり、
    どの論文にもマッチしなくなる(実際にOpenAlexで総ヒット0件になった)。
    語幹処理を行う検索エンジンでは、完全な語だけ残せば切り捨て相当の効果が出る。
    """
    return [t for t in (terms or []) if t and "*" not in t]


def _plain_facets(facets: list, limit=180) -> str:
    """各ファセットから均等に語を取った素の語列。

    以前は組み上げたブール式から演算子を落とし、先頭180字で切っていた。
    第1ファセットの同義語だけで180字が埋まり、第2・第3ファセットの語が
    1つも入らないことがある。実測(機能分析×知的障害×入所施設):

      functional analysis functional behavior assessment FBA functional
      assessment analogue functional analysis experimental functional
      analysis intellectual disability intellectual
      → residential 系の語が丸ごと落ちる

    Crossref と Semantic Scholar はこの語列しか受け取らないため、実質
    「第1ファセットのどれかを含む文献」を毎パス100件ずつ拾うことになり、
    関連の薄い文献が大量に流入していた。ファセットを順に1語ずつ、上限まで
    交互に足す。
    """
    pools = []
    for f in facets:
        terms = [t.strip() for t in (f.get("en") or [])
                 if t and t.strip() and "*" not in t]
        if terms:
            pools.append(terms)
    if not pools:
        return ""
    out, i = [], 0
    while True:
        added = False
        for pool in pools:
            if i >= len(pool):
                continue
            w = pool[i]
            if sum(len(x) + 1 for x in out) + len(w) > limit:
                continue
            out.append(w)
            added = True
        if not added:
            break
        i += 1
    return " ".join(out)


def _plain(boolean_query: str, limit=180) -> str:
    """ブール式から演算子と記号を落とした素の語列。語の途中では切らない。"""
    words = re.sub(r'[()"*]|\bOR\b|\bAND\b', " ", boolean_query).split()
    out = []
    for w in words:
        if sum(len(x) + 1 for x in out) + len(w) > limit:
            break
        out.append(w)
    return " ".join(out)


def _pubmed_group(terms: list, mesh=None) -> str:
    """PubMedのフィールドタグ付きORグループ。

    PubMedはフレーズ内の切り捨てに対応しないため、複数語かつ * を含む語は落とす。
    mesh には照合済みのMeSH統制語を渡す。[Mesh]は既定で下位語まで展開される
    ので、自由語では拾いきれない表記揺れと下位概念をまとめて回収できる。
    """
    tagged = [f'"{t.strip()}"[Mesh]' for t in (mesh or []) if t and t.strip()]
    for t in (terms or []):
        t = t.strip()
        if not t:
            continue
        if " " in t:
            if "*" in t:
                continue
            tagged.append(f'"{t}"[tiab]')
        else:
            tagged.append(f"{t}[tiab]")
    return "(" + " OR ".join(tagged) + ")" if tagged else ""


def _or_group(terms: list, quote=True) -> str:
    items = [_quote(t) if quote else t for t in terms if t and t.strip()]
    return "(" + " OR ".join(items) + ")" if items else ""


def _japanese_queries(facets: list, anchor_ja: str) -> str:
    """日本語DBへ渡す検索語列。" | " 区切りで、各要素が1回の検索になる。

    スペース区切りはJ-STAGE・CiNiiともANDとして扱われる。まず
    「中核の語 × 別ファセットの語」の2語ANDを並べて精度を確保し、
    続けて中核ファセットの単独語を置いて取りこぼしを回収する。
    ファセットが1つしかない検索(coreパス)では単独語だけになる。
    日本語DBは1語(または1組)ごとに個別のリクエストになり、しかも
    precise/broad/core の各段で実行されるため、回数に上限を置く
    (config.JA_PAIR_LIMIT / JA_SINGLE_LIMIT)。
    """
    core = list(dict.fromkeys(t for t in (facets[0]["ja"] if facets else []) if t))
    # 第2ファセット以降は交互に取る。順に連結すると、上限に達するまでに
    # 第2ファセットの語だけで埋まり、第3ファセットが一度も使われない。
    rest = [list(dict.fromkeys(t for t in f["ja"] if t)) for f in facets[1:]]
    second = []
    for i in range(max((len(r) for r in rest), default=0)):
        for r in rest:
            if i < len(r):
                second.append(r[i])
    second = list(dict.fromkeys(second))

    queries = []
    for a in core:
        for b in second:
            if a == b or a in b or b in a:
                continue
            q = f"{a} {b}"
            if q not in queries:
                queries.append(q)
            if len(queries) >= config.JA_PAIR_LIMIT:
                break
        if len(queries) >= config.JA_PAIR_LIMIT:
            break
    queries += [t for t in core[:config.JA_SINGLE_LIMIT] if t not in queries]
    return " | ".join(queries) or anchor_ja


def build_queries(plan: dict, max_facets=None) -> dict:
    """ファセット計画からDB方言ごとの検索式を組む。

    ファセット内はOR、ファセット間はANDで結ぶ。ファセットを増やすほど
    精度は上がるが件数が枯れるため、中核から max_facets 個
    (既定は config.MAX_FACETS)までに絞る。
    """
    facets = plan["facets"][:max_facets or config.MAX_FACETS]
    en_groups = [_or_group(f["en"]) for f in facets if f["en"]]
    # 日本語語彙の平坦化は廃止した(_japanese_queries が facets を直接読む)

    core_en = " AND ".join(g for g in en_groups if g)
    if not core_en:
        core_en = _quote(plan["anchor_en"])

    # 語幹処理を行うDB(OpenAlex等)向け。ワイルドカードを含む語は丸ごと落とす。
    nw_groups = [_or_group(_drop_wildcards(f["en"])) for f in facets if f["en"]]
    core_nw = " AND ".join(g for g in nw_groups if g) or _quote(plan["anchor_en"])
    extra_nw = ""
    if plan.get("psychometric"):
        extra_nw = " AND " + _or_group(_drop_wildcards(PSYCHOMETRIC_FILTER))
    elif plan.get("intervention"):
        extra_nw = " AND " + _or_group(_drop_wildcards(DESIGN_FILTER))

    # 尺度・介入の補助フィルタ。中核ファセットにANDで足す。
    extra = ""
    if plan.get("psychometric"):
        extra = " AND " + _or_group(PSYCHOMETRIC_FILTER)
    elif plan.get("intervention"):
        extra = " AND " + _or_group(DESIGN_FILTER)

    # --- PubMed: 統制語と自由語の併用。フィールドタグを各語に付ける ---
    pm_groups = [g for g in (_pubmed_group(f["en"], f.get("mesh"))
                             for f in facets) if g]
    pubmed = " AND ".join(pm_groups) if pm_groups else f'{plan["anchor_en"]}[tiab]'
    if plan.get("psychometric"):
        pubmed += " AND " + _pubmed_group(PSYCHOMETRIC_FILTER)
    elif plan.get("intervention"):
        pubmed += " AND " + _pubmed_group(DESIGN_FILTER)

    # --- ERIC: field:value 構文。抄録は description、統制語は subject ---
    # ERICはディスクリプタ(統制語)の付与が丁寧なので、subjectを併用すると
    # 抄録に語が出てこない文献を拾える。語数が増えるとURLが伸びるため、
    # subject側はファセットあたり先頭6語までに絞る。
    eric_groups = []
    for f in facets:
        terms = [t for t in f["en"] if "*" not in t]
        if not terms:
            continue
        clauses = [f'description:{_quote(t)}' for t in terms]
        clauses += [f'subject:{_quote(t)}' for t in terms[:6]]
        eric_groups.append("(" + " OR ".join(clauses) + ")")
    eric = " AND ".join(eric_groups) or f'description:{_quote(plan["anchor_en"])}'

    # --- OpenAlex: title_and_abstract.search はstemmedフィールドで、
    # ワイルドカードとの併用が400エラーになる。* を削除すると "disabilit" のような
    # 語断片が残り総ヒット0件になるため、その語自体を検索式から外す。
    # カンマはfilter値の区切りとして解釈されるので除く。
    openalex = (core_nw + extra_nw).replace(",", " ")

    # --- 日本語DB: J-STAGEもCiNiiもスペース区切りをANDとして扱う。
    # 同義語を並べると「全語を含む論文」を探すことになり0件になるため、
    # 語を連結せず " | " 区切りで渡し、フェッチャ側で1語ずつ検索させる。
    # 以前は全ファセットの日本語語彙を平坦化して先頭3語だけを使っていた。
    # 実際には中核ファセットの語しか残らず、ファセット間のANDが日本語側で
    # 消えていた。
    simple_ja = _japanese_queries(facets, plan["anchor_ja"])

    # Crossref と Semantic Scholar は演算子を解さないため素の語列を渡す。
    # 全ファセットから均等に取る(_plain_facets の docstring を参照)。
    plain_en = _plain_facets(facets) or _plain(core_nw)

    return {
        "openalex": openalex,
        "pubmed": pubmed,
        "europepmc": core_en + extra,
        "crossref": plain_en,
        "eric": eric,
        "simple_en": plain_en,
        "simple_ja": simple_ja,
    }


def build_query_passes(plan: dict) -> list:
    """精度重視と感度重視の2段構えで検索式を作る。

    ファセットを全部ANDで結ぶと精度は上がるが、中核文献まで落ちることがある
    (これが「収集件数は多いのに中核が薄い」状態を招く)。そこで
      precise : ファセットMAX_FACETS個をAND — 主題が一致する文献
      broad   : ファセット2個をAND          — 取りこぼしの回収
      core    : 中核ファセットのみ          — その概念を扱う文献を漏らさない
    の順に投げ、重複はDOI/タイトルで自動的に排除される。
    ファセットが少ないテーマでは重複するパスを自動で省く。
    """
    passes, seen = [], set()
    n_facets = len(plan["facets"])
    for label, k in (("precise", config.MAX_FACETS), ("broad", 2), ("core", 1)):
        if k > n_facets:
            continue
        q = build_queries(plan, max_facets=k)
        sig = q.get("openalex", "")
        if sig in seen:
            continue
        seen.add(sig)
        passes.append((label, q))
    return passes or [("core", build_queries(plan, max_facets=1))]


def describe_plan(plan: dict, queries: dict) -> str:
    """検索戦略を人が読める形にする。レポートの検索履歴に載せる(PRISMA-S準拠)。"""
    lines = [f"枠組み: {plan['framework']}",
             f"中心概念(anchor): {plan.get('anchor_en')} / {plan.get('anchor_ja')}",
             f"テーマの定義: {plan['definition']}"]
    if plan.get("homonyms"):
        lines.append("同名異義語として区別すべき概念: " + " / ".join(plan["homonyms"]))
    if plan.get("pruned"):
        lines.append("検索語から外した語(無関係な文献を招くため): "
                     + ", ".join(plan["pruned"]))
    lines.append("")
    lines.append("ファセット:")
    n = config.MAX_FACETS
    for i, f in enumerate(plan["facets"]):
        # build_queries は先頭 MAX_FACETS 件しか使わない。それより後ろが
        # 中心概念だと一度も検索されないまま終わるので、その場で分かるようにする。
        mark = "" if i < n else f"   ※{n + 1}番目以降は検索式に入りません"
        lines.append(f"  - {f['name']}{mark}")
        if f["en"]:
            lines.append("      EN: " + ", ".join(f["en"]))
        if f["ja"]:
            lines.append("      JA: " + ", ".join(f["ja"]))
        if f.get("mesh"):
            lines.append("      MeSH(照合済み): " + ", ".join(f["mesh"]))
    if plan.get("psychometric"):
        lines.append("  - 測定特性フィルタを適用(信頼性・妥当性を扱う研究に限定)")
    if plan.get("intervention"):
        lines.append("  - 研究デザインフィルタを適用(介入研究に限定)")
    if not queries:
        return "\n".join(lines)
    lines.append("")
    lines.append("実際に投げた検索式:")
    for k in ("openalex", "pubmed", "europepmc", "eric",
              "crossref", "simple_en", "simple_ja"):
        if queries.get(k):
            lines.append(f"  {k}: {queries[k]}")
    return "\n".join(lines)
