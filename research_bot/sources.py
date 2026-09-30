"""文献データベースの検索と引用連鎖(snowballing)。

収録データベース:
  英語  OpenAlex / PubMed / Europe PMC / Crossref / Semantic Scholar / ERIC
  日本語 J-STAGE / CiNii Research (CiNiiはappid登録時のみ)

ERIC は特別支援教育・応用行動分析の中核データベースで、キー不要で使える。
心理学の中核である PsycINFO は機関契約が前提で個人からは叩けないため、
OpenAlex(収録誌が大きく重なる) + ERIC + PsyArXiv で穴を埋める設計にしている。

引用連鎖は OpenAlex を使う。キーワード検索が取りこぼした中核文献
(著者が別の語彙を使っていた等)を拾うのが目的で、
「収集件数は多いが中核文献が薄い」状態への最も直接的な対処になる。
"""

import re
import time
import xml.etree.ElementTree as ET

import requests
from tqdm import tqdm

import config

# キーとメールアドレスは config が一括で読む(keys.env にも対応)
ACADEMIC_EMAIL = config.ACADEMIC_EMAIL
S2_API_KEY = config.S2_API_KEY
NCBI_API_KEY = config.NCBI_API_KEY
CINII_APPID = config.CINII_APPID
# OpenAlexは2026年2月13日以降、全リクエストにAPIキーを必須化した。
# キー無しは1日100クレジットの試用枠のみで、それを超えると409になる。
# 未設定なら、検索・引用連鎖のOpenAlex呼び出しが軒並み失敗し、
# 「0件」として静かに握りつぶされる(これが最も紛らわしい壊れ方)。
OPENALEX_API_KEY = config.OPENALEX_API_KEY
_openalex_warned = False
_cinii_warned = False


def openalex_key_missing_warning():
    """OpenAlexキー未設定を一度だけ警告する。0件の原因が分からなくなるのを防ぐ。"""
    global _openalex_warned
    if not OPENALEX_API_KEY and not _openalex_warned:
        _openalex_warned = True
        tqdm.write(
            "\n[警告] OPENALEX_API_KEY が未設定です。OpenAlexは2026年2月から"
            "全リクエストにキーを要求しており、無いと検索・引用連鎖のOpenAlex"
            "呼び出しがすべて失敗します(結果は静かに0件になります)。"
            "openalex.org/settings/api で無料キーを取得し、"
            "export OPENALEX_API_KEY=\"...\" を ~/.bashrc に追加してください。\n")


def test_openalex_connection() -> bool:
    """既知に必ずヒットする語で1件だけ試し、キーが実際に通っているか確認する。

    検索本編の前に呼ぶ。ここで失敗が見えれば、後続の「0件」が
    テーマ側の問題ではなくAPI疎通の問題だとその場で分かる。
    """
    tqdm.write("[疎通確認] OpenAlexへ試験リクエストを送信中...")
    try:
        params = _openalex_params({
            "filter": "title_and_abstract.search:psychology,has_abstract:true",
            "per-page": 1})
        res = _get("https://api.openalex.org/works", params=params, timeout=15)
        if res.status_code == 200:
            n = len(res.json().get("results", []))
            if n > 0:
                tqdm.write(f"[疎通確認] OK — OpenAlexは正常に応答しています。")
                return True
            tqdm.write(f"[疎通確認] 応答は200だが結果が0件でした。本文: {res.text[:300]}")
            return False
        tqdm.write(f"[疎通確認] 失敗 — ステータス {res.status_code}: {res.text[:300]}")
        if not OPENALEX_API_KEY:
            tqdm.write("[疎通確認] OPENALEX_API_KEY が空です。--- 環境変数が"
                      "現在のシェルに読み込まれているか `echo $OPENALEX_API_KEY` "
                      "で確認してください。")
        return False
    except Exception as e:
        tqdm.write(f"[疎通確認] 通信エラー: {type(e).__name__}: {e}")
        return False

USER_AGENT = f"ResearchBot/31.0 (mailto:{ACADEMIC_EMAIL})" if ACADEMIC_EMAIL else "ResearchBot/31.0"

# 1クエリあたりの取得上限
FETCH_LIMIT = 100
ERIC_LIMIT = 200          # ERICは1回200件まで
NDL_LIMIT = 200           # NDLサーチは1回500件まで。501件目以降は取得できない
REQUEST_PAUSE = 1.0       # DB間の礼儀的な間隔


def _openalex_params(extra: dict) -> dict:
    p = dict(extra)
    if OPENALEX_API_KEY:
        p["api_key"] = OPENALEX_API_KEY
    elif ACADEMIC_EMAIL:
        p["mailto"] = ACADEMIC_EMAIL
    return p


def _get(url, **kw):
    kw.setdefault("timeout", 20)
    headers = kw.pop("headers", {})
    headers.setdefault("User-Agent", USER_AGENT)
    return requests.get(url, headers=headers, **kw)


# ==========================================
# 抄録の復元・整形
# ==========================================
# OpenAlexの display_name には、稀に ORCID などの識別子が本文ごと紛れ込む
# (例: "Schuengel, Carlo; id_orcid 0000-0001-5501-3341; Doodeman, Tanja")。
# これを著者名として扱うと数字だけの引用キーが生成されるため取り除く。
_ID_NOISE = re.compile(
    r"\b(id_orcid|orcid|https?://orcid\.org/)\s*[:\s]?\s*"
    r"\d{4}-\d{4}-\d{4}-\d{3}[\dXx]", re.I)


def clean_author_name(name) -> str:
    """著者名から識別子ノイズを除く。除いた結果が空なら空文字を返す。"""
    if not name:
        return ""
    s = _ID_NOISE.sub(" ", str(name))
    s = re.sub(r"\d{4}-\d{4}-\d{4}-\d{3}[\dXx]", " ", s)  # 裸のORCID
    s = re.sub(r"\s+", " ", s).strip(" ;,")
    # 記号と数字しか残らなかったものは著者名ではない
    return "" if not re.search(r"[A-Za-zぁ-んァ-ン一-龥]", s) else s


def clean_authors(names) -> list:
    out = []
    for n in (names or []):
        c = clean_author_name(n)
        if c:
            out.append(c)
    return out


def reconstruct_inverted_abstract(inv_idx: dict) -> str:
    """OpenAlexのabstract_inverted_index(単語→出現位置リスト)を平文に復元する。

    単語ごとに最小位置だけを見ると、2回以上出現する語(the / of など)が
    1回しか復元されず抄録が壊れる。全出現位置を展開して位置順に並べ直す。
    """
    if not inv_idx:
        return ""
    pos = {}
    for word, positions in inv_idx.items():
        for p in positions or []:
            pos[p] = word
    return " ".join(pos[i] for i in sorted(pos))


_PMCID_RE = re.compile(r"PMC\d+", re.I)


def normalize_pmcid(v) -> str:
    """"PMC1234567" / "1234567" / "https://.../pmc/articles/PMC1234567" を
    "PMC1234567" にそろえる。取れなければ空文字。

    PMCIDがあれば Europe PMC から構造化された全文XMLを取れる
    (fulltext.py)。OpenAlexとSemantic Scholarも持っているのに、以前は
    PubMed・Europe PMC由来の文献でしか記録していなかった。
    """
    if not v:
        return ""
    s = str(v).strip()
    m = _PMCID_RE.search(s)
    if m:
        return m.group(0).upper()
    return f"PMC{s}" if s.isdigit() else ""


