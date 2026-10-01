"""抄録カタログの書き出し・読み取り・比較と、レポートまわりの処理。

カタログの書式を知っているのはこのモジュールだけにする。書式を変えるときは
ここだけを直せばよく、読み取り(relink・差分・再判定)側と食い違わない。

  build_catalog()   カタログ・索引・URL一覧・検索の記録・レポート生成プロンプト
  run_diff()        前回のカタログとの差分(旧 catalog_diff.py)
  relink_report()   生成済みレポートの引用キーを検証し、索引表を付ける
  unwikilink()      フロントマターのウィキリンクを文字列にする(旧 extract_wikilink_text.py)

レポート生成プロンプトは Claude と Gemini の双方で機能する形にしてある。
両ベンダーが共通して推奨する「長文を先・指示を後」の配置を前提に、
カタログ本体の後ろへ貼る運用にしている。専門領域などの言い回しは
config.py(PROMPT_*)で変えられる。
"""

import datetime
import glob
import hashlib
import json
import os
import re
import shutil
import time
import unicodedata

import requests
from tqdm import tqdm

import config
import sources
# OpenAlexとSemantic Scholarは「名 姓」の西欧順。PubMed・Crossref・ERIC・
# Europe PMCは「姓 名」の順。一律に先頭を姓とすると名が引用キーになる。
GIVEN_FIRST_SOURCES = {"OpenAlex", "Semantic Scholar",
                       "OpenAlex(後方引用)", "OpenAlex(前方引用)"}
# "off"(関連度 OFF_SCORE 以下)は RELEVANCE_THRESHOLD で必ず除外されるため、
# カタログには一度も現れない。並び順の定義に残しておくと、実態と
# 食い違う記述(プロンプトの「core → related → off → 未判定」等)を
# 誘発するので外してある。off の件数は除外ログ側で数えている。
# 未判定は並べ替えのために残しているが、書き出し時に本体から分離する。
CLUSTER_ORDER = ["core", "related", "未判定"]

# 研究設計・場面・質指標の語彙。抽出(judge.py)はモデルに英語コードを
# 書かせ、日本語ラベルはここで与える。自由記述の日本語ラベルを書かせると
# 表記が揺れて集計できなくなる。レポート生成プロンプトの略号の説明もここから作る。
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
# 集計・表示の並び順。エビデンスの強さの一般的な順に近づけてある。
DESIGN_ORDER = ["SR", "RCT", "QE", "SCED", "PP", "OBS", "PSY", "QUAL",
                "CASE", "REV", "THEO", "GUIDE", "NA"]
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

FILE_KINDS = {
    "catalog": ("[catalog] ", ".md"),
    "unjudged": ("[unjudged] ", ".md"),
    "report_prompt": ("[report_prompt] ", ".md"),
    "index": ("[index] ", ".json"),
    "urls": ("[urls] ", ".txt"),
    "excluded": ("[excluded] ", ".log"),
    "searchlog": ("[searchlog] ", ".md"),
}

# Androidのファイル名上限は255バイト。日本語はUTF-8で1文字3バイト消費するため、
# 文字数ではなくバイト数で切る。接頭辞・拡張子・連番の余地を引いておく。
MAX_FILENAME_BYTES = 240
_NAME_RESERVE = 25

BRACKET_RE = re.compile(r"[\[［]([^\]］]{1,300})[\]］]")
KEY_RE = re.compile(r"^[A-Za-z][A-Za-z'\-]*\d{4}[a-z]?$")
CATALOG_ENTRY_RE = re.compile(r"^###\s*\d+\.\s*\[([^\]]+)\]\s*(.*)$")

KEYRING_FILENAME = "[keyring] research.json"


# ==========================================
# ファイル名
# ==========================================
def _sanitize_core(topic: str) -> str:
    core = re.sub(r'[\\/*?:"<>|\[\]]', "_", str(topic or "")).strip()
    core = re.sub(r"\s+", " ", core).strip(" ._") or "untitled"
    limit = MAX_FILENAME_BYTES - _NAME_RESERVE
    while len(core.encode("utf-8")) > limit:
        core = core[:-1]
    return core.rstrip(" ._")


def build_path(output_dir, kind, core):
    prefix, ext = FILE_KINDS[kind]
    return os.path.join(output_dir, f"{prefix}{core}{ext}")


def build_paths(output_dir: str, topic: str) -> dict:
    """テーマごとの専用フォルダを作り、その中に一式を置く。

    1回の収集で6ファイルできるため、平置きにすると Vault が見通せなくなる。
    引用キーのレジストリだけは全テーマで共有する必要があるので、
    フォルダではなく親ディレクトリ(_root)に置く。
    """
    core = _sanitize_core(topic)
    cand, n = core, 1
    while os.path.exists(os.path.join(output_dir, cand)):
        cand = f"{core}_{n}"
        n += 1
    folder = os.path.join(output_dir, cand)
    os.makedirs(folder, exist_ok=True)
    paths = {k: build_path(folder, k, cand) for k in FILE_KINDS}
    paths["_folder"] = folder
    paths["_root"] = output_dir
    return paths


def index_path_for(catalog_path: str) -> str:
    d, name = os.path.dirname(catalog_path), os.path.basename(catalog_path)
    pre_c, ext_c = FILE_KINDS["catalog"]
    pre_i, ext_i = FILE_KINDS["index"]
    if name.startswith(pre_c) and name.endswith(ext_c):
        p = os.path.join(d, f"{pre_i}{name[len(pre_c):-len(ext_c)]}{ext_i}")
        if os.path.exists(p):
            return p
    return os.path.splitext(catalog_path)[0] + "_index.json"


def _find_kind(folder: str, kind: str, name: str):
    """フォルダ内の指定種別のファイルを探す。フォルダ名と同じテーマ名を優先する。"""
    prefix, ext = FILE_KINDS[kind]
    exact = os.path.join(folder, f"{prefix}{name}{ext}")
    if os.path.exists(exact):
        return exact
    try:
        cands = sorted(f for f in os.listdir(folder)
                       if f.startswith(prefix) and f.endswith(ext))
    except OSError:
        return None
    return os.path.join(folder, cands[0]) if cands else None


def resolve_theme(arg: str, root: str = None) -> dict:
    """テーマ名・テーマのフォルダ・カタログのパスのどれからでも、一式の場所を返す。

    check 系の処理(アンサンブル・全文・差分)は、以前はそれぞれ
    「テーマ名を受け取る」「カタログのパスを受け取る」と入口が違っていた。
    ここで一本化する。戻り値:
      {"name": テーマ名(フォルダ名), "dir": フォルダ,
       "catalog": [catalog]のパス, "index": [index]のパス}
    見つからなければ FileNotFoundError。
    """
    root = root or config.CATALOG_ROOT
    a = (arg or "").strip().rstrip("/")
    folder = None
    for cand in (a, os.path.join(root, a)):
        if os.path.isdir(cand):
            folder = cand
            break
        if os.path.isfile(cand):
            folder = os.path.dirname(cand) or "."
            break
    if folder is None:
        name = re.sub(r"^\[(catalog|index)\]\s*|^_catalog__|\.(md|json)$", "",
                      os.path.basename(a)).strip()
        if name and os.path.isdir(os.path.join(root, name)):
            folder = os.path.join(root, name)
    if folder is None:
        raise FileNotFoundError(f"テーマが見つかりません: {arg}(探した場所: {root})")
    folder = os.path.abspath(folder)
    name = os.path.basename(folder)
    return {"name": name, "dir": folder,
            "catalog": _find_kind(folder, "catalog", name),
            "index": _find_kind(folder, "index", name)}


def list_themes(root: str = None) -> list:
    """カタログのあるテーマ名の一覧。"""
    root = root or config.CATALOG_ROOT
    out = []
    try:
        names = sorted(os.listdir(root))
    except OSError:
        return out
    for d in names:
        folder = os.path.join(root, d)
        if d.startswith(".") or not os.path.isdir(folder):
            continue
        if _find_kind(folder, "index", d) or _find_kind(folder, "catalog", d):
            out.append(d)
    return out


def find_previous_plan(topic: str, root: str = None) -> tuple:
    """同じテーマ文を前に収集したときの検索計画。(計画, フォルダ名) を返す。

    フォルダ名は「テーマ」「テーマ_1」…と変わるので、索引の topic で照合し、
    最も新しいものを使う。見つからなければ (None, "")。
    """
    want = (topic or "").strip()
    if not want:
        return None, ""
    core = _sanitize_core(want.splitlines()[0])
    same = re.compile(re.escape(core) + r"(_\d+)?")
    best = ("", None, "")
    for name in list_themes(root):
        if not same.fullmatch(name):
            continue
        path = _find_kind(os.path.join(root or config.CATALOG_ROOT, name), "index", name)
        try:
            with open(path, encoding="utf-8") as f:
                d = json.load(f)
        except (OSError, TypeError, ValueError):
            continue
        plan = d.get("search_plan")
        if (d.get("topic") or "").strip() != want or not plan or not plan.get("facets"):
            continue
        stamp = d.get("generated_at") or ""
        if stamp >= best[0]:
            best = (stamp, plan, name)
    return best[1], best[2]


def plan_of_theme(arg: str, root: str = None) -> tuple:
    """指定したテーマのフォルダの索引から検索計画を読む。

    戻り値は (計画, フォルダ名, その回のテーマ文)。見つからない・検索計画が
    残っていなければ FileNotFoundError。
    """
    t = resolve_theme(arg, root)
    try:
        with open(t["index"] or "", encoding="utf-8") as f:
            d = json.load(f)
        plan, topic = d.get("search_plan"), (d.get("topic") or "").strip()
    except (OSError, ValueError):
        plan, topic = None, ""
    if not plan or not plan.get("facets"):
        raise FileNotFoundError(f"{t['name']} の索引に検索計画が残っていません"
                                "(検索計画を索引に残すようにした版より前の収集)")
    return plan, t["name"], topic


def read_catalog_abstracts(catalog_path: str) -> dict:
    """カタログ本文から {引用キー: 抄録} を読む。

    索引(JSON)は軽く保つため抄録を持たない。抄録が要る処理
    (アンサンブル判定)はここから読む。書式を知っているのはこのモジュール
    だけ、という原則を守るため、読み取りもここに置く。
    """
    out, cur, buf, in_abs = {}, None, [], False
    try:
        with open(catalog_path, encoding="utf-8") as f:
            lines = f.read().splitlines()
    except OSError:
        return out

    def flush():
        if cur is not None:
            out[cur] = "\n".join(buf).strip()

    for line in lines:
        m = CATALOG_ENTRY_RE.match(line)
        if m:
            flush()
            cur, buf, in_abs = m.group(1).strip(), [], False
            continue
        if cur is None:
            continue
        if line.startswith("**Abstract**"):
            in_abs = True
            rest = line.split(":", 1)[-1].strip() if ":" in line else ""
            if rest:
                buf.append(rest)
            continue
        if in_abs:
            if line.strip() == "---" or line.startswith("## "):
                in_abs = False
                continue
            buf.append(line)
    flush()
    return {k: ("" if v == "(抄録なし)" else v) for k, v in out.items()}


def load_index(index_path: str) -> dict:
    """[index] JSON を読む。形式が違えば ValueError。"""
    with open(index_path, encoding="utf-8") as f:
        d = json.load(f)
    if not isinstance(d.get("items"), dict):
        raise ValueError(f"items が見つからないか形式が異なります: {index_path}")
    return d


# ==========================================
# 抄録の整形
# ==========================================
def cell(text, limit: int = 0) -> str:
    """Markdown の表のセル・見出しに入れられる形にする。

    古いカタログにはタイトルに改行を含むものがあり(実例:
    "Pharmacologic Treatment" の後で改行)、そのまま表に入れると行が
    途中で切れて表が崩れていた。空白をまとめ、| をエスケープし、長ければ切る。
    """
    s = re.sub(r"\s+", " ", str(text or "")).strip().replace("|", "\\|")
    return s[:limit] + "…" if limit and len(s) > limit else s


def clean_abstract(text) -> str:
    """HTMLタグを除き、構造見出しは読める形に残す。

    Europe PMC は <h4>Background</h4> のような見出しタグ込みで返す。
    単純に除去すると節の切れ目が消えるため 【Background】 に変換する。
    """
    if not text:
        return ""
    s = str(text)
    s = re.sub(r"<h[1-6]>\s*([^<]{1,60}?)\s*</h[1-6]>", r" 【\1】 ", s, flags=re.I)
    s = re.sub(r"<(p|br|div)\s*/?>", " ", s, flags=re.I)
    s = re.sub(r"<[^>]{1,200}>", "", s)
    for a, b in (("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"),
                 ("&quot;", '"'), ("&#39;", "'"), ("&nbsp;", " ")):
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip()


# ==========================================
# 著者と引用キー
# ==========================================
_TRANSLIT = {"ø": "o", "Ø": "O", "đ": "d", "Đ": "D", "ð": "d", "þ": "th",
             "ł": "l", "Ł": "L", "ß": "ss", "æ": "ae", "Æ": "AE",
             "œ": "oe", "Œ": "OE", "ı": "i"}


