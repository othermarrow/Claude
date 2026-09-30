"""全文に関する処理をまとめる(旧 fulltext.py + fulltext_check.py)。

1. refine_with_fulltext() — 収集パイプラインの中で使う
   中心クラスタの文献について本文の Methods 章を取得し、judge.py の抽出が
   抄録だけで推定した設計・参加者数・場面・質指標を確かめ直す。

2. check_access() — 生成済みカタログに対して使う(research_bot.py fulltext / check)
   core 文献の全文へのアクセス可否を A/B/C に分けた一覧を書き出す。
     A) Europe PMC が OA 全文を配布(APIで機械的に取得できる)
     B) 無料で読めるが API 取得は不可(リンクを開く)
     C) OA版が見つからない
   --fetch で A の全文XMLを保存する。B は権利上の理由から自動取得しない。

本文の取り方(優先順):
  (1) Europe PMC の全文XML(JATS)。PMC収載のOA論文なら、Methods 章に
      sec-type="methods" などの印が付いているので、見出しの文字列を
      推測するより確実に切り出せる。
  (2) Unpaywall が示した OA の PDF / HTML。見出しらしい行で Methods 章を
      推測する簡易処理(外れることがある)。
取得に失敗しても例外は投げず、抄録ベースの推定値をそのまま残す。
悪化はしない。
"""

import html
import io
import os
import re
import time
import xml.etree.ElementTree as ET

import requests
from tqdm import tqdm

import catalog
import config
import judge
import llm
import sources

EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest"
UNPAYWALL = "https://api.unpaywall.org/v2"

# 長さ・時間・同時接続数の設定は config.py(FULLTEXT_*)にある。
MAX_BODY_CHARS = 400_000       # あまりに巨大なページは丸ごと処理しない
# 抽出した本文が FULLTEXT_MIN_USABLE_CHARS 未満、または抄録のこの倍率未満しか
# なければ、要旨だけのランディングページに過ぎないと判断して使わない。
LANDING_PAGE_RATIO = 1.5

# pypdf は依存先(cryptography)の壊れ方によって ImportError ではなく
# Rust 側のパニック(BaseException)を投げることがある。そこで全体が
# 落ちないよう、PDF を読めないだけの扱いにする。
try:
    from pypdf import PdfReader
    HAVE_PYPDF = True
except (KeyboardInterrupt, SystemExit):
    raise
except BaseException:
    HAVE_PYPDF = False

# HTML/PDF で Methods 章を推測するための見出し語
METHOD_HEADINGS = ("method", "materials and methods", "procedure", "participants",
                   "参加者", "対象と方法", "方法")
END_HEADINGS = ("results", "discussion", "findings", "結果", "考察")
# JATS の sec-type / title で Methods 章とみなす語
_JATS_METHOD_RE = re.compile(r"method|material|participant|procedure|design|"
                             r"subjects|setting|方法|対象", re.I)
_JATS_NOT_METHOD_RE = re.compile(r"result|discussion|conclusion|introduction|"
                                 r"background|結果|考察", re.I)

_SCRIPT_STYLE_RE = re.compile(r"<(script|style)[^>]*>.*?</\1>", re.DOTALL | re.I)
_TAG_RE = re.compile(r"<[^>]+>")
DOI_IN_URL = re.compile(r"(?:https?://(?:dx\.)?doi\.org/|^)(10\.\d{4,9}/[^\s\"<>]+)", re.I)


# ==========================================
# 通信
# ==========================================
def _get(url, params=None, timeout=None, attempt=0, headers=None):
    """GET。429/5xx は2回まで待って再試行する。失敗時は None。"""
    h = {"User-Agent": sources.USER_AGENT}
    h.update(headers or {})
    try:
        r = requests.get(url, params=params, headers=h,
                         timeout=timeout or config.FULLTEXT_TIMEOUT)
    except Exception:
        return None
    if r.status_code in (429, 500, 502, 503) and attempt < 2:
        time.sleep(3 * (attempt + 1))
        return _get(url, params, timeout, attempt + 1, headers)
    return r if r.status_code == 200 else None


def clean_doi(rec) -> str:
    """doi欄が空でも url / oa_url に埋もれた DOI を拾う(ERIC由来対策)。"""
    d = (rec.get("doi") or "").strip()
    if d and d.lower() not in ("なし", "none", "-"):
        m = DOI_IN_URL.search(d)
        if m:
            return m.group(1).rstrip(".")
    for field in ("url", "oa_url"):
        v = (rec.get(field) or "").strip()
        m = DOI_IN_URL.search(v) if v else None
        if m:
            return m.group(1).rstrip(".")
    return ""