def _openalex_pmcid(it: dict) -> str:
    return normalize_pmcid((it.get("ids") or {}).get("pmcid"))


# ==========================================
# 各データベース
# ==========================================
def _report_result(name, got, total=None):
    """取得件数と、分かればヒット総数を知らせる。

    FETCH_LIMIT は1クエリ100件で、ページングしていない。
    広いテーマでは上限に張り付いているはずだが、これまで記録が
    残らなかった。「100件ちょうど」が続くなら、それは網羅では
    なく打ち切りである。
    """
    if isinstance(total, int) and total > got:
        tqdm.write("  [%s] ヒット総数 %s件 のうち %s件を取得(1クエリの上限。ページングは行っていない)" % (name, total, got))
    elif got >= FETCH_LIMIT:
        tqdm.write("  [%s] 取得上限(%s件)に達しました。取りこぼしがある可能性があります。" % (name, FETCH_LIMIT))


def fetch_openalex(query: str, add) -> int:
    """OpenAlex。title_and_abstract.search でブール式に近い検索ができる。"""
    openalex_key_missing_warning()
    n = 0
    try:
        params = _openalex_params({
            "filter": f"title_and_abstract.search:{query},has_abstract:true",
            "per-page": FETCH_LIMIT,  # per_page(アンダースコア)は無視され25件しか返らない
        })
        res = _get("https://api.openalex.org/works", params=params)
        if res.status_code != 200:
            tqdm.write(f"  [OpenAlex] エラー {res.status_code}: {res.text[:150]}")
            return 0
        payload = res.json()
        total = (payload.get("meta") or {}).get("count")
        if not payload.get("results"):
            # 200なのに空。検索式が厳しすぎるのか、構文が通っていないのかを
            # 区別できるようにヒット総数と実際に投げた式を出す。
            tqdm.write(f"  [OpenAlex] ヒット0件(総数={total})。投げた式: {query[:180]}")
            return 0
        for it in payload.get("results", []):
            authors = clean_authors([(a.get("author") or {}).get("display_name")
                                     for a in (it.get("authorships") or [])])
            doi = it.get("doi")
            if add("OpenAlex", it.get("title"), it.get("publication_year"),
                   reconstruct_inverted_abstract(it.get("abstract_inverted_index")),
                   url=doi or it.get("id"), doi=doi, authors=authors,
                   openalex_id=it.get("id"), cited_by=it.get("cited_by_count"),
                   pmcid=_openalex_pmcid(it)):
                n += 1
    except Exception as e:
        tqdm.write(f"  [OpenAlex] 通信エラー: {type(e).__name__}: {e}")
    return n


def fetch_pubmed(query: str, add) -> int:
    """PubMed。MeSH統制語と[tiab]自由語を併用したブール式をそのまま渡せる。"""
    n = 0
    try:
        p = {"db": "pubmed", "term": query, "retmax": FETCH_LIMIT, "retmode": "json"}
        if NCBI_API_KEY:
            p["api_key"] = NCBI_API_KEY
        if ACADEMIC_EMAIL:
            p["email"] = ACADEMIC_EMAIL
        res = _get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", params=p)
        if res.status_code != 200:
            tqdm.write(f"  [PubMed] esearchエラー {res.status_code}: {res.text[:150]}")
            return 0
        r = res.json().get("esearchresult", {}) or {}
        ids = r.get("idlist", [])
        if not ids:
            # MeSH見出し語や引用符が1つでも解決できないとPubMedは静かに
            # 0件になる。errorlist に解決できなかった語句が入るので出す。
            notfound = (r.get("errorlist") or {}).get("phrasesnotfound") or []
            tqdm.write(f"  [PubMed] ヒット0件(総数={r.get('count')})。"
                       + (f"解決できなかった語句: {', '.join(notfound[:6])}"
                          if notfound else f"投げた式: {query[:180]}"))
            return 0

        fp = {"db": "pubmed", "id": ",".join(ids), "retmode": "xml"}
        if NCBI_API_KEY:
            fp["api_key"] = NCBI_API_KEY
        if ACADEMIC_EMAIL:
            fp["email"] = ACADEMIC_EMAIL
        xr = _get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi",
                  params=fp, timeout=30)
        if xr.status_code != 200:
            tqdm.write(f"  [PubMed] efetchエラー {xr.status_code}: {xr.text[:150]}")
            return 0

        for art in ET.fromstring(xr.text).findall(".//PubmedArticle"):
            pmid = art.findtext(".//PMID")
            doi = (art.findtext(".//ArticleIdList/ArticleId[@IdType='doi']")
                   or art.findtext(".//ELocationID[@EIdType='doi']"))
            pmcid = normalize_pmcid(
                art.findtext(".//ArticleIdList/ArticleId[@IdType='pmc']"))
            authors = []
            for a in art.findall(".//AuthorList/Author"):
                last = a.findtext("LastName")
                fore = a.findtext("ForeName") or a.findtext("Initials")
                if last:
                    authors.append(f"{last} {fore}".strip() if fore else last)
                elif a.findtext("CollectiveName"):
                    authors.append(a.findtext("CollectiveName"))
            # 構造化抄録はLabel属性を見出しとして残すと節の切れ目が保てる
            parts = []
            for ab in art.findall(".//Abstract/AbstractText"):
                label = ab.get("Label")
                body = "".join(ab.itertext())
                parts.append(f"【{label}】 {body}" if label else body)
            if add("PubMed", art.findtext(".//ArticleTitle"),
                   art.findtext(".//PubDate/Year"), " ".join(parts),
                   url=f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else None,
                   doi=doi, authors=authors, pmcid=pmcid):
                n += 1
    except Exception as e:
        tqdm.write(f"  [PubMed] 通信・解析エラー: {type(e).__name__}: {e}")
    return n


def fetch_europe_pmc(query: str, add) -> int:
    n = 0
    try:
        res = _get("https://www.ebi.ac.uk/europepmc/webservices/rest/search", params={
            "query": f"({query}) AND (HAS_ABSTRACT:y)", "format": "json",
            "resultType": "core", "pageSize": FETCH_LIMIT})
        if res.status_code != 200:
            tqdm.write(f"  [Europe PMC] エラー {res.status_code}: {res.text[:150]}")
            return 0
        results = res.json().get("resultList", {}).get("result", [])
        if not results:
            tqdm.write(f"  [Europe PMC] ヒット0件。投げた式: {query[:180]}")
            return 0
        for it in results:
            doi, pmid = it.get("doi"), it.get("pmid")
            url = (f"https://doi.org/{doi}" if doi
                   else f"https://europepmc.org/article/MED/{pmid}" if pmid else None)
            authors = [a.get("fullName") or a.get("lastName")
                       for a in ((it.get("authorList") or {}).get("author") or [])]
            authors = [a for a in authors if a]
            if not authors and it.get("authorString"):
                authors = [x.strip() for x in it["authorString"].split(",") if x.strip()]
            if add("Europe PMC", it.get("title"), it.get("pubYear"),
                   it.get("abstractText"), url=url, doi=doi, authors=authors,
                   pmcid=normalize_pmcid(it.get("pmcid"))):
                n += 1
    except Exception as e:
        tqdm.write(f"  [Europe PMC] 通信・解析エラー: {type(e).__name__}: {e}")
    return n