def _deaccent(s: str) -> str:
    """発音区別符号を落とす。非ASCIIを削除すると Acuña→Acua と姓が壊れるため音訳する。"""
    nfkd = unicodedata.normalize("NFKD", s or "")
    stripped = "".join(c for c in nfkd if not unicodedata.combining(c))
    return "".join(_TRANSLIT.get(c, c) for c in stripped)


COLLECTIVE_MARKERS = re.compile(
    r"(society|association|group|committee|consortium|college|institute|academy|"
    r"foundation|network|collaboration|council|organi[sz]ation|centre|center|"
    r"department|ministry|university|hospital|trialists|investigators|"
    r"task force|working party|study group|initiative|alliance|federation|"
    r"board|panel|agency|bureau|authority|programme|program)", re.I)
_ACRONYM_STOPWORDS = {"the", "of", "and", "for", "in", "on", "at", "to", "a", "an",
                      "de", "der", "des", "du", "la", "le", "et"}
_NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v", "phd", "md", "msc",
                  "bsc", "rn", "ot", "otr", "ph.d", "m.d"}


def format_authors(authors: list) -> str:
    if not authors:
        return "著者情報なし"
    return "; ".join(authors[:6]) + (" 他" if len(authors) > 6 else "")


def is_collective_author(s: str) -> bool:
    """団体著者か。個人名の姓として扱うと [The2022] のような無意味なキーになる。"""
    s = (s or "").strip()
    if not s:
        return False
    if COLLECTIVE_MARKERS.search(s):
        return True
    tokens = [t for t in re.split(r"[,\s]+", s) if t]
    return bool(tokens) and tokens[0].lower() == "the"


def _collective_acronym(name: str) -> str:
    words = [w for w in re.split(r"[^A-Za-z0-9ぁ-んァ-ン一-龥]+", name or "") if w]
    if not words:
        return "Unknown"
    if len(words) == 1:
        return words[0][:12]
    ini = "".join(w[0].upper() for w in words
                  if w.lower() not in _ACRONYM_STOPWORDS and w[0].isalpha())
    return ini[:5] or words[0][:12]


def extract_surname(author_str: str, src: str) -> str:
    """著者名から引用キーの中核を取る。DBごとの語順(名 姓 / 姓 名)に対応する。"""
    s = (author_str or "").strip()
    if not s:
        return "Unknown"
    if is_collective_author(s):
        return _collective_acronym(s)
    tokens = [t for t in re.split(r"[,\s]+", s) if t]
    tokens = [t for t in tokens if t.lower().strip(".") not in _NAME_SUFFIXES] or tokens
    if not tokens:
        return "Unknown"
    # "Schuengel, Carlo" のようにカンマがあれば「姓, 名」形式。OpenAlexでも
    # 稀にこの形式で返るため、語順の判定はDB名よりカンマの有無を優先する。
    if "," in s:
        return tokens[0]
    return tokens[-1] if src in GIVEN_FIRST_SOURCES else tokens[0]


def _suffix(i: int) -> str:
    """重複キーの連番。1→a, 26→z, 27→aa …

    以前は chr(ord("a") + i - 1) で作っていたため、27件目以降が "{" 等の
    記号になっていた。過去のカタログのキーも予約するようにしたことで、
    同姓同年が26件を超える場面が現実に起こりうる。
    """
    s = ""
    while i > 0:
        i, r = divmod(i - 1, 26)
        s = chr(ord("a") + r) + s
    return s


def make_ref_key(surname, year, used_keys: set) -> str:
    """引用キーを1つ作る。used_keys に入っているキーは避け、作ったキーを加える。

    used_keys には「このカタログで確定した分」に加えて「過去のカタログで
    発行した分」も入れて渡すこと(build_catalog がそうしている)。
    """
    base = re.sub(r"[^A-Za-z0-9ぁ-んァ-ン一-龥]", "",
                  _deaccent(surname) or "Unknown") or "Unknown"
    y = re.sub(r"[^0-9]", "", str(year)) or "0000"
    key, i = f"{base}{y}", 0
    while f"{key}{_suffix(i)}" in used_keys:
        i += 1
    final = f"{key}{_suffix(i)}"
    used_keys.add(final)
    return final


def title_key(title: str) -> str:
    """DOIの無い文献を同定するためのタイトルの指紋。

    大文字小文字・記号・空白の揺れを落としてからハッシュにする
    (research_bot の重複排除と同じ正規化)。
    """
    nt = re.sub(r"[^a-zA-Z0-9ぁ-んァ-ン一-龥]", "", clean_abstract(title or "").lower())
    return f"t:{hashlib.md5(nt.encode()).hexdigest()[:16]}" if nt else ""


def load_keyring(output_dir: str) -> tuple:
    """引用キーのレジストリを読む。

    issued_keys は「過去のカタログで既に使ったキー」の集合。これを予約して
    おかないと、別のカタログにある同姓同年の別論文へ同じキーを割り当てて
    しまう。実測: レジストリ2469件のうち37個のキーが複数のDOIに割り当て
    られており、Horner1997 が3つの別論文を、岡田2021 が同一紀要の別々の
    3本を指していた。DOIを持たない文献は doi_to_key に載らないため、
    issued_keys を別に持たないと予約もできない。

    戻り値は (DOI→キー, 発行済みキーの集合, タイトル指紋→キー)。
    タイトル指紋はDOIの無い文献(J-STAGE・CiNii・ERICに多い)用。以前は
    DOIしか覚えていなかったため、DOIの無い文献は再生成のたびに別のキー
    (Tanaka2010a → Tanaka2010c)になり、既存レポートの引用が宙に浮いていた。
    """
    p = os.path.join(output_dir, KEYRING_FILENAME)
    if not os.path.exists(p):
        return {}, set(), {}
    try:
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        mapping = d.get("doi_to_key", {}) or {}
        titles = d.get("title_to_key", {}) or {}
        # issued_keys が無い古い形式のレジストリからも移行できるようにする
        issued = (set(d.get("issued_keys") or []) | set(mapping.values())
                  | set(titles.values()))
        return mapping, issued, titles
    except Exception:
        return {}, set(), {}


def save_keyring(output_dir: str, mapping: dict, issued=None, titles=None):
    p = os.path.join(output_dir, KEYRING_FILENAME)
    titles = titles or {}
    keys = sorted(set(issued or ()) | set(mapping.values()) | set(titles.values()))
    try:
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"updated_at": datetime.datetime.now().isoformat(timespec="seconds"),
                       "note": "DOI→引用キー、DOIの無い文献のタイトル指紋→引用キー、"
                               "発行済みキーの一覧。カタログ間で同じ論文に同じキーを"
                               "与え、別の論文に同じキーを与えないために使う。",
                       "doi_to_key": mapping,
                       "title_to_key": titles,
                       "issued_keys": keys},
                      f, ensure_ascii=False, indent=1, sort_keys=True)
        # 全テーマで共有するファイルなので、書き込み途中で落ちても壊れないようにする
        os.replace(tmp, p)
    except Exception as e:
        print(f"[警告] 引用キーレジストリを保存できませんでした: {e}")


def keyring_collisions(mapping: dict) -> dict:
    """別のDOIに同じキーが割り当てられている組を {キー: [DOI, ...]} で返す。"""
    rev = {}
    for doi, key in (mapping or {}).items():
        rev.setdefault(key, []).append(doi)
    return {k: v for k, v in rev.items() if len(v) > 1}


def _fetch_crossref_meta(doi: str) -> dict:
    if not doi:
        return {}
    try:
        res = requests.get(f"https://api.crossref.org/works/{doi}",
                           headers={"User-Agent": sources.USER_AGENT}, timeout=10)
        if res.status_code != 200:
            return {}
        msg = res.json().get("message", {})
        authors = []
        for a in msg.get("author", []) or []:
            fam, giv = (a.get("family") or "").strip(), (a.get("given") or "").strip()
            if fam:
                authors.append(f"{fam}, {giv}" if giv else fam)
        return {"authors": authors, "venue": (msg.get("container-title") or [None])[0]}
    except Exception:
        return {}


# ==========================================
# 重複の検知
# ==========================================
def _numeric_signature(a: str) -> set:
    return {p.replace(" ", "") for p in re.findall(r"\d+(?:\.\d+)?\s?%", a or "")}


def _surnames_for_dup(authors: list) -> set:
    out = set()
    for a in authors or []:
        t = [x for x in re.split(r"[,\s]+", a.strip()) if x]
        if t:
            out.add(t[0].lower())
            out.add(t[-1].lower())
    return out


def _fingerprint(a: str) -> str:
    return re.sub(r"[^a-z0-9ぁ-んァ-ン一-龥]", "", (a or "").lower())[:600]


# 略語の衝突等で、心理学・福祉・医療(臨床)・教育のいずれとも無関係な
# 分野の論文がcore判定をすり抜けてカタログに残る事例が実測された。
# FILTER_PROMPTには既に「いずれにも該当しない論文はスコア20以下」という
# 指示があるが、通り抜けることがある。誤検知で本当に必要な文献を失う
# 損失の方が大きいため、除外はせずカタログ上で警告するに留める
# (利用者が最終判断する)。語の一覧は config.OFF_DOMAIN_PATTERNS。
def _looks_off_domain(title: str, abstract: str) -> bool:
    """タイトル・抄録が明らかに対象外分野を示していないか判定する。"""
    text = f"{title or ''} {abstract or ''}".lower()
    return any(p in text for p in config.OFF_DOMAIN_PATTERNS)


_CJK_RE = re.compile(r"[\u3040-\u30ff\u4e00-\u9fff]")


def is_cjk(text: str) -> bool:
    """日本語(中国語を含む)の文章かどうかを、文字数と比率の両方で大まかに見る。

    収集の下限(MIN_ABSTRACT_LENGTH_JA)とカタログの「薄い抄録」の判定
    (THIN_ABSTRACT_CHARS_JA)で同じ基準を使う。日本語は1文字あたりの
    情報量が多いため、同じ字数で英語より内容がある。
    """
    if not text:
        return False
    n = len(_CJK_RE.findall(text))
    return n >= 20 and n / len(text) >= 0.2


def _thin_threshold(abstract: str) -> int:
    """抄録の言語に応じた薄さ判定の閾値を返す。"""
    return (config.THIN_ABSTRACT_CHARS_JA if is_cjk(abstract)
            else config.THIN_ABSTRACT_CHARS)


def _abstract_prefix_key(abstract: str, n: int = 150) -> str:
    """抄録の冒頭n文字を正規化して返す(部分一致による重複検出用)。

    _fingerprint()は抄録全体の完全一致でしか検出できないため、
    「ほぼ同一だが末尾の数文字が違う」「一方だけ結論が追記されている」
    といった実質的な重複を見逃していた(実測: 同一内容だがタイトルが
    異なる2件が検出されなかった)。冒頭部分だけを比べることで、
    こうした準重複を拾う。
    """
    t = unicodedata.normalize("NFKC", (abstract or "")).lower()
    t = re.sub(r"[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+", "", t)
    return t[:n] if len(t) >= n else ""


def flag_duplicates(entries: list) -> list:
    """同一研究・同一抄録の疑いを (キー1, キー2, 根拠) で返す。

    抄録本文の一致は著者の重なりを条件にしない。著者も年も違うのに抄録が同じ
    場合、どちらかの抄録が取り違えられている可能性があり、著者一致を条件に
    するとまさにその取り違えを見逃すため。
    """
    flags = []
    fps = [_fingerprint(e["abstract"]) for e in entries]
    prefixes = [_abstract_prefix_key(e["abstract"]) for e in entries]
    sig = [(_numeric_signature(e["abstract"]), _surnames_for_dup(e["_raw_authors"]))
           for e in entries]
    for i in range(len(entries)):
        for j in range(i + 1, len(entries)):
            if fps[i] and fps[i] == fps[j]:
                shared = sig[i][1] & sig[j][1]
                note = ("抄録本文が同一。著者も重なるため異版の可能性が高い" if shared else
                        "抄録本文が同一だが著者が重ならない。いずれかの抄録が"
                        "取り違えられている可能性がある。DOIを照合すること")
                flags.append((entries[i]["ref_key"], entries[j]["ref_key"], note))
                continue
            # 完全一致ではないが冒頭が一致する準重複(再掲載・改訂版等)
            if prefixes[i] and prefixes[i] == prefixes[j]:
                shared = sig[i][1] & sig[j][1]
                note = ("抄録の冒頭が一致。再掲載・改訂版の可能性が高い"
                        if shared else
                        "抄録の冒頭が一致するが著者が重ならない。"
                        "取り違えの可能性があるためDOIを照合すること")
                flags.append((entries[i]["ref_key"], entries[j]["ref_key"], note))
                continue
            nums = sig[i][0] & sig[j][0]
            if len(nums) >= 2 and (sig[i][1] & sig[j][1]):
                flags.append((entries[i]["ref_key"], entries[j]["ref_key"],
                              f"共通する数値 {', '.join(sorted(nums))}"))
    return flags