def epmc_lookup(doi="", title="", pmcid="") -> dict:
    """Europe PMC で1件を引く。見つからなければ空の辞書。"""
    if pmcid:
        q = f"PMCID:{pmcid}"
    elif doi:
        q = f'DOI:"{doi}"'
    elif title:
        q = f'TITLE:"{title[:120]}"'
    else:
        return {}
    r = _get(f"{EPMC}/search", params={"query": q, "format": "json",
                                       "resultType": "core", "pageSize": 1})
    if r is None:
        return {}
    try:
        res = r.json().get("resultList", {}).get("result") or []
    except ValueError:
        return {}
    return res[0] if res else {}


def unpaywall(doi: str) -> dict:
    if not doi or not config.ACADEMIC_EMAIL:
        return {}
    r = _get(f"{UNPAYWALL}/{requests.utils.quote(doi)}",
             params={"email": config.ACADEMIC_EMAIL})
    try:
        return r.json() if r is not None else {}
    except ValueError:
        return {}


def fetch_epmc_xml(pmcid: str) -> str:
    r = _get(f"{EPMC}/{pmcid}/fullTextXML", timeout=60)
    if r is None:
        return ""
    body = r.text or ""
    return body if len(body) >= 500 else ""


# ==========================================
# 本文の切り出し
# ==========================================
def _strip_ns(tag) -> str:
    return tag.split("}")[-1] if isinstance(tag, str) else ""


def methods_from_jats(xml_text: str) -> str:
    """JATS XML から Methods 章の本文を取り出す。見つからなければ本文の先頭。

    表・図・参考文献は数字の羅列が多く、参加者数などの誤抽出を招くので落とす。
    """
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return ""
    for parent in root.iter():
        for child in list(parent):
            if _strip_ns(child.tag) in ("table-wrap", "fig", "ref-list",
                                        "supplementary-material"):
                parent.remove(child)
    body = next((e for e in root.iter() if _strip_ns(e.tag) == "body"), None)
    if body is None:
        return ""

    def title_of(sec):
        t = next((c for c in sec if _strip_ns(c.tag) == "title"), None)
        return "".join(t.itertext()).strip() if t is not None else ""

    picked = []
    for sec in body.iter():
        if _strip_ns(sec.tag) != "sec":
            continue
        label = f"{sec.get('sec-type') or ''} {title_of(sec)}"
        if _JATS_METHOD_RE.search(label) and not _JATS_NOT_METHOD_RE.search(label):
            picked.append(sec)
    # 入れ子の sec を二重に数えない(親が選ばれていれば子は飛ばす)
    nested = {id(d) for s in picked for d in s.iter() if d is not s}
    top = [s for s in picked if id(s) not in nested]

    def text(el):
        return re.sub(r"\s+", " ", " ".join(el.itertext())).strip()

    if top:
        return "\n\n".join(text(s) for s in top)[:config.FULLTEXT_METHODS_CHARS]
    return text(body)[:config.FULLTEXT_METHODS_CHARS]


def _html_to_text(raw_html: str) -> str:
    s = _SCRIPT_STYLE_RE.sub(" ", raw_html)
    s = _TAG_RE.sub("\n", s)
    s = html.unescape(s)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def _pdf_to_text(pdf_bytes: bytes) -> str:
    if not HAVE_PYPDF:
        return ""
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        if reader.is_encrypted:
            return ""
        return "\n".join((p.extract_text() or "") for p in reader.pages)
    except Exception:
        return ""


def _fetch_url_text(url: str):
    """URLから本文をプレーンテキストで取る。戻り値は (本文, "PDF"/"HTML")。"""
    try:
        res = requests.get(url, timeout=config.FULLTEXT_TIMEOUT,
                           headers={"User-Agent": "Mozilla/5.0 (academic research script)"})
    except Exception:
        return "", ""
    if res.status_code != 200:
        return "", ""
    ctype = (res.headers.get("Content-Type") or "").lower()
    if "pdf" in ctype or url.lower().split("?")[0].endswith(".pdf"):
        return _pdf_to_text(res.content).strip(), "PDF"
    return _html_to_text(res.text[:MAX_BODY_CHARS]).strip(), "HTML"