def fetch_crossref(query: str, add) -> int:
    n = 0
    try:
        res = _get("https://api.crossref.org/works", params={
            "query.bibliographic": query, "filter": "has-abstract:true",
            "rows": FETCH_LIMIT})
        if res.status_code != 200:
            tqdm.write(f"  [Crossref] エラー {res.status_code}: {res.text[:150]}")
            return 0
        items = res.json().get("message", {}).get("items", [])
        if not items:
            tqdm.write(f"  [Crossref] ヒット0件。投げた語列: {query[:180]}")
            return 0
        for it in items:
            authors = []
            for a in it.get("author", []) or []:
                fam, giv = (a.get("family") or "").strip(), (a.get("given") or "").strip()
                if fam:
                    authors.append(f"{fam} {giv}".strip())
                elif a.get("name"):
                    authors.append(a["name"].strip())
            dp = (it.get("published") or {}).get("date-parts") or [[None]]
            if add("Crossref", (it.get("title") or [""])[0],
                   dp[0][0] if dp and dp[0] else None,
                   it.get("abstract", "") or "", url=it.get("URL"),
                   doi=it.get("DOI"), authors=authors):
                n += 1
    except Exception as e:
        tqdm.write(f"  [Crossref] 通信・解析エラー: {type(e).__name__}: {e}")
    return n


def fetch_semantic_scholar(query: str, add) -> int:
    """Semantic Scholar。キーが無くても使えるが、未認証は全ユーザー共有の
    レート制限プールに入るため429が頻発する。

    以前は429で即座に0件を返していたため常に空だった。待機して数回やり直す。
    リクエスト数を増やすほど429を誘発するので、分割取得はせず1回で取り切る。
    """
    headers = {"x-api-key": S2_API_KEY} if S2_API_KEY else {}
    waits = [5, 15, 30] if not S2_API_KEY else [3, 8]
    n = 0
    for attempt in range(len(waits) + 1):
        try:
            res = _get("https://api.semanticscholar.org/graph/v1/paper/search",
                       params={"query": query, "limit": FETCH_LIMIT,
                               "fields": "title,year,abstract,tldr,url,externalIds,authors"},
                       headers=headers, timeout=30)
            if res.status_code == 403:
                # 403は権限拒否でレート制限ではない。待って再試行しても解消
                # しない。以前はS2_API_KEYの有無を見ずに常に「未認証」という
                # 文言を出していたため、キーを設定していても同じ表示になり、
                # 「キーが送られた上で拒否されたのか、そもそも送られて
                # いないのか」を利用者が判断できなかった。ここを分岐する。
                if S2_API_KEY:
                    tqdm.write("  [Semantic Scholar] 403 Forbidden。"
                               "S2_API_KEYは設定されていますが拒否されました。"
                               "キー自体が無効化・失効している可能性が高いです。"
                               "semanticscholar.org/product/api のダッシュボードで"
                               "このキーがまだ有効か確認し、無効なら再発行して"
                               "export S2_API_KEY=\"...\" を設定し直してください。"
                               "このDBを諦めて他DBで代替することもできます。")
                else:
                    tqdm.write("  [Semantic Scholar] 403 Forbidden。未認証の検索は"
                               "現在ほぼ拒否されます。semanticscholar.org/product/api "
                               "でキーを取得し export S2_API_KEY=\"...\" を設定するか、"
                               "このDBは諦めてください(他DBで代替可能です)。")
                return 0
            if res.status_code == 429:
                if attempt < len(waits):
                    w = waits[attempt]
                    tqdm.write(f"  [Semantic Scholar] レート制限(429)。{w}秒待機して再試行"
                               f" ({attempt + 1}/{len(waits)})")
                    time.sleep(w)
                    continue
                tqdm.write("  [Semantic Scholar] レート制限が解消せず断念しました。")
                return 0
            if res.status_code != 200:
                tqdm.write(f"  [Semantic Scholar] エラー {res.status_code}: {res.text[:120]}")
                return 0
            for it in res.json().get("data", []):
                tldr = (it.get("tldr") or {}).get("text", "") or ""
                ext = it.get("externalIds") or {}
                if add("Semantic Scholar", it.get("title"), it.get("year"),
                       f"{tldr} {it.get('abstract') or ''}", url=it.get("url"),
                       doi=ext.get("DOI"),
                       authors=[a.get("name") for a in (it.get("authors") or [])],
                       pmcid=normalize_pmcid(ext.get("PubMedCentral"))):
                    n += 1
            return n
        except Exception as e:
            if attempt < len(waits):
                time.sleep(waits[attempt])
                continue
            tqdm.write(f"  [Semantic Scholar] 通信エラー: {type(e).__name__}: {e}")
            return n
    return n


def fetch_eric(query: str, add) -> int:
    """ERIC。特別支援教育・応用行動分析の中核。キー不要。

    検索構文は field:value 形式。抄録は description フィールドに入る。
    """
    n = 0
    try:
        res = _get("https://api.ies.ed.gov/eric/", params={
            "search": query, "format": "json", "rows": ERIC_LIMIT, "start": 0,
            "fields": "id,title,author,description,publicationdateyear,source,"
                      "subject,peerreviewed,url"})
        if res.status_code != 200:
            tqdm.write(f"  [ERIC] エラー {res.status_code}: {res.text[:150]}")
            return 0
        docs = res.json().get("response", {}).get("docs", [])
        if not docs:
            tqdm.write(f"  [ERIC] ヒット0件。投げた式: {query[:180]}")
            return 0
        for it in docs:
            eid = it.get("id")
            desc = it.get("description")
            if isinstance(desc, list):
                desc = " ".join(desc)
            # ERICは査読の有無を返す。値は "T"/"F" の文字列、真偽値、
            # あるいは欠落と揺れるため、ここで三値(True/False/None)に
            # そろえる。Noneは「ERICが答えなかった」を意味し、
            # 査読なしと同一視しない。
            pr = it.get("peerreviewed")
            if isinstance(pr, str):
                pr = {"t": True, "true": True, "yes": True,
                      "f": False, "false": False, "no": False}.get(
                          pr.strip().lower())
            elif not isinstance(pr, bool):
                pr = None
            if add("ERIC", it.get("title"), it.get("publicationdateyear"), desc,
                   url=it.get("url") or (f"https://eric.ed.gov/?id={eid}" if eid else None),
                   doi=None, authors=it.get("author") or [], venue=it.get("source"),
                   peer_reviewed=pr):
                n += 1
    except Exception as e:
        tqdm.write(f"  [ERIC] 通信・解析エラー: {type(e).__name__}: {e}")
    return n


# 日本語の学会誌・大会論文集には、研究論文でない記事が大量に混ざる。
# 抄録が付いていても内容が無いため、タイトルで弾く。
#
# 部分一致で弾いてよい語。記事の種別そのものを指す言葉で、研究論文の
# 題名の一部として現れることがまず無い。
NOISE_TITLE_PATTERNS = (
    "大会長挨拶", "会長挨拶", "巻頭言", "祝辞",
    "各種委員会報告", "委員会報告", "会務報告", "総会報告",
    "会場案内", "タイムスケジュール", "日程表",
    "座長一覧", "賛助会員", "編集後記",
    "学会賞", "会則", "投稿規定", "執筆要領", "奥付",
)