# ==========================================
# カタログの書き出し
# ==========================================
def _cluster_rank(c):
    c = (c or "未判定").strip()
    return CLUSTER_ORDER.index(c) if c in CLUSTER_ORDER else len(CLUSTER_ORDER)


def _year_int(v):
    s = str(v or "")
    return int(s) if s.isdigit() else 0


DESIGN_STRENGTH_ORDER = [DESIGN_LABELS[c] for c in DESIGN_ORDER]


def _tally(values, order=None):
    """値ごとの件数と、表示順に並べたキーを返す。"""
    t = {}
    for v in values:
        if v:
            t[v] = t.get(v, 0) + 1
    order = order or []
    keys = [k for k in order if k in t]
    keys += sorted((k for k in t if k not in order), key=lambda k: -t[k])
    return t, keys


def _evidence_summary(entries) -> list:
    """中心クラスタのエビデンス構成をカタログ冒頭に置く行を組み立てる。

    関連度と被引用数だけでは「何がどれだけ分かっているか」が読めない。
    単一事例実験が33件なのか、群間比較が3件なのかで、レポートで書ける
    強さが変わる。抽出パスを回していない場合(全件が「不明」)は何も
    出さないので、従来どおりのカタログになる。
    """
    core = [e for e in entries if e["cluster"] == "core"]
    label = "中心クラスタ"
    if not core:
        # 中心が空のときに「中心クラスタの内訳」と称して採用文献全体を
        # 集計していると、読み手も生成モデルも取り違える。
        core = [e for e in entries if e["cluster"] in ("core", "related")]
        label = "採用文献全体"
    if not core:
        return []
    if all((e.get("design") or "不明") == "不明" for e in core):
        return []

    lines = []
    t, keys = _tally([e.get("design") for e in core], DESIGN_STRENGTH_ORDER)
    lines += [f"**{label}の設計内訳**: "
              + " / ".join(f"{k} {t[k]}件" for k in keys), ""]

    ns = [e["n"] for e in core if e.get("n")]
    if ns:
        s = sorted(ns)
        med = s[len(s) // 2]
        lines += [f"**{label}の参加者数**: 記載あり {len(ns)}件 / "
                  f"合計 {sum(ns)}名 / 中央値 {med}名 "
                  f"(記載なし {len(core) - len(ns)}件)", ""]

    st, skeys = _tally([e.get("setting") for e in core
                        if e.get("setting") and e.get("setting") != "不明"])
    if st:
        lines += [f"**{label}の場面**: "
                  + " / ".join(f"{k} {st[k]}件" for k in skeys), ""]

    ft = [e for e in core if e.get("fulltext_used")]
    if ft:
        lines += [f"**本文で確認できた文献**: {label}{len(core)}件中{len(ft)}件は"
                  "抄録ではなく本文(Methods章)で設計・参加者情報を確認済み。"
                  "残りは抄録のみに基づく推定。", ""]

    sced = [e for e in core if e.get("design") == "単一事例実験"]
    if sced:
        mt, mkeys = _tally([m for e in sced for m in (e.get("markers") or [])])
        body = (" / ".join(f"{k} {mt[k]}件" for k in mkeys) if mt
                else "抄録に明記されたものは無い")
        lines += [f"**単一事例実験{len(sced)}件のうち抄録に質指標の記載が"
                  f"あるもの**: " + body
                  + "。記載が無いことは実施していないことを意味しない。", ""]

    if not any(t.get(k) for k in ("系統的レビュー・メタ分析",
                                  "ランダム化比較試験", "非ランダム化群間比較")):
        lines += [f"**⚠️ {label}に群間比較・統合研究が無い** "
                  "このテーマの知見は単一事例・事例報告・総説に限られる。"
                  "効果の大きさや一般化について強い主張はできない。", ""]
    return lines


def models_label(counts) -> str:
    """{モデル: 件数} を表示用の1行にする。1つだけならモデル名だけ。"""
    counts = {m: n for m, n in (counts or {}).items() if m}
    if len(counts) <= 1:
        return next(iter(counts), "")
    return " / ".join(f"{m} {n}件" for m, n in
                      sorted(counts.items(), key=lambda x: -x[1]))


def build_catalog(final_items, meta: dict, paths: dict, crossref_fallback=True) -> dict:
    """カタログ・索引・URLリスト・レポートプロンプトを書き出す。

    meta には topic / definition / plan_text / counts / search_log を入れる。
    """
    # レジストリはテーマ別フォルダではなく親ディレクトリに置く。
    # カタログをまたいで同じ論文に同じ引用キーを与えるため。
    key_dir = paths.get("_root") or os.path.dirname(paths["catalog"])
    keyring, issued_keys, title_ring = load_keyring(key_dir)
    keyring_hits = 0
    used_keys, entries = set(), []
    fallback = unresolved = 0
    src_counts, cluster_counts = {}, {}

    ordered = sorted(final_items,
                     key=lambda x: (_cluster_rank(x.get("cluster")),
                                    -_year_int(x.get("year"))))

    for it in tqdm(ordered, desc="カタログ生成中", dynamic_ncols=True):
        src = it.get("src", "")
        src_counts[src] = src_counts.get(src, 0) + 1
        cluster = (it.get("cluster") or "未判定").strip()
        cluster_counts[cluster] = cluster_counts.get(cluster, 0) + 1

        native = [a for a in (it.get("authors") or []) if a]
        venue = it.get("venue") or "掲載誌情報なし"
        if native:
            disp, surname, dup_authors = format_authors(native), extract_surname(native[0], src), native
        elif crossref_fallback and it.get("doi"):
            fallback += 1
            info = _fetch_crossref_meta(it["doi"])
            time.sleep(0.8)
            if info.get("authors"):
                disp = format_authors(info["authors"])
                surname = extract_surname(info["authors"][0], "Crossref")
                dup_authors = info["authors"]
            else:
                disp, surname, dup_authors = "著者情報取得不可", "", []
                unresolved += 1
            venue = info.get("venue") or venue
        else:
            disp, surname, dup_authors = "著者情報取得不可", "", []
            unresolved += 1

        doi_norm = (it.get("doi") or "").strip().lower()
        tkey = "" if doi_norm else title_key(it.get("title"))
        known = keyring.get(doi_norm) if doi_norm else title_ring.get(tkey)
        if known and known not in used_keys:
            used_keys.add(known)
            keyring_hits += 1
        else:
            known = None

        entries.append({
            "ref_key": known, "_surname": surname, "_doi_norm": doi_norm,
            "_title_key": tkey,
            "title": it.get("title", "Untitled"),
            "year": str(it.get("year") or "Unknown"),
            "authors": disp, "_raw_authors": dup_authors, "venue": venue,
            "src": src, "doi": it.get("doi") or "なし",
            "url": it.get("url") or "なし",
            "oa_url": it.get("oa_url"), "cited_by": it.get("cited_by"),
            "score": it.get("relevance_score"), "cluster": cluster,
            "design": it.get("design") or "不明",
            "design_code": it.get("design_code") or "NA",
            "design_detail": it.get("design_detail") or "",
            "n": it.get("participants_n"),
            "population": it.get("population") or "",
            "setting": it.get("setting") or "不明",
            "markers": it.get("quality_markers") or [],
            "peer_reviewed": it.get("peer_reviewed"),
            "retracted": bool(it.get("retracted")),
            "retraction_note": it.get("retraction_note") or "",
            "fulltext_used": bool(it.get("fulltext_used")),
            "fulltext_source": it.get("fulltext_source") or "",
            "pmcid": it.get("pmcid") or "",
            "measured": it.get("measured"),
            "judge_model": it.get("judge_model") or "",
            "reason": (it.get("exclusion_reason") or "").strip(),
            "abstract": clean_abstract(it.get("content", "")),
        })

    # 新しいキーを作るときは、このカタログで確定した分に加えて、過去の
    # カタログで発行したキーも避ける。避けないと、別のカタログにある
    # 同姓同年の別論文と同じキーになり、レポートを突き合わせたときに
    # [Horner1997] がどの論文を指すのか決められなくなる。
    taken = set(used_keys) | issued_keys
    for e in entries:
        if e["ref_key"] is None:
            e["ref_key"] = make_ref_key(e["_surname"], e["year"], taken)
            used_keys.add(e["ref_key"])
        if e["_doi_norm"]:
            keyring[e["_doi_norm"]] = e["ref_key"]
        elif e["_title_key"]:
            title_ring[e["_title_key"]] = e["ref_key"]
    save_keyring(key_dir, keyring, issued_keys | used_keys, title_ring)

    old_collisions = keyring_collisions(keyring)
    if old_collisions:
        print(f"[警告] 引用キーレジストリに、別のDOIへ同じキーが割り当てられて"
              f"いる組が{len(old_collisions)}件あります。"
              f"例: {', '.join(sorted(old_collisions)[:5])}")
        print("       過去のカタログで作られたもので、今回の収集からは新たに"
              "作られません。過去分を揃え直すにはレジストリを消して各カタログを"
              "作り直す必要があり、引用キーが変わるため既存レポートの"
              "relinkもやり直しになります。")

    # 未判定はカタログ本体から分離する。
    # 未判定は関連度の判定を一度も通っていない抄録で、実測では収録件数の
    # 24〜71%(11カタログ合計4428件中1927件=44%)を占めていた。中身を見ると
    # 主題と無関係な文献が大半で(脳損傷者の更衣動作、多発性硬化症の心の理論、
    # トルコ語版看護尺度など)、本体に混ぜると「カタログに載っている＝最低限の
    # 選別を通った」という保証が失われる。しかもその選別を、数百件分まとめて
    # レポート生成モデルに押しつけることになり、現実には機能しない。
    # 別ファイルへ出し、人が見直したいときだけ開く形にする。
    # 引用キーは付けたままにする(次回の収集で判定できたとき、同じ論文に
    # 同じキーが割り当たるようレジストリを保つため)。
    unjudged = [e for e in entries if e["cluster"] == "未判定"]
    entries = [e for e in entries if e["cluster"] != "未判定"]
    cluster_counts.pop("未判定", None)
    src_counts = {}
    for e in entries:
        src_counts[e["src"]] = src_counts.get(e["src"], 0) + 1

    dups = flag_duplicates(entries)
    scores = [e["score"] for e in entries if e["score"] is not None]
    core_score = int(meta.get("core_score") or config.CORE_SCORE)
    # 基準を下げた回は core が基準未満になるのが当たり前なので、
    # 「core判定だが基準未満」の警告を出しても意味がない(冒頭の注記で足りる)。
    inconsistent = set() if meta.get("cluster_note") else {
        e["ref_key"] for e in entries
        if e["cluster"] == "core" and e["score"] is not None
        and e["score"] < core_score}
    thin = [e["ref_key"] for e in entries
           if len(e["abstract"]) < _thin_threshold(e["abstract"])]
    # 略語衝突等で対象外分野の論文がすり抜けていないか(除外はせず警告のみ)。
    # 以前は core/related だけを見ていたが、判定を通っていない未判定こそが
    # 最も紛れ込みやすい。未判定は本体から分離したので、こちらは本体全件を
    # 対象にし、未判定側は [unjudged] ファイル内で1件ずつ印を付ける。
    off_domain = [e["ref_key"] for e in entries
                  if _looks_off_domain(e["title"], e["abstract"])]

    # ERICは査読の有無を返す。Falseと明記されたものは、報告書・
    # カリキュラム資料・会議発表等のグレイリテラチャであることが多い。
    # 除外はしないが、中心クラスタに入っているものは知らせる。
    not_peer = [e["ref_key"] for e in entries
                if e.get("peer_reviewed") is False
                and e["cluster"] in ("core", "related")]
    retracted = [e for e in entries if e["retracted"]]
    # 総説・理論・ガイドラインは自ら測定を行わない。それがcoreに入って
    # いるということは measured=true の判定が誤っている可能性が高い。
    # 設計欄が入ったことで初めて機械的に検出できるようになった食い違い。
    core_theory = [e["ref_key"] for e in entries
                   if e["cluster"] == "core"
                   and e.get("design") in ("総説・解説", "理論・概念",
                                           "ガイドライン・行政資料")]
    evidence_lines = _evidence_summary(entries)
    # 判定の途中でモデルが応答しなくなり、代わりのモデルへ切り替えた回は
    # 内訳を残す(config.FALLBACK_ORDER)。モデルによって判定の傾向は違う。
    judge_models = {}
    for e in entries:
        if e["judge_model"]:
            judge_models[e["judge_model"]] = judge_models.get(e["judge_model"], 0) + 1
    meta["judge_models"] = judge_models
    main_model = meta.get("filter_model") or ""
    # 系統的レビュー・メタ分析は自ら測定を行わないため、measured による
    # 機械判定では related に回る。中心的な根拠になりうるので拾い上げる。
    review_in_related = [e["ref_key"] for e in entries
                         if e["cluster"] == "related"
                         and e.get("design") == "系統的レビュー・メタ分析"]

    c = meta.get("counts", {})
    lines = [
        "# 抄録カタログ", "",
        f"**テーマ**: {meta['topic']}", "",
        f"**テーマの定義**: {meta['definition']}", "",
        f"**総収録数**: {len(entries)}件 "
        f"(収集直後: {c.get('collected', 0)}件 / 関連度不足による除外: {c.get('excluded', 0)}件"
        + (f" / 未判定として分離: {len(unjudged)}件" if unjudged else "") + ")",
        "",
        "**採用スコア範囲**: " + (f"{min(scores)} 〜 {max(scores)}" if scores else "算出不可")
        + ("" if len(scores) == len(entries) else f" (未判定 {len(entries)-len(scores)}件を除く)"),
        "",
        "**クラスタ内訳**: " + " / ".join(f"{k}: {cluster_counts.get(k, 0)}件"
                                          for k in CLUSTER_ORDER if cluster_counts.get(k)),
        "",
        "**取得元内訳**: " + " / ".join(f"{k}: {v}件" for k, v in src_counts.items()),
        "",
    ] + evidence_lines + [
        "**引用キーの規約**: 末尾が0000のキーは発行年不明を意味する。",
        "",
    ]
    if unjudged:
        lines += [f"**未判定 {len(unjudged)}件は本カタログから分離しました。** "
                  f"`{os.path.basename(paths['unjudged'])}` にあります。"
                  "自動判定に失敗し、関連度による選別を一度も通っていない"
                  "抄録です。本カタログの引用キー索引には載せていないため、"
                  "レポートから引用することはできません。", ""]
    if meta.get("cluster_note"):
        lines += [f"**⚠️ 中心クラスタの基準について** {meta['cluster_note']}", ""]
    if len(judge_models) > 1:
        lines += [f"**⚠️ 判定モデルが途中で切り替わっている**: {models_label(judge_models)}。"
                  f"{main_model or '本来のモデル'} が応答しなくなったため、代わりのモデルで"
                  "判定を続けた。モデルによって関連度の付け方に傾向の違いがあるため、"
                  "代わりのモデルで判定した抄録(各項目の「判定モデル」欄)は分類を"
                  "自分でも確かめること。", ""]
    if retracted:
        lines += [f"**🛑 撤回・取り下げの疑い: {len(retracted)}件** "
                  "撤回された研究は分析の根拠に使わないこと(撤回されたという"
                  "事実そのものに触れるのは差し支えない)。自動検出であり、"
                  "見落としも誤検出もある。", ""]
        lines += [f"- [{e['ref_key']}] {e['retraction_note']}" for e in retracted]
        lines.append("")
    if core_theory:
        lines += [f"**⚠️ core判定だが設計が非実証: {len(core_theory)}件** "
                  "総説・理論・ガイドラインは自ら測定を行わないため、本来は"
                  "中心クラスタに入らない。関連度の判定が概念の一致だけで"
                  "高く出ている可能性がある。分類を自分で見直すこと。 "
                  "該当: " + ", ".join(core_theory), ""]
    if inconsistent:
        lines += [f"**⚠️ core判定だが関連度{core_score - 1}以下: {len(inconsistent)}件** "
                  "スコア基準では「対象そのものが主題ではない」帯にあたる。"
                  "中心クラスタに入れる前に、方法・結果で対象が実際に測定されているか"
                  "個別に確認すること。索引表の「確認」欄に印がある。", ""]
    if not_peer:
        lines += [f"**⚠️ 査読を経ていない文献: {len(not_peer)}件** "
                  "ERICが査読なしと明記している。報告書・カリキュラム資料・"
                  "会議発表等が含まれる。根拠として使えないわけではないが、"
                  "査読済み研究と同じ重みで扱わないこと。 "
                  "該当: " + ", ".join(not_peer), ""]
    if thin:
        lines += [f"**⚠️ 抄録が短すぎる(英語{config.THIN_ABSTRACT_CHARS}字/日本語"
                  f"{config.THIN_ABSTRACT_CHARS_JA}字未満): {len(thin)}件** "
                  "書誌情報のみで内容の判断ができない。分析の根拠に使わないこと。 "
                  "該当: " + ", ".join(thin), ""]
    if off_domain:
        lines += [f"**⚠️ 対象外分野の可能性: {len(off_domain)}件** "
                  "略語の衝突等により、心理学・福祉・医療・教育のいずれとも"
                  "無関係な分野の論文が紛れ込んでいる可能性がある。"
                  "分析の根拠に使う前に個別に確認すること。 "
                  "該当: " + ", ".join(off_domain), ""]
    if review_in_related:
        lines += [f"**⚠️ 周辺クラスタにある統合研究: {len(review_in_related)}件** "
                  "系統的レビュー・メタ分析は自ら測定を行わないため機械判定"
                  "では周辺に回るが、中心的な根拠になりうる。個別に確認する"
                  "こと。 該当: " + ", ".join(review_in_related), ""]
    if dups:
        lines += ["**⚠️ 同一研究・同一抄録の疑い(自動検出・要確認)**", ""]
        lines += [f"- [{a}] と [{b}] : {n}" for a, b, n in dups]
        lines.append("")

    lines += ["---", "", "## 引用キー索引", "",
              "本文で使用できる引用キーは以下がすべてである。ここに無いキーを作成してはならない。",
              "", "| 引用キー | 年 | クラスタ | 設計 | n | 場面 | 関連度 | 被引用 | 全文 | 確認 | タイトル |",
              "|---|---|---|---|---|---|---|---|---|---|---|"]
    for e in entries:
        t = cell(e["title"], 60)
        lines.append(
            f"| {e['ref_key']} | {e['year']} | {e['cluster']} | "
            f"{e['design_code'] if e['design_code'] != 'NA' else '-'} | "
            f"{e['n'] if e['n'] is not None else '-'} | "
            f"{e['setting'] if e['setting'] != '不明' else '-'} | "
            f"{e['score'] if e['score'] is not None else '-'} | "
            f"{e['cited_by'] if e['cited_by'] is not None else '-'} | "
            f"{'OA' if e['oa_url'] else '-'} | "
            f"{'🛑' if e['retracted'] else ''}"
            f"{'⚠️' if e['ref_key'] in inconsistent else ''} | {t} |")
    lines += ["", "---", ""]

    cur = None
    for i, e in enumerate(entries):
        if e["cluster"] != cur:
            cur = e["cluster"]
            lines += [f"## クラスタ: {cur} ({cluster_counts.get(cur, 0)}件)", ""]
        sc = f" | **関連度**: {e['score']}" if e["score"] is not None else ""
        cb = f" | **被引用**: {e['cited_by']}" if e["cited_by"] is not None else ""
        lines.append(f"### {i+1}. [{e['ref_key']}] {e['title']}")
        if e["retracted"]:
            lines.append(f"- **🛑 撤回・取り下げの疑い**: {e['retraction_note']}。"
                         "分析の根拠に使わないこと。")
        lines.append(f"- **著者**: {e['authors']}")
        lines.append(f"- **Year**: {e['year']} | **Source**: {e['src']}{sc}{cb}"
                     f" | **クラスタ**: {e['cluster']}")
        lines.append(
            f"- **設計**: {e['design']}"
            + (f"({e['design_detail']})" if e["design_detail"] else "")
            + (f" | **n**: {e['n']}" if e["n"] is not None else "")
            + (f" | **場面**: {e['setting']}" if e["setting"] != "不明" else "")
            + (f" | **対象**: {e['population']}" if e["population"] else "")
            + ((" | 📄本文で確認済み"
                + (f"({e['fulltext_source']})" if e["fulltext_source"] else ""))
               if e["fulltext_used"] else ""))
        if e["reason"]:
            lines.append(f"- **判定メモ**: {e['reason']}")
        if e["judge_model"] and main_model and e["judge_model"] != main_model:
            lines.append(f"- **判定モデル**: {e['judge_model']}(代わりのモデル)")
        if e["markers"]:
            lines.append("- **抄録に明記された質指標**: " + " / ".join(e["markers"]))
        lines.append(f"- **DOI**: {e['doi']}")
        lines.append(f"- **掲載誌**: {e['venue']}")
        if e["url"] != "なし":
            lines.append(f"- **URL**: {e['url']}")
        if e["oa_url"]:
            lines.append(f"- **全文(OA)**: {e['oa_url']}")
        lines += ["", "**Abstract**:", e["abstract"] or "(抄録なし)", "", "---", ""]

    with open(paths["catalog"], "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    with open(paths["urls"], "w", encoding="utf-8") as f:
        f.write("\n".join(e["url"] for e in entries if e["url"] != "なし"))
    _write_index(paths["index"], paths["catalog"], meta, entries)
    _write_unjudged(paths["unjudged"], meta, unjudged,
                    os.path.basename(paths["catalog"]))
    meta.setdefault("counts", {})["unjudged"] = len(unjudged)
    _write_searchlog(paths["searchlog"], meta)
    _write_prompt(paths["report_prompt"], os.path.basename(paths["catalog"]),
                  meta, cluster_counts, dups, inconsistent, thin,
                  entries, src_counts, unresolved)

    print(f"\n[System] カタログを出力しました: {paths['catalog']}")
    if fallback:
        print(f"[情報] {fallback}件はCrossrefへ著者情報を補完しました({unresolved}件は取得不可)。")
    if keyring_hits:
        print(f"[情報] {keyring_hits}件は過去のカタログと同じ引用キーを再利用しました。")
    if dups:
        print(f"[警告] 同一研究・同一抄録の疑いを{len(dups)}組検出しました。")
    if inconsistent:
        print(f"[警告] core判定だが関連度{core_score - 1}以下が"
              f"{len(inconsistent)}件あります。")
    if thin:
        print(f"[警告] 抄録が短すぎる項目が{len(thin)}件あります。")
    if unjudged:
        print(f"[情報] 未判定 {len(unjudged)}件は本体から分離し、"
              f"{os.path.basename(paths['unjudged'])} に書き出しました。")

    return {"entries": len(entries), "cluster_counts": cluster_counts,
            "dups": dups, "inconsistent": len(inconsistent), "thin": len(thin),
            "no_author": unresolved, "prompt_path": paths["report_prompt"],
            "unjudged": len(unjudged), "unjudged_path": paths["unjudged"]}


def _write_index(path, catalog_path, meta, entries):
    with open(path, "w", encoding="utf-8") as f:
        json.dump({
            "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
            "catalog_file": os.path.basename(catalog_path),
            "topic": meta["topic"], "theme_definition": meta["definition"],
            # アンサンブル判定と差分が使う。判定モデル・同名異義語・基準を
            # 残しておけば、後から同じ条件で再判定・比較できる。
            "filter_model": meta.get("filter_model", ""),
            "judge_models": meta.get("judge_models") or {},
            "homonyms": meta.get("homonyms") or [],
            # 次回の収集で同じ検索計画を使えるように(config.REUSE_SEARCH_PLAN)
            "search_plan": meta.get("plan") or {},
            "core_score": meta.get("core_score"),
            "cluster_note": meta.get("cluster_note", ""),
            "counts": meta.get("counts", {}),
            "items": {e["ref_key"]: {"title": e["title"], "year": e["year"],
                                     "doi": e["doi"], "score": e["score"],
                                     "measured": e["measured"],
                                     "reason": e["reason"],
                                     "cluster": e["cluster"], "src": e["src"],
                                     "design": e["design"],
                                     "design_code": e["design_code"],
                                     "n": e["n"], "setting": e["setting"],
                                     "retracted": e["retracted"],
                                     "fulltext_used": e["fulltext_used"],
                                     "fulltext_source": e["fulltext_source"],
                                     "pmcid": e["pmcid"],
                                     "url": e["url"], "oa_url": e["oa_url"],
                                     "cited_by": e["cited_by"],
                                     "judge_model": e["judge_model"]}
                      for e in entries},
        }, f, ensure_ascii=False, indent=1)


def _write_unjudged(path, meta, entries, catalog_file):
    """判定を通らなかった抄録を、カタログ本体とは別の資料として書き出す。

    見出しは意図的に `### N. [Key] Title` 形式にしない。find_catalogs() が
    その形をカタログの目印として探すため、同じ形にするとこのファイルまで
    カタログ候補として拾われ、relink の照合先が二重になる。
    """
    lines = ["# 未判定の抄録（カタログ本体から分離）", "",
             f"**テーマ**: {meta['topic']}", "",
             f"**本体のカタログ**: `{catalog_file}`", "",
             f"**件数**: {len(entries)}件", "",
             "自動判定が失敗し、関連度による選別を一度も通っていない抄録です。",
             "主題と無関係な文献が多く含まれます。**レポートの根拠には使えません**",
             "（本体の引用キー索引に載っていないため、引用しても照合できません）。",
             "", "拾い直したいものが見つかった場合は、テーマを絞るか判定の",
             "バッチサイズを下げて再収集してください。", "", "---", ""]
    if not entries:
        lines += ["未判定はありませんでした。", ""]
    for i, e in enumerate(entries):
        off = "  ⚠️対象外分野の可能性" if _looks_off_domain(e["title"], e["abstract"]) else ""
        lines.append(f"### {i+1}) {e['title']}{off}")
        lines.append(f"- 参考キー: {e['ref_key']} | Year: {e['year']} | "
                     f"Source: {e['src']}")
        # entries では判定メモは "reason" に入っている(旧版は存在しない
        # "exclusion_reason" を見ており、常に「記録なし」になっていた)
        lines.append(f"- 判定できなかった理由: {e.get('reason') or '記録なし'}")
        lines.append(f"- DOI: {e['doi']}")
        if e["url"] != "なし":
            lines.append(f"- URL: {e['url']}")
        lines += ["", "**Abstract**:", e["abstract"] or "(抄録なし)", "", "---", ""]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def _write_searchlog(path, meta):
    """検索の記録。何をどう探したかを残す(PRISMA-Sの考え方に沿う)。"""
    c = meta.get("counts", {})
    lines = ["# 検索の記録", "",
             f"実施日: {datetime.date.today().isoformat()}", "",
             f"テーマ: {meta['topic']}", "",
             "## 検索戦略", "", "```", meta.get("plan_text", ""), "```", "",
             "## 検索の経過", ""]
    for row in meta.get("search_log", []):
        lines.append(f"- {row}")
    unj = c.get("unjudged", 0)
    lines += ["", "## 件数", "",
              f"- 収集(重複排除後): {c.get('collected', 0)}件",
              f"- 関連度不足で除外: {c.get('excluded', 0)}件",
              f"- カタログ収録: {max(c.get('final', 0) - unj, 0)}件",
              f"- 未判定として分離: {unj}件", "",
              "## 網羅性の限界", "",
              "- PsycINFO・医中誌Webは機関契約が前提のため検索していない。",
              "- 日本語文献はJ-STAGE・CiNii・NDLサーチの範囲に限られる。",
              "- NDLサーチは書誌情報が中心で、抄録を持つ記録は一部に限られる。"
              "抄録を得られなかった記録は収録していないため、"
              "ヒット数に比べて収録数は少ない。",
              "- 引用連鎖は指定世代までで打ち切っており、網羅的ではない。",
              "- 抄録が取得できなかった文献は収集段階で除外している。",
              "- 撤回の確認はOpenAlexの撤回フラグとタイトル表記に限られる。"
              "撤回通知の反映には遅れがあり、DOIの無い文献は照合できない。"]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


# ==========================================
# レポート生成プロンプト
# ==========================================
# 専門領域と「実践への示唆」の観点は config.PROMPT_* で変えられる。
# 中心クラスタ内部で主根拠と補助を分ける境界は、カタログ側の
# 「core判定だが関連度が基準未満」の警告と同じ位置(CORE_SCORE)に合わせる。
# 基準を下げた回(cluster_note あり)では境界が意味を持たないため、
# その場合はこの区別をプロンプトに書かない。

# check(アンサンブル判定・全文アクセス可否)が出す補助ファイルの読み方。
# 最も避けたい誤読は2つ。①別モデルの再判定を「正解」として一括で採用する
# こと ②全文アクセス可否の一覧を「全文を読んだ」ことと取り違えること。
# どちらも明示的に禁止する形で書いてある。
ATTACHED_FILES_BLOCK = """<attached_files>
抄録カタログのほかに、次の2ファイルが添付されていることがある。どちらも
判定を補助するための資料であり、レポートの出典にはしない。添付が無ければ
この節は読み飛ばしてよい。

■ `{ensemble_file}` — 別モデルによる再判定で分類が食い違ったものの一覧
カタログと同じ抄録を、同じ判定基準(関連度{core_score}以上かつ実際に
測定・評価・適用した研究だけをcoreとする)のまま別のモデルにもう一度
判定させ、分類が一致しなかったものだけを並べたファイル。どちらの判定が
正しいかを決めるものではなく、「自分で抄録を読み直すべきものはどれか」を
示す手がかりとして使う。
- 「別系統の2つのモデルが、どちらも除外相当」の節がある場合、その抄録は
  1本目が残したのに2本目・3本目が共に外したもの。主題と無関係なものが多いが、
  同じ介入を別の対象で行った近縁の研究(例: 自閉症児の活動スケジュール)も
  含まれる。抄録を読み、無関係なら対象外、近縁なら周辺の補助根拠(中心の
  根拠にはしない)として扱い、その判断を書く。
- 除外候補(core→off/除外相当)に挙がった抄録は、中心的な根拠に使う前に
  抄録本文を読み、テーマの定義が示す交差を実際に満たしているか確かめる。
  満たしていなければ補助に落とすか対象外にし、そう判断した理由を書く。
- 昇格候補(related→core)は、抄録を読んで測定を伴う研究だと確認できた
  ものだけを主要な根拠に加える。まとめて昇格させない。
- 冒頭の採否の一致・分類の一致・κ係数は、自動分類の確からしさを示す
  情報として「エビデンスの限界」に書いてよい。「κ は低く出やすい」の
  注記があるときは、1本目の分類が偏っているために κ が0付近になって
  いるだけなので、κ を取り上げず採否の一致を使う。注記が無く κ が0.4
  未満なら、分類はモデルによって大きく揺れる、と読める。
  「判定の厳しさの違い」の注記が
  あるときは、片方のモデルがテーマの定義を一貫して厳しく当てはめた
  結果であり、揺れではない。その場合は、定義を厳密に満たす研究が
  どれだけあるか(テーマの中核を直接扱った研究の乏しさ)として書く。

■ `{fulltext_file}` — 中心クラスタの全文アクセス可否
各文献のオープンアクセス全文に到達できるか(A=APIで取得可 / B=閲覧可 /
C=不可)を調べた一覧であり、全文そのものは含まれていない。
- AやBが付いていても、その本文を読んだことにはならない。主張の根拠は
  引き続き、カタログの抄録に書かれていることだけに限る。
- 使いどころは「エビデンスの限界」である。中心的な根拠のうち何件が全文で
  検証可能(A・B)で、何件が抄録止まり(C)かを書くと、読み手が自分で
  確かめられる範囲が分かる。
- 効果量・統計手法・脱落者数など抄録からは判断できない点に触れるときは、
  「抄録からは確認できない(全文はAとして取得可能)」のように、確認できない
  ことと次に何を見ればよいかを併せて書いてよい。
</attached_files>

"""

PROMPT_TEMPLATE = """# レポート生成プロンプト（{catalog_file}）

## 使い方

ClaudeでもGeminiでも同じ手順で使える。

1. 新しい会話を開き、抄録カタログ `{catalog_file}` を先に添付または貼り付ける。
2. 同じフォルダに次の2つがあれば、続けて添付する（無ければ飛ばしてよい）。
   - `{ensemble_file}` — 別モデルによる再判定で分類が食い違ったものの一覧
   - `{fulltext_file}` — 中心クラスタの全文アクセス可否（A/B/C）
3. その**後**に、下の `---` 以降をすべて貼り付ける。

長い資料を先に、指示を後に置く。両モデルとも、指示を末尾に置いたほうが
長文の読み落としが減る。順序を逆にしないこと。

---

<role>
あなたは{domain}を専門とし、{sub_domain}領域にも精通する研究者です。
上に添付された抄録カタログを読み、レビューレポートを書いてください。

読み手は、このテーマについて自分で判断を下したい実務家・研究者です。
その人が「結局この分野では何が分かっていて、何が分かっていないのか」を
掴めるように書いてください。カタログの内容を要約することが目的ではなく、
散らばった知見から論点を立て、それを筋道立てて示すことが目的です。
</role>

<catalog_info>
テーマ: {topic}
テーマの定義: {definition}
クラスタ内訳: {cluster_summary}
関連度スコアの分布: {score_summary}
取得元内訳: {source_summary}
採用率: {yield_summary}
{extra_info}</catalog_info>

<how_to_read_the_catalog>
1. カタログ冒頭の「引用キー索引」に載っている引用キーだけを使う。
   索引に無いキーを作ってはならない。
2. 抄録はクラスタ順(core → related)に並んでいる。
   関連度スコアとクラスタは機械的な事前判定であり、出発点として参照して
   よいが、抄録の内容と矛盾する場合は自分の判断を優先し、その旨を書く。
{core_tier_note}3. 索引表の「確認」欄に⚠️がある抄録は、判定とスコアが矛盾している。
   方法・結果を読んで自分で分類し直すこと。
4. core・related に分類されていても、テーマの定義に挙げた別概念・
   同名異義語に該当するもの、主題と無関係なもの、抄録が短く内容を
   判断できないものは対象外とする。対象外にしたものは探索的参照にも
   使わない。件数と混入の傾向(略語の衝突、引用連鎖による巻き込み等)
   だけを「エビデンスの限界」に書く。
5. 引用キー末尾が0000は発行年不明を意味する。この抄録は内容についての
   主張の根拠には使えるが、年代順の議論、概念の成立経緯、先行・後続
   関係といった時系列的な主張の根拠には使わない。
6. 索引表の「設計」「n」「場面」、および各抄録の「設計」行は、抄録から
   自動抽出したもので誤りや「不明」を含む。根拠を選ぶときは抄録本文で
   確かめること。知見の重みは設計によって変わる。単一事例実験(SCED)の
   結果を群間比較(RCT/QE)と同列に扱わない。参加者数の少ない研究の
   結果を集団全体へ一般化しない。設計の略号は
{design_codes}。
7. 「抄録に明記された質指標」は、その研究が実施したことの記録ではなく、
   抄録に書いてあったかどうかの記録である。記載が無いことを
   「実施していない」と解釈して研究を批判してはならない。書けるのは
   「抄録からは確認できない」までである。
8. 索引表の「確認」欄の🛑は撤回・取り下げの疑い、⚠️は分類とスコアの
   矛盾を示す。🛑が付いた抄録と、カタログ冒頭の「撤回・取り下げの疑い」
   に挙がった抄録は、分析の根拠に使ってはならない。そのテーマに撤回
   された研究があるという事実自体は、エビデンスの限界の節に書いてよい。
   撤回の確認は網羅的ではないため、「撤回は無い」とは書かない。
{extra_notes}</how_to_read_the_catalog>

{attached_files}<what_makes_a_good_report>
良いレビューと、そうでないレビューの違いは次の点にあります。

- 論点が立っているか
  「この分野には何が蓄積され、何が争点で、何が空白か」という問いに
  答えているものが良いレビューです。抄録を順に紹介していく形式(注釈付き
  文献リスト)は、それがどれほど正確でも、レビューとしては失敗です。

- 一件一件ではなく、論点ごとにまとまっているか
  1つの論点について、支持する研究と対立する研究をまとめて論じてください。
  「A論文はこう述べている。B論文はこう述べている」と並べるのではなく、
  「この点については見解が分かれる。Aは〜と主張する一方、Bは〜」という形に
  なっているかを確認してください。

- 分からないことが正直に書かれているか
  抄録に書かれていないことは、一般によく知られた事実でも書かないでください。
  数値は抄録に明記されたものだけを使います。テーマの中核を直接扱った研究が
  乏しい場合、それ自体が最も重要な発見です。無理に厚みを演出せず、
  「この論点を直接検証した研究は見当たらない」と明記してください。
  その上で、なぜ空白なのか、周辺の研究から何が言えるのかを論じれば、
  短くとも価値のあるレビューになります。

- 出典の付け方が適切か
  出典が必要なのは、抄録の内容についての主張です。複数の抄録の関係を
  述べる記述(これらは一致する、こちらは対立する、この論点を扱った研究が
  ない等)は分析者の判断であり、根拠となる抄録を挙げれば足ります。
  論点をつなぐ文、段落の導入文、節のまとめに出典は要りません。
  これらを避けると、文章が事実の羅列になります。
</what_makes_a_good_report>

<before_writing>
本文を書き始める前に、次を済ませてください(いずれも作業メモであり、
最終レポートには含めません)。

1. テーマの中核を直接扱った抄録を選び出す。実際に対象を測定・評価・
   適用したものだけを中心的な根拠とし、言及するだけ・先行研究として
   引用するだけのものは周辺に回す。同名異義語に該当するもの、主題と
   無関係なものは対象外に置き、以降参照しない。

2. 選び出した抄録から、論点を3〜6個立てる。テーマを機械的に分割する
   のではなく、「この分野で実際に議論されていること」を反映した論点に
   すること。論点の数は、扱える中心的な文献の厚みに応じて決める。

3. 著者や具体的数値(対象人数・割合等)が一致するのに引用キーが異なる組を
   探す。カタログ冒頭に異版疑いの自動検出がある場合はそれも確認する。
   見つかった組は次の三つに分けて扱う。
   (a) 内容が実質同一で著者も重なる → 同一研究の異版。年が新しい方、
       または情報が充実した方だけを引用し、件数も1件として数える。
   (b) 内容が実質同一だが著者が完全に別 → 取り違えかデータ破損の
       可能性が高い。両方とも根拠に使わず、該当する引用キーと
       その旨を「エビデンスの限界」に書く。
   (c) 主題が近いだけで内容は異なる → 別研究。両方とも通常どおり
       使ってよく、レポートに書く必要もない。

4. 中心的な根拠として選んだ抄録が、どの設計で得られた知見かを数える。
   系統的レビュー・群間比較・単一事例・事例報告・総説の内訳を把握して
   から書き始める。この内訳が、各論点をどれだけ強く書けるかを決める。
   設計の偏りは、後の「エビデンスの限界」でそのまま使う。
</before_writing>

<structure>
1. 概観 — 地の文。3〜5文。このカタログ全体から何が言えるかを、読み手が
   最初に知るべき結論として書く。件数の列挙で始めない。
2〜(n). 論点ごとの分析 — 上で立てた論点をそれぞれ節にする。見出しは
   「分類」「クラスタ」等の管理用語ではなく、論点の中身を表す言葉にする。
   各節は地の文で書き、冒頭にその論点についての結論を置いてから根拠を示す。
(n+1). 一致点と対立点 — 何と何がどう食い違うのか、対立の構造が読み取れる
   ように書く。項目を並べるだけにしない。
(n+2). 実践への示唆 — {perspective_a}と{perspective_b}の両方の観点から。
   箇条書きでよいが、各項目は提言だけで終えず根拠となる知見と結びつける。
(n+3). エビデンスの限界 — 冒頭に中心・周辺・対象外の件数を1〜2文で示す
   (周辺と対象外の引用キーは1件も挙げない。件数と話題の傾向のみ)。
   続けて根拠の設計の偏りを、具体的な件数とともに書く(単一事例に集中して
   いる、群間比較が無い、参加者数の合計が小さい、場面が学校に偏り生活
   施設の知見が乏しい等)。さらに、抄録のみに基づくこと、検索の網羅性、
   扱われていない論点の空白を書く。
   最後に、出典基盤そのものの偏りを2〜4文で評価する。上の
   <catalog_info> に示した取得元内訳・採用率・スコア分布を使い、
   該当する観点だけを書く。教育系データベース(ERIC)が多数を占めるなら
   グレイリテラチャへの依存、PubMed・Europe PMCが少ないなら査読済み
   医学文献の基盤の薄さ、CiNii・J-STAGEの比率が高いなら日本語文献への
   依存、前方引用・後方引用由来が多いなら特定の起点文献からの引用連鎖
   への偏り、採用率が著しく低いなら検索語とテーマの対応の粗さ、
   スコアの上限が100に達していないならテーマに完全に合致する文献が
   カタログ内に存在しないこと、として述べる。ここでは個別の抄録を
   引用しない。
(n+4). 今後の展望 — 地の文。

節の数は論点の数に応じて変わる。##見出しには文書を通して連番を振る。
</structure>

<format>
- 出力の先頭に必ず次のYAMLフロントマターを置く。modelには自分自身の
  モデル名を把握できる範囲で書く(虚偽のバージョン番号を作らないこと)。

---
catalog_source: "{catalog_file}"
source_method: catalog
model: "(自分のモデル名)"
evidence_scope: "添付された抄録カタログに収録された文献のみを対象とする。coreは主根拠、relatedは補助、別概念・無関係・抄録不足のものは対象外とする。"
---

- 全ての節見出しはMarkdown記法(##/###)で書く。見出しの文字列だけを
  地の文に裸で置かない。##見出しには連番を振る。
- 「エビデンスの限界」の節は、見出し直後に `> [!warning] エビデンスの限界`
  を置き、本文の各行の先頭に `> ` を付ける(空行にも `>` のみ)。
- 「実践への示唆」の節も同様に `> [!tip] 実践への示唆` を置き、
  本文の各行に `> ` を付ける。
- 引用は[Key2026]、複数は[Key2026; Other2025]。文ごとではなく段落または
  箇条書き1項目の末尾にまとめて付す。同じ抄録を連続して引くときに
  キーを毎文繰り返さない。
- 「〇〇は…と報告している」のような同一の文型を文献ごとに機械的に
  繰り返さない。比較・対比・因果・限定など、論点間の関係に応じて文を
  つなぐ。ただし主張と根拠の対応を曖昧にしてはならない。
- 段落の長さは論点の重要度に応じて変える。均一に揃えない。
- 全項目の先頭に「**太字ラベル**:」を置く形式は使わない。事実一覧のように
  見え、論の流れが伝わらなくなる。
- 専門用語は初出時にカタカナ表記と英語正式名称を併記し、以降は略号を使う。
- Obsidianのウィキリンク([[...]])を作らない。このカタログには概念ノート
  にも個別文献ノートにもパスが含まれておらず、リンク先が実在するか
  確認する手段が無い。存在しないノートへのリンクは、Vaultに未解決の
  リンクを積み上げるだけで何の役にも立たない。引用は [Key2026] 形式の
  角括弧1つだけを使い、[[Key2026]] と二重にしない。テーマ名・専門用語・
  著者名・尺度名のいずれについてもリンクを作らない。
- 「参照文献一覧」「参照した主な抄録」「引用キー索引」にあたる節を
  自分で作らない。本文の後ろには別の工程で索引表が追加されるため、
  自分で書くと二重になる。本文は「今後の展望」で終える。

書き終えたら、本文中の引用キーを1つずつ索引表と機械的に突き合わせる。
1文字でも違うキー、桁数や綴りが違うキーは実在しない引用として、その記述
ごと削除するか正しいキーに直す。似ているからといって存在すると仮定しない。
</format>

<output_and_delivery>
- レポート本体は、ドキュメント機能(Docs)ではなくMarkdownファイルとして
  出力・添付する。Docs形式では提出しない。
- ファイル名は `[report] {topic}.md` とする。
- チャット本文には、レポート本体とは別に、次の作業過程を必ず記載する。
  「指示どおり作成しました」のような短い要約で済ませない。
  1. 引用キーの照合結果。本文で使用した件数と、索引表との不一致の有無。
  2. 分類を見直した箇所。core→related、related→core、対象外へ移した
     抄録を、引用キーと理由とともに一件ずつ列挙する。
  3. 独立した根拠として数えなかった組。同一研究の異版、同一データの
     別解析などを、そう判断した理由とともに挙げる。
  4. 撤回論文・取り違えの疑い・抄録不足など、本文に反映しきれなかった留意点。
</output_and_delivery>
"""


def _score_summary(entries) -> str:
    """関連度スコアの帯別件数。プロンプト側の階層運用の根拠になる。"""
    s = [e["score"] for e in entries if e["score"] is not None]
    if not s:
        return "算出不可(全件が未判定)"
    bands = [("90〜100", 90, 101), ("80〜89", 80, 90), ("70〜79", 70, 80),
             ("69以下", 0, 70)]
    parts = [f"{label} {n}件" for label, lo, hi in bands
             if (n := sum(1 for v in s if lo <= v < hi))]
    tail = (f" / 未判定 {len(entries) - len(s)}件"
            if len(s) != len(entries) else "")
    return f"最小{min(s)} 最大{max(s)}（" + " / ".join(parts) + "）" + tail


def _yield_summary(counts, n_entries) -> str:
    collected = counts.get("collected") or 0
    if not collected:
        return "算出不可"
    rate = n_entries / collected
    return (f"収集直後 {collected}件 → 収録 {n_entries}件 "
            f"({rate:.1%} / 関連度不足で除外 {counts.get('excluded', 0)}件)")


def _design_codes() -> str:
    """プロンプトに載せる設計の略号の説明(3件ずつ改行)。"""
    parts = [f"{c}={DESIGN_LABELS[c]}" for c in DESIGN_ORDER if c != "NA"]
    rows = [" / ".join(parts[i:i + 3]) for i in range(0, len(parts), 3)]
    return " /\n".join("   " + r for r in rows)


def _write_prompt(path, catalog_file, meta, cluster_counts, dups,
                  inconsistent, thin, entries=None, src_counts=None,
                  no_author=0):
    entries = entries or []
    src_counts = src_counts or {}
    core_score = int(meta.get("core_score") or config.CORE_SCORE)
    # check()が同じフォルダへ出す補助ファイルの名前。カタログのファイル名から
    # テーマ名を復元して組み立てる。このプロンプトはカタログ出力と同時に
    # 作られ、その時点ではcheckがまだ走っていない(ファイルが存在しない)ため、
    # 実在確認はせず「あれば添付する」という書き方にしてある。
    pre_c, ext_c = FILE_KINDS["catalog"]
    core_name = catalog_file
    if core_name.startswith(pre_c) and core_name.endswith(ext_c):
        core_name = core_name[len(pre_c):-len(ext_c)]
    ensemble_file = f"_ensemble__{core_name}.md"
    fulltext_file = f"_fulltext__{core_name}.md"
    attached_files = ATTACHED_FILES_BLOCK.format(
        ensemble_file=ensemble_file, fulltext_file=fulltext_file,
        core_score=core_score)
    summary = " / ".join(f"{c} {cluster_counts.get(c, 0)}件"
                         for c in CLUSTER_ORDER if cluster_counts.get(c)) or "なし"
    source_summary = (" / ".join(f"{k} {v}件" for k, v in src_counts.items())
                      or "不明")

    # 基準を下げた回は core が基準未満になるのが前提なので、基準を境界に
    # した階層はかえって誤解を招く。その場合は書かない。
    core_tier_note = ""
    if not meta.get("cluster_note"):
        core_tier_note = (
            "   なお core のうち関連度{s}以上を主要な根拠とし、{t}以下の core は\n"
            "   補助的な根拠として扱う。{t}以下の core だけが支持する内容は、\n"
            "   「限定的な示唆」等と射程を明示するか、書かない。\n"
        ).format(s=core_score, t=core_score - 1)

    extra = []
    if len(meta.get("judge_models") or {}) > 1:
        extra.append(f"判定モデル: {models_label(meta['judge_models'])}"
                     "(途中で代わりのモデルへ切り替え。カタログ冒頭の注記を参照)")
    unknown_year = sum(1 for e in entries if str(e["ref_key"]).endswith("0000"))
    if unknown_year:
        extra.append(f"発行年不明(引用キー末尾0000): {unknown_year}件")
    if no_author:
        extra.append(f"著者情報を取得できなかった抄録: {no_author}件"
                     "(引用キーが一意でない可能性があるため、"
                     "根拠に使う際はタイトルの一部を併記する)")
    extra_info = ("".join(f"{x}\n" for x in extra)) if extra else ""

    # 注記は番号を動的に振る。以前は dup_note を「9.」で固定していたため、
    # dups が空で inconsistent だけある回に 8→10 と番号が飛んでいた。
    notes, n = [], 8
    if dups:
        n += 1
        notes.append(
            f"{n}. カタログ冒頭に「同一研究・同一抄録の疑い」の自動検出結果がある。\n"
            "   機械的な候補に過ぎない。<before_writing>の3に従って三分岐で\n"
            "   判定し、異版と取り違えに該当した組だけをレポートに書く。\n")
    if inconsistent:
        n += 1
        notes.append(
            f"{n}. 「確認」欄に⚠️が付いた抄録が{len(inconsistent)}件ある。\n"
            "   分類を自分で判断し直すこと。\n")
    if thin:
        n += 1
        notes.append(
            f"{n}. 抄録が短すぎる項目(カタログ冒頭の⚠️)が{len(thin)}件ある。内容を判断できない\n"
            "   ため対象外として扱い、根拠に使わない。\n")

    with open(path, "w", encoding="utf-8") as f:
        f.write(PROMPT_TEMPLATE.format(
            catalog_file=catalog_file, topic=meta["topic"],
            definition=meta["definition"], cluster_summary=summary,
            score_summary=_score_summary(entries),
            source_summary=source_summary,
            yield_summary=_yield_summary(meta.get("counts", {}), len(entries)),
            extra_info=extra_info, core_tier_note=core_tier_note,
            extra_notes="".join(notes),
            ensemble_file=ensemble_file, fulltext_file=fulltext_file,
            attached_files=attached_files, design_codes=_design_codes(),
            domain=config.PROMPT_DOMAIN, sub_domain=config.PROMPT_SUB_DOMAIN,
            perspective_a=config.PROMPT_PERSPECTIVE_A,
            perspective_b=config.PROMPT_PERSPECTIVE_B))


# ==========================================
# レポートの再リンク
# ==========================================
# KEY_REは年を4桁固定にしているため、桁がずれたキー(実測:
# 5桁の[Seim20163]、正しくは[Seim2020; Seim2016]の書き間違いと見られる)は
# 正規のキーとして認識されず、抽出そのものから静かに漏れる。その結果
# key_match_rateが100%と出ても、実は本文中に実在しない引用が紛れている
# ことに気づけない。「英字+数字5桁以上」を拾う緩い正規表現で、形式は
# 引用キーらしいが桁がずれているものを別枠で検出する。
SUSPECT_KEY_RE = re.compile(r"^[A-Za-z][A-Za-z'\-]*\d{5,}[a-z]?$")


def extract_keys(text: str) -> tuple:
    """本文から引用キーを抽出する。(正規のキー一覧, 形式が怪しいキー一覧)を返す。"""
    found, suspects, seen = [], [], set()
    for inner in BRACKET_RE.findall(text):
        for part in re.split(r"[;；,、]", inner):
            k = part.strip()
            if not k or k in seen:
                continue
            if KEY_RE.match(k):
                seen.add(k)
                found.append(k)
            elif SUSPECT_KEY_RE.match(k):
                seen.add(k)
                suspects.append(k)
    return found, suspects


def parse_catalog(path: str) -> dict:
    sidecar = index_path_for(path)
    if os.path.exists(sidecar):
        try:
            with open(sidecar, encoding="utf-8") as f:
                d = json.load(f)
            return {"theme": d.get("theme_definition", ""), "items": d.get("items", {})}
        except Exception:
            pass
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.read().splitlines()
    except Exception:
        return {"theme": "", "items": {}}
    theme, items, cur = "", {}, None
    for line in lines:
        if not theme and line.startswith("**テーマの定義**"):
            theme = line.replace("**テーマの定義**", "").strip(": 　").strip()
        m = CATALOG_ENTRY_RE.match(line)
        if m:
            cur = m.group(1).strip()
            items[cur] = {"title": m.group(2).strip(), "year": "", "doi": "",
                          "score": "", "cluster": ""}
            continue
        if cur is None:
            continue
        if line.startswith("- **Year**"):
            for pat, key in ((r"\*\*Year\*\*:\s*([^|]+)", "year"),
                             (r"\*\*関連度\*\*:\s*([0-9]+)", "score"),
                             (r"\*\*クラスタ\*\*:\s*(\S+)", "cluster")):
                mm = re.search(pat, line)
                if mm:
                    items[cur][key] = mm.group(1).strip()
        elif line.startswith("- **DOI**"):
            items[cur]["doi"] = line.split(":", 1)[-1].strip()
    return {"theme": theme, "items": items}


def find_catalogs(d: str) -> list:
    out = []
    skip_prefix = FILE_KINDS["unjudged"][0]
    for root, _dirs, files in os.walk(d):
        for name in files:
            if not name.endswith(".md") or name.startswith(skip_prefix):
                continue
            p = os.path.join(root, name)
            try:
                with open(p, encoding="utf-8") as f:
                    head = f.read(4000)
            except Exception:
                continue
            if "# 抄録カタログ" in head or CATALOG_ENTRY_RE.search(head or ""):
                out.append(p)
    return sorted(out)


def load_catalogs(d: str) -> dict:
    if not os.path.isdir(d):
        print(f"[警告] カタログディレクトリが見つかりません: {d}")
        return {}
    cats = {}
    for p in find_catalogs(d):
        c = parse_catalog(p)
        if c["items"]:
            cats[p] = c
    print(f"[情報] カタログ候補: {len(cats)}件")
    return cats


def _split_fm(text: str):
    """フロントマターを辞書と本文に分ける。

    実測: tagsを複数行のYAMLブロックリスト形式(以下)で書いていると、
      tags:
        - 強度行動障害
        - NCR
    「行頭が空白でない行だけを読む」という単純な実装では、インデント
    された "- 項目" の行が全て無視され、tagsが空文字列になって
    relink時に消えたように見えていた。ブロックリストを検出し、
    フロー形式("[a, b, c]")の文字列に変換して保持する
    (_fm_value()はこの形式ならそのまま書き戻せる)。
    """
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---\n", 4)
    if end == -1:
        return {}, text
    fm = {}
    lines = text[4:end].splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if ":" in line and not line.startswith(" "):
            k, v = line.split(":", 1)
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if not v:
                items = []
                j = i + 1
                while j < len(lines) and re.match(r"^\s+-\s*", lines[j]):
                    item = re.sub(r"^\s+-\s*", "", lines[j]).strip().strip('"').strip("'")
                    if item:
                        items.append(item)
                    j += 1
                if items:
                    v = "[" + ", ".join(items) + "]"
                    i = j - 1
            fm[k] = v
        i += 1
    return fm, text[end + 5:].lstrip("\n")


def _yq(s):
    return '"' + str(s).replace("\\", "\\\\").replace('"', '\\"') + '"'


RELINK_OWNED_KEYS = ("relinked_at", "report", "catalog_source",
                     "catalog_path", "catalog_items", "key_match_rate",
                     "cited_keys", "resolved_keys", "unresolved_keys",
                     "theme_definition")


def _fm_value(v) -> str:
    """フロントマターの値をYAMLとして妥当な形に整形する。

    Noneはnull、真偽値・数値(文字列化されたものも含む)はそのまま、
    "[...]"形式(tags等のリスト)はそのまま、それ以外は_yq()で引用符付きの
    文字列にする。_split_fmは既存の値を常に文字列で返すため、
    "5"のような数値文字列もここで見分ける。
    """
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v)
    if s in ("true", "false", "null") or re.fullmatch(r"-?\d+(\.\d+)?", s):
        return s
    if s.startswith("[") and s.endswith("]"):
        return s
    return _yq(s)


def relink_report(report_path, catalogs, min_rate=None, apply=False) -> dict:
    min_rate = config.RELINK_MIN_RATE if min_rate is None else min_rate
    with open(report_path, encoding="utf-8") as f:
        raw = f.read()
    fm, body = _split_fm(raw)
    marker = "\n<!-- relink:begin -->"
    idx = body.find(marker)
    body = body[:idx].rstrip() + "\n" if idx != -1 else body
    keys, suspect_keys = extract_keys(body)
    name = os.path.basename(report_path)

    if (fm.get("source_method") or "").strip() == "research":
        return {"name": name, "status": "対象外(research)", "keys": len(keys),
                "catalog": "-", "rate": 0.0, "unresolved": [],
                "suspect_keys": suspect_keys}

    declared = (fm.get("catalog_source") or "").strip()
    best, rate, matched, declared_hit = None, 0.0, [], False
    if declared and declared != "null":
        for p in catalogs:
            if os.path.basename(p) == declared:
                best, declared_hit = p, True
                matched = [k for k in keys if k in catalogs[p]["items"]]
                rate = len(matched) / len(keys) if keys else 0.0
                break
        if best is None:
            print(f"[警告] {name}: 宣言された生成元 '{declared}' が見つかりません。推定に切り替えます。")
    if best is None and keys:
        for p, c in catalogs.items():
            m = [k for k in keys if k in c["items"]]
            r = len(m) / len(keys)
            if r > rate:
                best, rate, matched = p, r, m

    # min_rate は「どのカタログから作られたか分からないレポートを、キーの
    # 一致率だけで推定する」ための足切り。生成元がフロントマターで宣言され、
    # そのファイルが実在するなら推定の必要はないので、足切りにかけない。
    # 以前はここで一律に切っていたため、モデルが引用キーを書き損じて一致率が
    # 落ちただけのレポートが「未特定」になり、索引表ごと失われていた。
    # 一致率が低いこと自体は下の警告で伝える。
    if best is None or (rate < min_rate and not declared_hit):
        cat, unresolved, status = {"theme": "", "items": {}}, keys, "未特定"
        matched, best_disp = [], ""
    else:
        cat = catalogs[best]
        unresolved = [k for k in keys if k not in cat["items"]]
        status = "特定(宣言)" if declared_hit else "特定(推定)"
        best_disp = best

    # relink実行のたびに、relinkが管理するプロパティ(RELINK_OWNED_KEYS)だけを
    # 更新し、それ以外の既存プロパティ(tags、generate_report.pyが付けたmodel等)
    # はそのまま残す。以前は毎回フロントマター全体を作り直しており、
    # relinkが関知しないプロパティが実行のたびに消えていた。
    # tagsへの自動付与(Claude/抄録集/特定・未特定/要確認)は行わない。
    for k in RELINK_OWNED_KEYS:
        fm.pop(k, None)

    fm["relinked_at"] = datetime.date.today().isoformat()
    fm["report"] = name
    if best_disp:
        fm["catalog_source"] = os.path.basename(best_disp)
        fm["catalog_path"] = best_disp
        if len(cat["items"]):
            fm["catalog_items"] = len(cat["items"])
        if rate:
            fm["key_match_rate"] = round(rate, 3)
    else:
        fm["catalog_source"] = None
        fm["catalog_path"] = None
    if len(keys):
        fm["cited_keys"] = len(keys)
    if len(matched):
        fm["resolved_keys"] = len(matched)
    if len(unresolved):
        fm["unresolved_keys"] = len(unresolved)
    if cat.get("theme"):
        fm["theme_definition"] = cat["theme"]

    head = ["---"] + [f"{k}: {_fm_value(v)}" for k, v in fm.items()] + ["---"]

    tail = ["", "<!-- relink:begin -->", "", "## 引用キー索引", ""]
    if suspect_keys:
        # 正規のキーとしては認識されないが引用キーらしい形をしたもの
        # (桁数のズレ等)。key_match_rateの集計には含まれないため、ここで
        # 別枠で警告しないと気づけない。
        tail += ["> [!warning] 形式が疑わしい引用キー", "> ",
                 "> 索引表と正規表現で一致しないが、引用キーらしい形をして"
                 "います。桁数の書き間違い等で実在しないキーになっている"
                 "可能性が高く、照合率の集計には含まれていません。", "> "]
        tail += [f"> - {k}" for k in suspect_keys]
        tail += [""]
    if not best_disp:
        tail += ["**生成元の抄録カタログを特定できませんでした。**", "",
                 "本レポートは二次資料であり、原抄録が同梱されていない。",
                 "- 記載された数値を原抄録と突き合わせて検証できない",
                 "- 引用キーが実在する抄録に対応しているか確認できない", "",
                 f"- 本文中の引用キー: {len(keys)}件(重複除去後)", "",
                 "<!-- relink:end -->", ""]
    else:
        uncited = [k for k in cat["items"] if k not in set(keys)]
        if declared_hit and keys and rate < min_rate:
            tail += ["> [!warning] 引用キーの照合率が低いままです", "> ",
                     f"> 生成元はフロントマターの宣言どおり "
                     f"`{os.path.basename(best_disp)}` として扱いましたが、"
                     f"本文中の引用キー{len(keys)}件のうち索引表と一致したのは"
                     f"{len(matched)}件({rate:.1%})だけです。生成時にキーを"
                     "書き損じている可能性が高いので、下の「カタログに"
                     "見当たらない引用キー」を1件ずつ確認してください。", "> ", ""]
        tail += [f"生成元カタログ: `{os.path.basename(best_disp)}` "
                 f"(収録 {len(cat['items'])}件 / 本文引用 {len(matched)}件 / "
                 f"未引用 {len(uncited)}件 / 照合率 {rate:.1%})", "",
                 "| 引用キー | 年 | 関連度 | クラスタ | DOI | タイトル |",
                 "|---|---|---|---|---|---|"]
        for k in matched:
            it = cat["items"][k]
            t = cell(it.get("title"), 70)
            tail.append(f"| {k} | {it.get('year') or '-'} | {it.get('score') or '-'} | "
                        f"{it.get('cluster') or '未判定'} | {it.get('doi') or '-'} | {t} |")
        if unresolved:
            tail += ["", "### ⚠️ カタログに見当たらない引用キー", "",
                     "生成時の誤りの可能性がある。該当箇所の記述を確認すること。", ""]
            tail += [f"- {k}" for k in unresolved]
        tail += ["", "<!-- relink:end -->", ""]

    out = "\n".join(head) + "\n\n" + body.rstrip() + "\n" + "\n".join(tail)
    if apply:
        with open(report_path, "w", encoding="utf-8") as f:
            f.write(out)

    return {"name": name, "status": status, "keys": len(keys),
            "catalog": os.path.basename(best_disp) if best_disp else "-",
            "rate": rate, "unresolved": unresolved, "suspect_keys": suspect_keys}


# ==========================================
# 前回のカタログとの差分(旧 catalog_diff.py)
# ==========================================
# [index] <テーマ>.json を世代間で比較し、新規・消滅・分類変更・スコア変動を
# _diff__<テーマ>.md に書き出す。初回は記録(スナップショット)を残すだけで、
# 効果は2回目の生成から。
def _slug(name: str) -> str:
    """テーマ名をファイル名に使える形にする。日本語はそのまま残す。"""
    s = re.sub(r"[/\\:*?\"<>|]", "_", name)
    return s.strip() or "unnamed"


def snapshot_path(theme_name: str, index: dict = None) -> str:
    """このテーマの前回分の記録の場所。

    収集をやり直すと build_paths は「テーマ_1」「テーマ_2」と新しいフォルダを
    作る。フォルダ名ごとに記録すると再生成のたびに「前回の記録なし」となり、
    差分が一度も出ない。フォルダ名ではなくテーマ文(索引の topic)を鍵にする。
    """
    topic = ((index or {}).get("topic") or "").strip()
    key = _sanitize_core(topic.splitlines()[0]) if topic else theme_name
    return os.path.join(config.SNAP_DIR, _slug(key) + ".json")


def _legacy_snapshot_path(theme_name: str) -> str:
    """旧方式(フォルダ名ごと)の記録の場所。以前に残した記録を読むために使う。"""
    return os.path.join(config.SNAP_DIR, _slug(theme_name) + ".json")


def has_snapshot(theme_name: str, index: dict = None) -> bool:
    return (os.path.exists(snapshot_path(theme_name, index))
            or os.path.exists(_legacy_snapshot_path(theme_name)))


def _cluster_of(rec) -> str:
    return (rec.get("cluster") or "未判定").strip()


def _doi_map(items) -> dict:
    """DOIから引用キーを引く表。キーが変わった論文の追跡に使う。"""
    m = {}
    for key, rec in items.items():
        doi = (rec.get("doi") or "").strip().lower()
        if doi and doi not in ("なし", "none", "-"):
            m[doi] = key
    return m


def compare_indexes(old: dict, new: dict) -> dict:
    """2つの索引を比べる。"""
    o_items, n_items = old["items"], new["items"]
    o_doi, n_doi = _doi_map(o_items), _doi_map(n_items)
    o_keys, n_keys = set(o_items), set(n_items)

    # DOI一致でキーが変わったものを対応づける
    renamed = {}
    for doi, ok in o_doi.items():
        nk = n_doi.get(doi)
        if nk and nk != ok and ok not in n_keys:
            renamed[ok] = nk
    # DOIの無い文献はタイトルで対応づける。これが無いと、キーが変わった
    # だけの同じ論文が「新規」と「消滅」に1件ずつ数えられていた。
    n_title = {}
    for k, rec in n_items.items():
        tk = title_key(rec.get("title"))
        if tk and k not in o_keys:
            n_title.setdefault(tk, k)
    taken = set(renamed.values())
    for ok in sorted(o_keys - n_keys):
        if ok in renamed:
            continue
        nk = n_title.get(title_key(o_items[ok].get("title")))
        if nk and nk not in taken:
            renamed[ok] = nk
            taken.add(nk)

    renamed_new = set(renamed.values())
    added = [(k, n_items[k]) for k in sorted(n_keys - o_keys) if k not in renamed_new]
    removed = [(k, o_items[k]) for k in sorted(o_keys - n_keys) if k not in renamed]

    # 共通分(キー変更を含む)の変化
    cluster_changed, score_changed = [], []
    pairs = [(k, k) for k in sorted(o_keys & n_keys)] + sorted(renamed.items())
    for ok, nk in pairs:
        orec, nrec = o_items[ok], n_items[nk]
        os_, ns_ = orec.get("score"), nrec.get("score")
        if _cluster_of(orec) != _cluster_of(nrec):
            cluster_changed.append((ok, nk, orec, nrec))
        elif (isinstance(os_, int) and isinstance(ns_, int)
              and abs(os_ - ns_) >= config.DIFF_SCORE_GAP):
            score_changed.append((ok, nk, orec, nrec))

    return {"added": added, "removed": removed,
            "cluster_changed": cluster_changed,
            "score_changed": score_changed, "renamed": renamed}


def _count_clusters(items) -> dict:
    c = {}
    for rec in items.values():
        k = _cluster_of(rec)
        c[k] = c.get(k, 0) + 1
    return c


def _fmt_counts(c) -> str:
    return " / ".join(f"{k}: {v}件" for k, v in sorted(c.items()))


def _write_diff_report(path, theme, old, new, diff):
    o_items, n_items = old["items"], new["items"]
    gap = config.DIFF_SCORE_GAP
    lines = ["---", f"topic: {theme}",
             f"previous_generated_at: {old.get('generated_at', '不明')}",
             f"current_generated_at: {new.get('generated_at', '不明')}",
             "---", "",
             f"# カタログ差分 — {theme}", "",
             f"- 前回: {len(o_items)}件({_fmt_counts(_count_clusters(o_items))})",
             f"- 今回: {len(n_items)}件({_fmt_counts(_count_clusters(n_items))})",
             f"- 新規: {len(diff['added'])}件 / 消滅: {len(diff['removed'])}件 / "
             f"分類変更: {len(diff['cluster_changed'])}件 / "
             f"スコア変動: {len(diff['score_changed'])}件", ""]
    om, nm = old.get("filter_model") or "", new.get("filter_model") or ""
    if om and nm and om != nm:
        lines += [f"> [!warning] 判定モデルが変わっています({om} → {nm})。"
                  "分類変更・スコア変動の多くはモデルの違いによるもので、"
                  "文献の中身が変わったわけではない可能性があります。", ""]
    lines += ["> [!tip] 新規と分類変更だけを読めば、"
              "前回のレポートを見直すべきかが判断できます。", ""]

    lines += [f"## 1. 新規に加わった抄録({len(diff['added'])}件)", ""]
    if not diff["added"]:
        lines += ["なし。", ""]
    else:
        lines += ["| 引用キー | 分類 | スコア | 年 | タイトル |", "|---|---|---|---|---|"]
        for k, r in sorted(diff["added"],
                           key=lambda x: (_cluster_of(x[1]) != "core",
                                          -(x[1].get("score") or 0))):
            lines.append(f"| [{k}] | {_cluster_of(r)} | {r.get('score', '-')} "
                         f"| {r.get('year', '-')} | {cell(r.get('title'), 60)} |")
        lines.append("")

    lines += [f"## 2. 分類が変わった抄録({len(diff['cluster_changed'])}件)", ""]
    if not diff["cluster_changed"]:
        lines += ["なし。", ""]
    else:
        lines += ["| 引用キー | 前回 | 今回 | スコア変化 |", "|---|---|---|---|"]
        for ok, nk, orec, nrec in diff["cluster_changed"]:
            key = f"[{ok}]" if ok == nk else f"[{ok}] → [{nk}]"
            lines.append(f"| {key} | {_cluster_of(orec)} | {_cluster_of(nrec)} "
                         f"| {orec.get('score', '-')} → {nrec.get('score', '-')} |")
        lines.append("")

    lines += [f"## 3. 消滅した抄録({len(diff['removed'])}件)", "",
              "前回のレポートで引用していた場合、"
              "その根拠が今回のカタログには存在しません。", ""]
    if not diff["removed"]:
        lines += ["なし。", ""]
    else:
        lines += ["| 引用キー | 前回の分類 | スコア | タイトル |", "|---|---|---|---|"]
        for k, r in diff["removed"]:
            lines.append(f"| [{k}] | {_cluster_of(r)} | {r.get('score', '-')} "
                         f"| {cell(r.get('title'), 60)} |")
        lines.append("")

    lines += [f"## 4. スコアが動いた抄録({len(diff['score_changed'])}件)", "",
              f"分類は同じだが、関連度が{gap}点以上変化したもの。", ""]
    if not diff["score_changed"]:
        lines.append("なし。")
    else:
        lines += ["| 引用キー | 分類 | 前回 | 今回 |", "|---|---|---|---|"]
        for ok, nk, orec, nrec in diff["score_changed"]:
            lines.append(f"| [{nk}] | {_cluster_of(nrec)} "
                         f"| {orec.get('score', '-')} | {nrec.get('score', '-')} |")

    if diff["renamed"]:
        lines += ["", f"## 5. 引用キーが変わった抄録({len(diff['renamed'])}件)", "",
                  "DOIまたはタイトルが同一のため同じ論文と判断しました。"
                  "前回のレポートの引用キーは書き換えが必要です。", ""]
        lines += [f"- [{ok}] → [{nk}]" for ok, nk in sorted(diff["renamed"].items())]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def run_diff(theme_arg: str, save_only: bool = False) -> str:
    """前回との差分を取り、報告ファイルのパスを返す(記録だけした場合は空文字)。"""
    theme = resolve_theme(theme_arg)
    if not theme["index"]:
        raise FileNotFoundError(f"[index] …json が見つかりません: {theme['dir']}")
    new = load_index(theme["index"])
    os.makedirs(config.SNAP_DIR, exist_ok=True)
    snap = snapshot_path(theme["name"], new)
    legacy = _legacy_snapshot_path(theme["name"])
    prev = snap if os.path.exists(snap) else (legacy if os.path.exists(legacy) else "")

    if save_only or not prev:
        shutil.copy2(theme["index"], snap)
        print(f"[差分] スナップショットを記録しました: {len(new['items'])}件"
              f"({_fmt_counts(_count_clusters(new['items']))})")
        if not save_only:
            print("[差分] 前回の記録がないため比較はしていません。"
                  "次回の生成時から差分が出ます。")
        return ""

    old = load_index(prev)
    if old.get("generated_at") == new.get("generated_at"):
        print(f"[差分] 前回と同じ生成時刻です({new.get('generated_at')})。"
              "カタログが再生成されていません。")
        return ""

    diff = compare_indexes(old, new)
    out_path = os.path.join(theme["dir"], f"_diff__{theme['name']}.md")
    _write_diff_report(out_path, theme["name"], old, new, diff)
    shutil.copy2(theme["index"], snap)

    print(f"[差分] 前回 {len(old['items'])}件 → 今回 {len(new['items'])}件 / "
          f"新規 {len(diff['added'])}件 / 消滅 {len(diff['removed'])}件 / "
          f"分類変更 {len(diff['cluster_changed'])}件 / "
          f"スコア変動 {len(diff['score_changed'])}件"
          + (f" / 引用キー変更 {len(diff['renamed'])}件" if diff["renamed"] else ""))
    print(f"[差分] 出力: {out_path}")
    return out_path


# ==========================================
# フロントマターのウィキリンクを文字列にする(旧 extract_wikilink_text.py)
# ==========================================
# 例: topic: "[[強度行動障害|強度行動障害]]" → topic: 強度行動障害
# 以前のレポートや手で作ったノートのプロパティに残った [[...]] を外す。
# 本文のリンクには触れない。
_FM_BLOCK_RE = re.compile(r'^---\r?\n(.*?)\r?\n---\r?\n', re.DOTALL)
_WIKILINK_RE = re.compile(r'\[\[([^\[\]\|]+)(?:\|([^\[\]]+))?\]\]')


def _wikilink_to_text(value):
    """値の中のウィキリンクを表示名に置き換える。リストは重複も除く。"""
    if isinstance(value, str):
        def repl(m):
            path, alias = m.group(1), m.group(2)
            if alias:
                return alias
            base = path.rsplit('/', 1)[-1]
            return base[:-3] if base.endswith('.md') else base
        return _WIKILINK_RE.sub(repl, value)
    if isinstance(value, list):
        seen, out = set(), []
        for x in (_wikilink_to_text(v) for v in value):
            key = x if isinstance(x, str) else repr(x)
            if key not in seen:
                seen.add(key)
                out.append(x)
        return out
    if isinstance(value, dict):
        return {k: _wikilink_to_text(v) for k, v in value.items()}
    return value


def _unwikilink_text(text: str, yaml):
    """1ファイル分。戻り値は (新しい本文, 書き換えたプロパティ名の一覧)。"""
    text = text.replace('﻿', '')
    m = _FM_BLOCK_RE.match(text)
    if not m:
        return text, []
    try:
        data = yaml.safe_load(m.group(1))
    except yaml.YAMLError:
        return text, []
    if not isinstance(data, dict):
        return text, []
    new_data = {k: _wikilink_to_text(v) for k, v in data.items()}
    changed = [k for k in data if new_data[k] != data[k]]
    if not changed:
        return text, []
    new_yaml = yaml.dump(new_data, allow_unicode=True, sort_keys=False)
    return f"---\n{new_yaml}---\n{text[m.end():]}", changed


def unwikilink(target: str, apply: bool = False) -> int:
    """ファイルまたはフォルダ(下位も含む .md)のフロントマターを処理する。

    apply が False なら表示だけ。True なら元の内容を .bak に残して書き換える。
    戻り値は対象になったファイルの数。PyYAML が必要(pip install pyyaml)。
    """
    try:
        import yaml
    except ImportError:
        raise SystemExit("[エラー] PyYAML がありません。pip install pyyaml を実行してください。")
    files = ([target] if os.path.isfile(target)
             else glob.glob(os.path.join(target, '**', '*.md'), recursive=True))
    changed = 0
    for path in files:
        with open(path, encoding='utf-8') as f:
            original = f.read()
        fixed, keys = _unwikilink_text(original, yaml)
        if not keys:
            continue
        changed += 1
        print(f"[{path}] ウィキリンクを文字列に{'' if apply else '(プレビューのみ)'}: "
              + ", ".join(keys))
        if apply:
            with open(path + '.bak', 'w', encoding='utf-8') as f:
                f.write(original)
            with open(path, 'w', encoding='utf-8') as f:
                f.write(fixed)
    if changed == 0:
        print("対象は見つかりませんでした")
    elif not apply:
        print("\n--apply を付けて再実行すると実際に書き換えます(元ファイルは .bak に保存)")
    return changed