def _looks_usable(text: str, abstract: str) -> bool:
    """要旨だけのランディングページを弾く。厳密な判定ではない。"""
    if len(text) < config.FULLTEXT_MIN_USABLE_CHARS:
        return False
    if abstract and len(text) < len(abstract) * LANDING_PAGE_RATIO:
        return False
    return True


def isolate_methods(text: str) -> str:
    """HTML/PDF由来の本文から Methods 章らしき範囲を切り出す(簡易)。"""
    lines = text.splitlines()
    start = None
    for i, line in enumerate(lines):
        low = line.strip().lower()
        if low and len(low) <= 60 and any(h in low for h in METHOD_HEADINGS):
            start = i
            break
    if start is None:
        return text[:config.FULLTEXT_METHODS_CHARS]
    end = len(lines)
    for j in range(start + 1, len(lines)):
        low = lines[j].strip().lower()
        if low and len(low) <= 60 and any(h in low for h in END_HEADINGS):
            end = j
            break
    excerpt = "\n".join(lines[start:end]).strip()
    return (excerpt or text)[:config.FULLTEXT_METHODS_CHARS]


def get_methods_text(item: dict):
    """1件の Methods 章を取る。戻り値は (抜粋, 取得元ラベル, 失敗理由)。"""
    abstract = item.get("content") or item.get("abstract") or ""
    pmcid = sources.normalize_pmcid(item.get("pmcid"))
    doi = clean_doi(item)

    # (1) Europe PMC 全文XML
    if not pmcid and doi:
        e = epmc_lookup(doi=doi)
        if e.get("isOpenAccess") == "Y":
            pmcid = sources.normalize_pmcid(e.get("pmcid"))
            if pmcid:
                item["pmcid"] = pmcid
    if pmcid:
        xml_text = fetch_epmc_xml(pmcid)
        if xml_text:
            m = methods_from_jats(xml_text)
            if len(m) >= config.FULLTEXT_MIN_USABLE_CHARS // 2:
                return m, "Europe PMC全文XML", ""

    # (2) OA の PDF / HTML
    urls = [u for u in (item.get("oa_pdf_url"), item.get("oa_landing_url"),
                        item.get("oa_url")) if u]
    reason = "OA全文の所在が無い" if not urls and not pmcid else "取得失敗"
    for u in dict.fromkeys(urls):
        text, kind = _fetch_url_text(u)
        if not text:
            if u.lower().split("?")[0].endswith(".pdf") and not HAVE_PYPDF:
                reason = "PDFだがpypdfが無い"
            continue
        if not _looks_usable(text, abstract):
            reason = "要旨のみのページ"
            continue
        return isolate_methods(text), f"OA全文({kind})", ""
    return "", "", reason


# ==========================================
# 1. パイプライン内: 本文で設計・参加者を確かめ直す
# ==========================================
def _merge(item: dict, rec: dict) -> None:
    """本文由来の抽出結果を、抄録由来の値に重ねる。

    旧版は全項目を上書きしていた。Methods 章だけを渡すので、抄録の
    Results 側にあった記載(効果量・維持など)が消えることがあった。
    本文で「不明」になった項目は抄録の値を残し、質指標は和集合にする。
    """
    new = {}
    judge.apply_extraction(new, rec)
    if new["design_code"] != "NA":
        item["design_code"], item["design"] = new["design_code"], new["design"]
        item["design_detail"] = new["design_detail"] or item.get("design_detail", "")
    if new["participants_n"] is not None:
        item["participants_n"] = new["participants_n"]
    if new["setting"] != catalog.SETTING_LABELS["NA"]:
        item["setting"] = new["setting"]
    if new["population"]:
        item["population"] = new["population"]
    merged = list(item.get("quality_markers") or [])
    for m in new["quality_markers"]:
        if m not in merged:
            merged.append(m)
    item["quality_markers"] = merged