# 完全一致でのみ弾く語。研究論文の題名の一部として普通に現れるため、
# 部分一致にすると本文まで巻き込む。実測: 「強度行動障害支援のはじめに
# 考えること」が「はじめに」で、「行動障害のある人への広告リテラシー支援」
# が「広告」で落ちていた。福祉領域では特に取りこぼしが痛い。
NOISE_TITLE_EXACT = (
    "はじめに", "序文", "目次", "索引", "広告", "事務局", "参加費",
    "訂正", "正誤表", "お知らせ", "編集後記", "巻頭言",
)
_NOISE_EXACT_NORM = {re.sub(r"[\s　]", "", p) for p in NOISE_TITLE_EXACT}


def _is_noise_title(title: str) -> bool:
    t = (title or "").strip()
    if not t:
        return True
    # 「【お知らせ】」「目次・索引」等の飾りを落としてから完全一致を見る
    if re.sub(r"[\s　【】\[\]（）()：:・,、。.]", "", t) in _NOISE_EXACT_NORM:
        return True
    return any(p in t for p in NOISE_TITLE_PATTERNS)


def _jsonld_value(item: dict, *keys) -> str:
    """JSON-LDの値を取り出す。文字列・配列・辞書のいずれでも来るため吸収する。

    CiNiiは同じ情報を title と dc:title のように別キーで返すことがあるので、
    候補キーを順に試す。
    """
    for k in keys:
        v = item.get(k)
        if v is None or v == "":
            continue
        if isinstance(v, list):
            v = v[0] if v else None
        if isinstance(v, dict):
            v = v.get("@value") or v.get("foaf:name")
            if isinstance(v, list):
                v = v[0] if v else None
            if isinstance(v, dict):
                v = v.get("@value")
        if v:
            return str(v).strip()
    return ""


def _strip_ns(tag: str) -> str:
    return tag.split("}")[-1]


def _jstage_text(entry, tag_name: str) -> str:
    """J-STAGEのentryから指定タグの文字列を取る。日本語を優先する。

    要素は <article_title><ja>...</ja><en>...</en></article_title> の形が基本だが、
    タグによっては直接テキストを持つ。名前空間の付き方も要素ごとに異なるため、
    名前空間を無視して名前だけで突き合わせる。
    """
    for child in entry:
        if _strip_ns(child.tag) != tag_name:
            continue
        ja = en = None
        for sub in child:
            name = _strip_ns(sub.tag)
            if name == "ja" and (sub.text or "").strip():
                ja = sub.text.strip()
            elif name == "en" and (sub.text or "").strip():
                en = sub.text.strip()
        if ja or en:
            return ja or en
        if (child.text or "").strip():
            return child.text.strip()
    return ""


def _enrich_abstracts_by_doi(records: list) -> dict:
    """DOIをまとめてOpenAlexへ問い合わせ、抄録を引く。{DOI小文字: 抄録} を返す。

    J-STAGEの検索APIは書誌のみを返し抄録を含まない。抄録が無いと収集側の
    文字数下限で全件落ちるため、DOI経由で補完する。OpenAlexはDOIを
    まとめて問い合わせられるので、追加リクエストは数回で済む。
    """
    out = {}
    dois = [r["doi"] for r in records if r.get("doi")]
    if not dois:
        return out
    for i in range(0, len(dois), 50):
        chunk = dois[i:i + 50]
        try:
            params = _openalex_params({
                "filter": "doi:" + "|".join(chunk), "per-page": 100,
                "select": "doi,abstract_inverted_index"})
            res = _get("https://api.openalex.org/works", params=params)
            if res.status_code != 200:
                tqdm.write(f"  [J-STAGE 抄録補完] エラー {res.status_code}: {res.text[:120]}")
                continue
            for w in res.json().get("results", []):
                d = (w.get("doi") or "").lower().replace("https://doi.org/", "")
                text = reconstruct_inverted_abstract(w.get("abstract_inverted_index"))
                if d and text:
                    out[d] = text
        except Exception as e:
            tqdm.write(f"  [J-STAGE 抄録補完] 通信エラー: {type(e).__name__}: {e}")
        time.sleep(REQUEST_PAUSE)
    return out


def _split_ja_terms(query_ja: str) -> list:
    """日本語DB向けの検索語を分解する。

    J-STAGEもCiNiiもスペース区切りをANDとして解釈するため、同義語を並べると
    「全語を含む論文」を探すことになり0件になる。" | " で区切って渡し、
    ここで1語ずつに分けて個別に検索する(結果の重複は収集側が排除する)。
    """
    terms = [t.strip() for t in (query_ja or "").split("|") if t.strip()]
    return terms or ([query_ja.strip()] if query_ja and query_ja.strip() else [])


def fetch_jstage(query_ja: str, add) -> int:
    """J-STAGE。日本語の心理学・作業療法・特殊教育。キー不要。

    検索APIは書誌情報のみを返し、抄録を一切含まない。そのままでは収集側の
    MIN_ABSTRACT_LENGTHで全件落ちるため、DOIからOpenAlexで抄録を補完する。
    補完できなかったものは書誌だけになるので採用しない。
    """
    records = []
    seen_urls = set()
    for term in _split_ja_terms(query_ja):
      try:
        res = _get("https://api.jstage.jst.go.jp/searchapi/do", params={
            "service": 3, "text": term, "count": 100, "start": 1})
        if res.status_code != 200:
            tqdm.write(f"  [J-STAGE] エラー {res.status_code}")
            continue
        root = ET.fromstring(res.text)
        entries = [e for e in root.iter() if _strip_ns(e.tag) == "entry"]
        for e in entries:
            doi = _jstage_text(e, "doi")
            year = None
            ystr = _jstage_text(e, "pubyear")
            m = re.search(r"\d{4}", ystr or "")
            if m:
                year = m.group(0)
            # 著者は <author><ja><name>…</name></ja><en><name>…</name></en></author>
            # の入れ子。両方拾うと同一人物が二重に並ぶため、日本語側を優先する。
            authors = []
            for child in e:
                if _strip_ns(child.tag) != "author":
                    continue
                by_lang = {}
                for sub in child:
                    lang = _strip_ns(sub.tag)
                    if lang not in ("ja", "en"):
                        continue
                    names = [x.text.strip() for x in sub.iter()
                             if _strip_ns(x.tag) == "name" and (x.text or "").strip()]
                    if names:
                        by_lang[lang] = names
                authors = by_lang.get("ja") or by_lang.get("en") or []
                if not authors:
                    # 言語別の入れ子が無い形式へのフォールバック
                    authors = [x.text.strip() for x in child.iter()
                               if _strip_ns(x.tag) == "name" and (x.text or "").strip()]
                break
            jtitle = _jstage_text(e, "article_title")
            if _is_noise_title(jtitle):
                continue   # 巻頭言・目次などの非研究記事
            u = _jstage_text(e, "article_link") or _jstage_text(e, "id")
            if u and u in seen_urls:
                continue      # 語をまたいで同じ論文が返るのは正常
            if u:
                seen_urls.add(u)
            records.append({
                "title": jtitle,
                "year": year, "doi": doi.lower() if doi else None,
                "url": u, "authors": authors,
                "venue": _jstage_text(e, "material_title"),
            })
      except Exception as e:
        tqdm.write(f"  [J-STAGE] 解析エラー: {type(e).__name__}: {e}")
        continue
      time.sleep(REQUEST_PAUSE)

    if not records:
        return 0

    abstracts = _enrich_abstracts_by_doi(records)
    n = no_abs = dup = 0
    for r in records:
        text = abstracts.get(r["doi"] or "", "")
        if not text:
            no_abs += 1   # 抄録を補完できなかったものは採用しない
            continue
        if add("J-STAGE", r["title"], r["year"], text, url=r["url"],
               doi=r["doi"], authors=r["authors"], venue=r["venue"]):
            n += 1
        else:
            dup += 1      # 他DBや前のパスで収集済み
    if records and n == 0:
        tqdm.write(f"  [J-STAGE] {len(records)}件ヒット → "
                   f"抄録を補完できず{no_abs}件 / 収集済みか重複{dup}件")
    return n


def fetch_cinii(query_ja: str, add) -> int:
    """CiNii Research。appid登録が必要なため、環境変数がある時だけ動く。

    論文に絞るため検索タイプは articles を使う(all だと図書・研究課題も混ざる)。
    抄録は description に入ることがあるが、無い方が多い。その場合は
    J-STAGEと同じくDOI経由でOpenAlexから補完する。

    CiNiiはスペース区切りをANDとして扱うため、同義語を並べると
    「全語を含む論文」を探すことになり0件になる。1語ずつ検索する。
    """
    if not CINII_APPID:
        global _cinii_warned
        if not _cinii_warned:
            _cinii_warned = True
            tqdm.write("  [CiNii] CINII_APPID が未設定のため検索をスキップしました。"
                       "support.nii.ac.jp のAPI利用者登録でIDを取得し、"
                       "export CINII_APPID=\"...\" を設定してください。")
        return 0

    records, seen_ids = [], set()
    for term in _split_ja_terms(query_ja):
        try:
            for start_pos in (1, 201):   # 1回200件、最大400件まで
                res = _get("https://cir.nii.ac.jp/opensearch/articles", params={
                    "q": term, "count": 200, "start": start_pos,
                    "format": "json", "appid": CINII_APPID})
                if res.status_code != 200:
                    tqdm.write(f"  [CiNii] エラー {res.status_code}: {res.text[:120]}")
                    break
                payload = res.json()
                # CiNii Research は items を最上位に置く。@graph は旧CiNii
                # Articlesの形式で、こちらには存在しない。両方に備える。
                graph = payload.get("@graph") or []
                head = graph[0] if graph else payload
                items = head.get("items") or []
                if start_pos == 1 and not items:
                    # 総数0はPythonで偽値なので、or連鎖だと「不明」に化ける。
                    total = head.get("opensearch:totalResults")
                    if total is None:
                        total = payload.get("opensearch:totalResults")
                    tqdm.write(f"  [CiNii] 「{term}」はヒット0件"
                               f"(総数={total if total is not None else '不明'})")
                if not items:
                    break

                for it in items:
                    cid = it.get("@id")
                    if cid and cid in seen_ids:
                        continue   # 語をまたいで同じ論文が返るのは正常
                    if cid:
                        seen_ids.add(cid)

                    title = _jsonld_value(it, "title", "dc:title")
                    if _is_noise_title(title):
                        continue   # 巻頭言・目次などの非研究記事

                    creators = it.get("dc:creator") or []
                    if isinstance(creators, (str, dict)):
                        creators = [creators]
                    authors = []
                    for c in creators:
                        if isinstance(c, str):
                            authors.append(c)
                        elif isinstance(c, dict):
                            v = c.get("@value") or c.get("foaf:name")
                            if isinstance(v, list):
                                v = v[0] if v else None
                            if isinstance(v, dict):
                                v = v.get("@value")
                            if v:
                                authors.append(str(v))

                    desc = _jsonld_value(it, "description", "dc:description")
                    doi = _jsonld_value(it, "prism:doi", "dc:identifier") or None
                    if doi and not str(doi).lower().startswith("10."):
                        doi = None   # DOI以外の識別子が入ることがある

                    m = re.search(r"\d{4}", str(it.get("prism:publicationDate")
                                                or it.get("dc:date") or ""))
                    records.append({
                        "title": title, "year": m.group(0) if m else None,
                        "doi": str(doi).lower() if doi else None,
                        "url": cid, "authors": authors, "abstract": desc,
                    })
                if len(items) < 200:
                    break
                time.sleep(REQUEST_PAUSE)
        except Exception as e:
            tqdm.write(f"  [CiNii] 解析エラー: {type(e).__name__}: {e}")
        time.sleep(REQUEST_PAUSE)

    if not records:
        return 0

    # descriptionが短い(または無い)ものはDOIから補完する
    need = [r for r in records if len(r["abstract"]) < 200 and r.get("doi")]
    filled = _enrich_abstracts_by_doi(need) if need else {}

    n = dup = 0
    for r in records:
        text = r["abstract"]
        if len(text) < 200:
            text = filled.get(r["doi"] or "", text)
        if add("CiNii", r["title"], r["year"], text, url=r["url"],
               doi=r["doi"], authors=r["authors"]):
            n += 1
        else:
            # add()がFalseを返す理由は「抄録が短すぎる」か「既に収集済み」。
            dup += 1
    if records and n == 0:
        short = sum(1 for r in records
                    if len(r["abstract"]) < 200 and not filled.get(r["doi"] or ""))
        tqdm.write(f"  [CiNii] {len(records)}件ヒット → "
                   f"抄録が短い/取得できず{short}件 / 収集済みか重複{max(dup - short, 0)}件")
    return n


# ==========================================
# 国立国会図書館サーチ
# ==========================================
# OpenSearch応答の <description> は抄録ではない。「タイトル：… ／
# シリーズ名：… ／ 責任表示：…」という書誌の羅列がCDATAで入っているだけで、
# 日本語なので収集側の下限(MIN_ABSTRACT_LENGTH_JA=150字)を平気で超える。
# そのまま抄録として渡すと、書誌文字列を抄録だと思い込んだまま関連度判定が
# 走り、判定にもレポートにも使えない記録がカタログへ大量に載る。これが
# このDBで最も避けたい壊れ方なので、ラベルの数で機械的に弾く。
_NDL_BIBLIO_LABELS = (
    "タイトル：", "シリーズ名：", "責任表示：", "出版地：", "出版社：",
    "出版年月日等：", "大きさ、容量等：", "ISBN：", "価格：", "JP番号：",
    "部分タイトル：", "別タイトル：", "並列タイトル：", "資料の種別：",
    "刊行巻次：", "当該情報資源を採取した日：", "記事作成日：", "掲載誌名：",
)

_NDL_DOI_RE = re.compile(r'10\.\d{4,9}/[^\s"<>)\]}，、。]+')


def _looks_like_ndl_biblio(text: str) -> bool:
    """NDLの description が「抄録ではなく書誌の羅列」かどうか。"""
    t = (text or "").strip()
    if not t:
        return True
    if t.startswith("タイトル：") or t.startswith("<p>タイトル："):
        return True
    return sum(1 for lab in _NDL_BIBLIO_LABELS if lab in t) >= 2