def refine_with_fulltext(items, topic, definition, model, limit=None) -> dict:
    """core 文献(足りなければスコア上位)の Methods 章から設計等を確かめ直す。

    対象は PMCID か OA の所在が分かっているもの、または DOI から Europe PMC
    の OA 版を探せるもの。戻り値は件数の内訳。
    """
    limit = config.FULLTEXT_REFINE_LIMIT if limit is None else limit
    ranked = sorted(items, key=lambda x: (x.get("cluster") != "core",
                                          -(x.get("relevance_score") or 0)))
    targets = [it for it in ranked
               if it.get("pmcid") or it.get("oa_url") or it.get("doi")][:limit]
    stats = {"attempted": 0, "used": 0, "sources": {}, "fail_reasons": {}}
    if not targets or limit <= 0:
        return stats
    if not HAVE_PYPDF:
        print("   [情報] pypdf が無いため PDF 形式のOAリンクは読めません"
              "(pip install pypdf)。Europe PMC の全文XMLは使えます。")
    print(f"   本文(Methods章)の取得を試みます: {len(targets)}件")

    def work(it):
        text, label, why = get_methods_text(it)
        if not text:
            return None, why
        excerpt = text[:config.FULLTEXT_METHODS_CHARS]
        m = judge.extract_records(
            [(it.get("title", "Untitled"),
              "Methods excerpt (from the full text; fuller than the abstract)",
              excerpt)], topic, definition, model, retries=1)
        rec = m.get(0)
        return (rec, label) if rec else (None, "抽出応答の解析に失敗")

    def on_result(it, res):
        stats["attempted"] += 1
        rec, info = res if res else (None, "処理中の例外")
        if rec is None:
            stats["fail_reasons"][info] = stats["fail_reasons"].get(info, 0) + 1
            return
        _merge(it, rec)
        it["fulltext_used"] = True
        it["fulltext_source"] = info
        stats["used"] += 1
        stats["sources"][info] = stats["sources"].get(info, 0) + 1

    llm.run_parallel(work, targets, "本文を取得・解析中", on_result=on_result,
                     concurrency=config.FULLTEXT_CONCURRENCY)
    shown = " / ".join(f"{k} {v}件" for k, v in stats["sources"].items())
    print(f"   → {stats['attempted']}件中 {stats['used']}件を本文で確認"
          + (f"({shown})" if shown else ""))
    for reason, n in stats["fail_reasons"].items():
        print(f"      {reason}: {n}件")
    return stats


# ==========================================
# 2. 生成済みカタログ: 全文アクセス可否の一覧
# ==========================================
def classify_access(key: str, rec: dict) -> dict:
    doi = clean_doi(rec)
    title = rec.get("title") or ""
    out = {"key": key, "doi": doi, "title": title,
           "year": rec.get("year", "-"), "score": rec.get("score", "-"),
           "design": rec.get("design", "-"),
           "fulltext_used": bool(rec.get("fulltext_used")),
           "pmcid": sources.normalize_pmcid(rec.get("pmcid")),
           "url": "", "grade": "C", "note": ""}

    e = epmc_lookup(doi=doi, title=title, pmcid=out["pmcid"])
    if e:
        out["pmcid"] = sources.normalize_pmcid(e.get("pmcid")) or out["pmcid"]
        if e.get("isOpenAccess") == "Y" and out["pmcid"]:
            out.update(grade="A", note="Europe PMC が OA 全文を配布",
                       url=f"https://europepmc.org/article/PMC/{out['pmcid']}")
            return out

    u = unpaywall(doi)
    if u.get("is_oa"):
        loc = u.get("best_oa_location") or {}
        out.update(grade="B", url=loc.get("url_for_pdf") or loc.get("url") or "",
                   note=f"無料で閲覧可({loc.get('host_type') or '?'})")
        return out

    oa = (rec.get("oa_url") or "").strip()
    if oa:
        out.update(grade="B", url=oa, note="カタログに OA リンクあり")
        return out
    if out["pmcid"]:
        out.update(grade="B", note="PMC に収載(個別閲覧)",
                   url=f"https://europepmc.org/article/PMC/{out['pmcid']}")
        return out
    if doi:
        out.update(url=f"https://doi.org/{doi}", note="OA版なし(所属機関経由で要確認)")
    else:
        out["note"] = "DOI なし"
    return out