def _ndl_doi(item) -> str:
    """item のどこかに紛れているDOIを拾う。無ければ空文字。

    NDLはDOIを専用の要素では返さない。dc:identifier に入ることもあれば、
    rdfs:seeAlso の rdf:resource 属性(要素のテキストではない)に
    https://doi.org/... の形で入ることもある。要素を1つずつ見るより、
    item をまるごと文字列にして拾う方が取りこぼしが少ない。
    """
    try:
        blob = ET.tostring(item, encoding="unicode")
    except Exception:
        return ""
    m = _NDL_DOI_RE.search(blob)
    return m.group(0).rstrip(".").lower() if m else ""


def _ndl_abstract(item) -> str:
    """item から「抄録らしいもの」だけを取り出す。無ければ空文字。

    description は名前空間なしのRSS側(書誌の羅列)と dc:description の
    両方が来る。dc:description には機関リポジトリ由来の本物の抄録が
    入っていることがあるため名前空間の付いた方を優先しつつ、どちらで
    あっても書誌の羅列に見えるものは捨てる。
    """
    cands = []
    for child in item:
        if _strip_ns(child.tag) not in ("description", "abstract"):
            continue
        txt = "".join(child.itertext()).strip()
        if not txt or _looks_like_ndl_biblio(txt):
            continue
        cands.append((0 if "}" in child.tag else 1, -len(txt), txt))
    cands.sort()
    return cands[0][2] if cands else ""


def fetch_ndl(query_ja: str, add) -> int:
    """国立国会図書館サーチ。キー不要。

    雑誌記事索引・図書・機関リポジトリ(IRDB)・デジタルコレクション等を
    横断する。日本語の実務誌・紀要・報告書・行政資料まで拾えるのが強みで、
    J-STAGEにもCiNiiにも無い資料が含まれる。

    弱点もはっきりしている。NDLサーチが返すのは基本的に書誌情報であり、
    抄録を持つ記録は機関リポジトリ由来など一部に限られる。抄録が無いものは
    J-STAGEと同じくDOI経由でOpenAlexから補完を試み、それでも得られなければ
    採用しない(抄録が無ければ関連度判定ができず、収集段階の下限でどのみち
    落ちる)。結果として「ヒットは多いが収録は少ない」になりやすいため、
    何件がどの理由で落ちたかを最後に必ず表示する。
    """
    records, seen_ids = [], set()
    total_hits = 0
    for term in _split_ja_terms(query_ja):
        try:
            res = _get("https://ndlsearch.ndl.go.jp/api/opensearch",
                       params={"any": term, "cnt": NDL_LIMIT})
            if res.status_code != 200:
                tqdm.write(f"  [NDLサーチ] エラー {res.status_code}: {res.text[:150]}")
                continue
            root = ET.fromstring(res.text)
            for e in root.iter():
                if (_strip_ns(e.tag) == "totalResults"
                        and (e.text or "").strip().isdigit()):
                    total_hits += int(e.text.strip())
                    break
            items = [e for e in root.iter() if _strip_ns(e.tag) == "item"]
            if not items:
                tqdm.write(f"  [NDLサーチ] 「{term}」はヒット0件")
                continue
            for it in items:
                vals = {}
                for child in it:
                    txt = "".join(child.itertext()).strip()
                    if txt:
                        vals.setdefault(_strip_ns(child.tag), []).append(txt)

                ident = (vals.get("guid") or vals.get("link") or [""])[0]
                if ident and ident in seen_ids:
                    continue      # 語をまたいで同じ記録が返るのは正常
                if ident:
                    seen_ids.add(ident)

                title = (vals.get("title") or [""])[0]
                if _is_noise_title(title):
                    continue      # 目次・広告などの非研究記事

                ystr = " ".join((vals.get("issued") or []) + (vals.get("date") or [])
                                + (vals.get("pubDate") or []))
                m = re.search(r"\d{4}", ystr)

                authors = []
                for a in (vals.get("creator") or vals.get("author") or []):
                    for one in re.split(r"[;；]", a):
                        one = re.sub(r"[／/]\s*$", "", one).strip()
                        if one:
                            authors.append(one)

                records.append({
                    "title": title,
                    "year": m.group(0) if m else None,
                    "doi": _ndl_doi(it) or None,
                    "url": (vals.get("link") or vals.get("guid") or [None])[0],
                    "authors": authors,
                    "venue": (vals.get("publicationName")
                              or vals.get("publisher") or [None])[0],
                    "abstract": _ndl_abstract(it),
                })
        except Exception as e:
            tqdm.write(f"  [NDLサーチ] 通信・解析エラー: {type(e).__name__}: {e}")
        time.sleep(REQUEST_PAUSE)

    if not records:
        return 0

    # 抄録が無いものはDOIからOpenAlexで補完する(J-STAGEと同じ手当て)
    need = [r for r in records if not r["abstract"] and r.get("doi")]
    filled = _enrich_abstracts_by_doi(need) if need else {}

    n = enriched = no_abs = dup = 0
    for r in records:
        text = r["abstract"]
        if not text and r.get("doi"):
            text = filled.get(r["doi"], "")
            if text:
                enriched += 1
        if not text:
            no_abs += 1   # 書誌しか無い記録。抄録が無いので採用しない
            continue
        if add("NDLサーチ", r["title"], r["year"], text, url=r["url"],
               doi=r["doi"], authors=r["authors"], venue=r["venue"]):
            n += 1
        else:
            dup += 1      # 他DBで収集済みか、抄録が下限未満
    tqdm.write(f"  [NDLサーチ] 取得{len(records)}件"
               + (f"(ヒット総数 {total_hits}件)" if total_hits else "")
               + f" → 収録{n}件 / 抄録なしで見送り{no_abs}件"
               + (f" / DOIから抄録を補完{enriched}件" if enriched else "")
               + (f" / 重複・抄録不足{dup}件" if dup else ""))
    return n


# 検索式の方言ごとにフェッチャを分類する。
# キー名は searchplan.render_queries() が返す辞書のキーと対応する。
ENGLISH_SOURCES = [
    ("OpenAlex", "openalex", fetch_openalex),
    ("PubMed", "pubmed", fetch_pubmed),
    ("Europe PMC", "europepmc", fetch_europe_pmc),
    ("Crossref", "crossref", fetch_crossref),
    ("Semantic Scholar", "simple_en", fetch_semantic_scholar),
    ("ERIC", "eric", fetch_eric),
]
JAPANESE_SOURCES = [
    ("J-STAGE", "simple_ja", fetch_jstage),
    ("CiNii", "simple_ja", fetch_cinii),
    ("NDLサーチ", "simple_ja", fetch_ndl),
]


def run_searches(queries: dict, add, include_japanese=True) -> dict:
    """組み立て済みの検索式群で全DBを検索する。{DB名: 追加件数} を返す。"""
    totals = {}
    sources = list(ENGLISH_SOURCES) + (list(JAPANESE_SOURCES) if include_japanese else [])
    for name, dialect, func in sources:
        q = queries.get(dialect)
        if not q:
            continue
        added = func(q, add)
        totals[name] = totals.get(name, 0) + added
        tqdm.write(f"  [{name}] +{added}件")
        time.sleep(REQUEST_PAUSE)
    return totals


# ==========================================
# 引用連鎖 (snowballing)
# ==========================================
def _openalex_ids_for_dois(dois: list) -> dict:
    """DOI → OpenAlex ID。OR フィルタは1回100件まで。"""
    out = {}
    dois = [d for d in dois if d]
    for i in range(0, len(dois), 50):
        chunk = dois[i:i + 50]
        try:
            params = _openalex_params({
                "filter": "doi:" + "|".join(chunk), "per-page": 100,
                "select": "id,doi,referenced_works,cited_by_count"})
            res = _get("https://api.openalex.org/works", params=params)
            if res.status_code != 200:
                tqdm.write(f"  [OpenAlex 引用連鎖] エラー {res.status_code}: {res.text[:150]}")
                continue
            for w in res.json().get("results", []):
                d = (w.get("doi") or "").lower().replace("https://doi.org/", "")
                if d:
                    out[d] = w
        except Exception as e:
            tqdm.write(f"  [OpenAlex 引用連鎖] 通信エラー: {e}")
        time.sleep(REQUEST_PAUSE)
    return out


def _fetch_openalex_works(ids: list, add, label: str):
    """OpenAlex IDのリストから本体を取得して収集に加える。

    戻り値は (追加件数, 追加できたDOIのリスト)。DOIリストは、次の世代の
    引用連鎖のシードに使う(snowball()のhops>1で必要)。
    """
    n = 0
    added_dois = []
    ids = [i for i in ids if i]
    for i in range(0, len(ids), 50):
        chunk = [x.rsplit("/", 1)[-1] for x in ids[i:i + 50]]
        try:
            params = _openalex_params({
                "filter": "openalex:" + "|".join(chunk) + ",has_abstract:true",
                "per-page": 100})
            res = _get("https://api.openalex.org/works", params=params)
            if res.status_code != 200:
                tqdm.write(f"  [OpenAlex 後方引用] エラー {res.status_code}: {res.text[:150]}")
                continue
            for it in res.json().get("results", []):
                doi = it.get("doi")
                authors = clean_authors([(a.get("author") or {}).get("display_name")
                                         for a in (it.get("authorships") or [])])
                if add(label, it.get("title"), it.get("publication_year"),
                       reconstruct_inverted_abstract(it.get("abstract_inverted_index")),
                       url=doi or it.get("id"), doi=doi, authors=authors,
                       openalex_id=it.get("id"), cited_by=it.get("cited_by_count"),
                   pmcid=_openalex_pmcid(it)):
                    n += 1
                    if doi:
                        added_dois.append(doi)
        except Exception as e:
            tqdm.write(f"  [OpenAlex 後方引用] 通信エラー: {type(e).__name__}: {e}")
        time.sleep(REQUEST_PAUSE)
    return n, added_dois


def snowball(seed_items: list, add, hops=1, max_seeds=25, min_gain=0.05) -> list:
    """シード論文から引用連鎖で文献を広げる。

    後方(その論文が引用している文献)と前方(その論文を引用している文献)の両方向。
    キーワード検索が取りこぼした中核文献を拾うのが目的。

    1論文あたり参考文献は平均50件前後あり指数的に膨らむため、
    シード数と世代数を絞り、新規獲得率が min_gain を下回った時点で打ち切る。
    戻り値は各ラウンドの記録(レポートの検索履歴に載せる)。
    """
    openalex_key_missing_warning()
    rounds = []
    seeds = [it for it in seed_items if it.get("doi")][:max_seeds]
    for hop in range(1, hops + 1):
        if not seeds:
            break
        before = len(seeds)
        tqdm.write(f"\n[引用連鎖 第{hop}世代] シード{before}件")

        meta = _openalex_ids_for_dois([it["doi"] for it in seeds])
        backward, forward_src = [], []
        for w in meta.values():
            backward.extend(w.get("referenced_works") or [])
            if w.get("id"):
                forward_src.append(w["id"].rsplit("/", 1)[-1])

        # 後方: 参考文献
        back_added, back_dois = _fetch_openalex_works(
            list(dict.fromkeys(backward)), add, "OpenAlex(後方引用)")
        tqdm.write(f"  後方引用から +{back_added}件")

        # 前方: 被引用
        fwd_added = 0
        fwd_dois = []
        for i in range(0, len(forward_src), 20):
            chunk = forward_src[i:i + 20]
            try:
                params = _openalex_params({
                    "filter": "cites:" + "|".join(chunk) + ",has_abstract:true",
                    "per-page": 100})
                res = _get("https://api.openalex.org/works", params=params)
                if res.status_code != 200:
                    tqdm.write(f"  [OpenAlex 前方引用] エラー {res.status_code}: {res.text[:150]}")
                    continue
                for it in res.json().get("results", []):
                    doi = it.get("doi")
                    authors = clean_authors([(a.get("author") or {}).get("display_name")
                                             for a in (it.get("authorships") or [])])
                    if add("OpenAlex(前方引用)", it.get("title"),
                           it.get("publication_year"),
                           reconstruct_inverted_abstract(it.get("abstract_inverted_index")),
                           url=doi or it.get("id"), doi=doi, authors=authors,
                           openalex_id=it.get("id"), cited_by=it.get("cited_by_count"),
                   pmcid=_openalex_pmcid(it)):
                        fwd_added += 1
                        if doi:
                            fwd_dois.append(doi)
            except Exception as e:
                tqdm.write(f"  [OpenAlex 前方引用] 通信エラー: {e}")
            time.sleep(REQUEST_PAUSE)
        tqdm.write(f"  前方引用から +{fwd_added}件")

        gained = back_added + fwd_added
        rounds.append({"hop": hop, "seeds": before,
                       "backward": back_added, "forward": fwd_added})
        # 新規獲得が乏しければ次の世代に進んでも費用対効果が合わない
        if gained == 0 or (before and gained / max(before, 1) < min_gain):
            tqdm.write("  新規獲得が乏しいため引用連鎖を打ち切ります。")
            break
        # 実測で判明したバグ: 以前はここで seeds = [] としており、
        # hops=2以上を指定しても2世代目のシードが常に空になって
        # 即座に打ち切られ、実質hops=1と変わらなかった。この世代で
        # 新規に追加できた文献(DOIを持つもの)を次世代のシードにする。
        seeds = [{"doi": d} for d in dict.fromkeys(back_dois + fwd_dois)][:max_seeds]
    return rounds


# ==========================================
# MeSH統制語の照合
# ==========================================
def validate_mesh_terms(terms: list) -> set:
    """候補のMeSH統制語をPubMedへ問い合わせ、実在するものだけを返す。

    LLMにMeSHを書かせると、それらしいが存在しない見出し語を作ることがある。
    存在しない語を[Mesh]タグ付きで投げるとPubMedはその語句を解決できず、
    検索式全体が静かに0件へ倒れる。esearchは解決できなかった語句を
    errorlist.phrasesnotfound に入れて返すので、これで判別できる。
    """
    ok = set()
    cand = [t.strip() for t in dict.fromkeys(terms or []) if t and t.strip()]
    if not cand:
        return ok
    for t in tqdm(cand, desc="MeSH統制語を照合", dynamic_ncols=True):
        try:
            p = {"db": "pubmed", "term": f'"{t}"[Mesh]', "retmax": 0,
                 "retmode": "json"}
            if NCBI_API_KEY:
                p["api_key"] = NCBI_API_KEY
            if ACADEMIC_EMAIL:
                p["email"] = ACADEMIC_EMAIL
            res = _get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
                       params=p)
            if res.status_code != 200:
                tqdm.write(f"  [MeSH照合] エラー {res.status_code}: {t}")
                continue
            r = res.json().get("esearchresult", {}) or {}
            notfound = (r.get("errorlist") or {}).get("phrasesnotfound") or []
            try:
                count = int(r.get("count") or 0)
            except (TypeError, ValueError):
                count = 0
            if count > 0 and not notfound:
                ok.add(t)
            else:
                tqdm.write(f"  [MeSH照合] 実在しない見出し語として除外: {t}")
        except Exception as e:
            tqdm.write(f"  [MeSH照合] 通信エラー: {type(e).__name__}: {e}")
        time.sleep(0.2)
    return ok