def check_access(theme_arg: str, cluster: str = "core", fetch: bool = False) -> str:
    """テーマの core 文献について全文アクセス可否の一覧を書き出す。出力パスを返す。"""
    t = catalog.resolve_theme(theme_arg)
    if not t["index"]:
        raise FileNotFoundError(f"[index] …json が見つかりません: {t['dir']}")
    items = catalog.load_index(t["index"])["items"]
    targets = {k: v for k, v in items.items()
               if cluster == "all" or (v.get("cluster") or "").strip() == cluster}
    if not targets:
        print(f"[全文] 対象が0件です(cluster={cluster})。")
        return ""
    if not config.ACADEMIC_EMAIL:
        print("[警告] ACADEMIC_CONTACT_EMAIL が未設定のため、Unpaywall を使わず"
              "Europe PMC のみで判定します。")
    print(f"[全文] {t['name']}: 対象 {len(targets)}件(cluster={cluster})")

    results = []
    llm.run_parallel(lambda kv: classify_access(*kv), list(targets.items()),
                     "全文の所在を照会", on_result=lambda _j, r: r and results.append(r),
                     concurrency=config.FULLTEXT_CONCURRENCY)

    order = {"A": 0, "B": 1, "C": 2}
    results.sort(key=lambda r: (order[r["grade"]],
                                -(r["score"] if isinstance(r["score"], int) else 0)))
    counts = {g: sum(1 for r in results if r["grade"] == g) for g in "ABC"}

    fetched = []
    if fetch:
        out_dir = os.path.join(t["dir"], "fulltext")
        os.makedirs(out_dir, exist_ok=True)
        a_list = [r for r in results if r["grade"] == "A"]
        for r in tqdm(a_list, desc="全文XMLを保存", dynamic_ncols=True):
            body = fetch_epmc_xml(r["pmcid"])
            if body:
                with open(os.path.join(out_dir, f"{r['key']}.xml"), "w",
                          encoding="utf-8") as f:
                    f.write(body)
                fetched.append((r["key"], True, f"{len(body)}字"))
            else:
                fetched.append((r["key"], False, "取得失敗"))
            time.sleep(0.5)

    out_path = os.path.join(t["dir"], f"_fulltext__{t['name']}.md")
    verified = sum(1 for r in results if r["fulltext_used"])
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(f"---\ntopic: \"{t['name']}\"\ncluster: {cluster}\n---\n\n")
        f.write(f"# 全文アクセス可否 — {t['name']}\n\n")
        f.write(f"- 対象: {len(results)}件\n")
        f.write(f"- A 全文取得可: {counts['A']}件 / B 閲覧可: {counts['B']}件 / "
                f"C 不可: {counts['C']}件\n")
        f.write(f"- 収集時に本文(Methods章)で設計・参加者を確認済み: {verified}件\n\n")
        f.write("> [!tip] A は本文まで機械的に扱えます。"
                "B はリンクを開けば読めますが自動取得はしていません。\n\n")
        labels = {
            "A": ("1. 全文を取得できる文献", "Europe PMC が OA として配布。"
                  "`--fetch` で `fulltext/` に XML を保存できます。"),
            "B": ("2. 閲覧できる文献", "無料で読めますが、"
                  "権利上の理由から自動取得はしていません。リンクから開いてください。"),
            "C": ("3. OA版が見つからない文献", "所属機関の契約や"
                  "著者への請求が必要な場合があります。"),
        }
        for g in "ABC":
            title, note = labels[g]
            rows = [r for r in results if r["grade"] == g]
            f.write(f"## {title}({len(rows)}件)\n\n{note}\n\n")
            if not rows:
                f.write("なし。\n\n")
                continue
            for r in rows:
                f.write(f"### [{r['key']}] {catalog.cell(r['title'], 70)}\n\n")
                f.write(f"- {r['year']}年 / 関連度 {r['score']} / {r['design']}"
                        + (" / 📄本文で確認済み" if r["fulltext_used"] else "") + "\n")
                if r["url"]:
                    f.write(f"- [全文を開く]({r['url']})\n")
                f.write(f"- {r['note']}\n\n")
        if fetched:
            ok_n = sum(1 for _, ok, _ in fetched if ok)
            f.write(f"## 4. 取得結果({ok_n}/{len(fetched)}件成功)\n\n")
            for k, ok, msg in fetched:
                f.write(f"- [{k}] {'保存' if ok else '失敗'}: {msg}\n")

    print(f"[全文] A 取得可 {counts['A']}件 / B 閲覧可 {counts['B']}件 / "
          f"C 不可 {counts['C']}件")
    if fetched:
        print(f"[全文] 保存 {sum(1 for _, ok, _ in fetched if ok)}/{len(fetched)}件")
    print(f"[全文] 出力: {out_path}")
    return out_path