# ==========================================
# 撤回・取り下げの確認
# ==========================================
# 撤回された研究をレビューの根拠に使うのは、この領域では実害がある。
# 過去に気づけたのは、タイトルに【撤回論文】と書かれていたからで、
# 表記が無ければ素通りしていたということでもある。
#
# 網羅性についての但し書き:
#   OpenAlexの is_retracted は Crossref・PubMed の書誌情報に由来し、
#   撤回通知の反映が遅れることがある。DOIの無い文献は照合できない。
#   したがって「0件」は撤回が無いことの証明にはならない。検出した場合も
#   誤検出がありうるので、除外はせず印を付けるだけにする。
RETRACTION_TITLE_PATTERNS = (
    "retracted:", "retracted article", "retraction:", "retraction of",
    "retraction notice", "notice of retraction", "withdrawn:",
    "withdrawal of", "expression of concern",
)

# 日本語は「撤回」「取消」「取り下げ」単独では弾かない。福祉・法制度の
# 領域では、論文の撤回とは全く関係のない主題語として普通に現れるため。
# 実測で誤検出したもの:
#   「障害福祉サービス支給決定の取消をめぐる法的検討」  ← 行政処分の取消
#   「研究参加への同意の撤回に関する実践的課題」        ← インフォームド・コンセント
# どちらも先生方が実際に扱うテーマで、🛑「分析の根拠に使わないこと」の
# 印が付いてしまっていた。論文を指す文脈を伴う表記だけを見る。
RETRACTION_TITLE_PATTERNS_JA = (
    "撤回論文", "論文撤回", "撤回のお知らせ", "撤回告知", "撤回に関する告知",
    "掲載取消", "掲載の取消", "掲載取り下げ", "論文取り下げ",
    "取り下げのお知らせ",
)


def _retraction_title_hit(title: str) -> str:
    """タイトルに撤回・取り下げの表記があればその語を返す。

    抄録は見ない。撤回そのものを主題にした研究(撤回論文の計量書誌学的
    分析など)を誤って弾かないため、タイトルだけに限定する。
    """
    raw = title or ""
    t = raw.lower()
    for p in RETRACTION_TITLE_PATTERNS:
        if p in t:
            return p
    for p in RETRACTION_TITLE_PATTERNS_JA:
        if p in raw:
            return p
    return ""


def annotate_retractions(items: list) -> dict:
    """採用文献に撤回・取り下げの疑いを付ける。除外はしない。

    OpenAlexへDOIを50件ずつまとめて問い合わせる。引用連鎖で既に使って
    いる呼び出し方と同じなので、追加の負荷はほとんどない。
    """
    for it in items:
        it.setdefault("retracted", False)
        it.setdefault("retraction_note", "")

    by_doi = {}
    for it in items:
        d = (it.get("doi") or "").strip().lower()
        if d:
            by_doi.setdefault(d, []).append(it)

    dois = list(by_doi)
    api_flagged = 0
    for i in tqdm(range(0, len(dois), 50), desc="撤回の有無を確認",
                  dynamic_ncols=True):
        chunk = dois[i:i + 50]
        for use_select in (True, False):
            try:
                extra = {"filter": "doi:" + "|".join(chunk), "per-page": 50}
                if use_select:
                    extra["select"] = "doi,is_retracted,type"
                res = _get("https://api.openalex.org/works",
                           params=_openalex_params(extra))
                if res.status_code == 400 and use_select:
                    # selectのフィールド名が通らない場合に備えて全項目で拾い直す
                    tqdm.write("  [撤回確認] selectが拒否されました。"
                               "全項目を取得して再試行します。")
                    continue
                if res.status_code != 200:
                    tqdm.write(f"  [撤回確認] エラー {res.status_code}: "
                               f"{res.text[:150]}")
                    break
                for w in res.json().get("results", []):
                    d = (w.get("doi") or "").lower().replace("https://doi.org/", "")
                    notes = []
                    if w.get("is_retracted"):
                        notes.append("OpenAlexが撤回済みとしている")
                    if (w.get("type") or "").lower() == "retraction":
                        notes.append("この文献自体が撤回通知")
                    if not notes:
                        continue
                    for it in by_doi.get(d, []):
                        it["retracted"] = True
                        it["retraction_note"] = " / ".join(notes)
                        api_flagged += 1
                break
            except Exception as e:
                tqdm.write(f"  [撤回確認] 通信エラー: {type(e).__name__}: {e}")
                break
        time.sleep(REQUEST_PAUSE)

    title_flagged = 0
    for it in items:
        if it["retracted"]:
            continue
        hit = _retraction_title_hit(it.get("title"))
        if hit:
            it["retracted"] = True
            it["retraction_note"] = f"タイトルに「{hit}」の表記"
            title_flagged += 1

    no_doi = len([it for it in items if not (it.get("doi") or "").strip()])
    total = api_flagged + title_flagged
    if total:
        print(f"   → 撤回・取り下げの疑い {total}件"
              f"(OpenAlex {api_flagged}件 / タイトル表記 {title_flagged}件)")
    else:
        print("   → 撤回・取り下げの疑いは検出されませんでした"
              "(網羅的な確認ではありません)。")
    if no_doi:
        print(f"   → DOIが無く照合できなかった文献 {no_doi}件"
              f"(タイトル表記のみで確認)")
    return {"flagged": total, "api": api_flagged, "title": title_flagged,
            "no_doi": no_doi}


# ==========================================
# オープンアクセス全文の所在(Unpaywall)
# ==========================================
def annotate_open_access(items: list, limit=40) -> int:
    """中心候補のDOIについてOA全文の所在を調べ、item に oa_url を付ける。

    抄録だけでは効果量・サンプルサイズ・限界の記述が得られない。
    全文が読める文献を明示しておくと、レポートの薄さを人手で補える。
    """
    if not ACADEMIC_EMAIL:
        return 0
    n = 0
    targets = [it for it in items if it.get("doi")][:limit]
    for it in tqdm(targets, desc="OA全文の所在を確認", dynamic_ncols=True):
        try:
            res = _get(f"https://api.unpaywall.org/v2/{it['doi']}",
                       params={"email": ACADEMIC_EMAIL}, timeout=15)
            if res.status_code != 200:
                continue
            d = res.json()
            if d.get("is_oa"):
                loc = d.get("best_oa_location") or {}
                # PDFと着地ページを両方残す。全文取得(fulltext.py)は
                # 片方がだめならもう片方を試す。
                it["oa_pdf_url"] = loc.get("url_for_pdf") or ""
                it["oa_landing_url"] = (loc.get("url_for_landing_page")
                                        or loc.get("url") or "")
                it["oa_url"] = it["oa_pdf_url"] or it["oa_landing_url"]
                it["oa_status"] = d.get("oa_status")
                it["oa_host_type"] = loc.get("host_type") or ""
                if it.get("oa_url"):
                    n += 1
        except Exception:
            pass
        time.sleep(0.2)
    return n
