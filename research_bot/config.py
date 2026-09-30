"""設定。利用者が変えてよい値は、すべてこのファイルにまとめてある。

  ・値を変えるときはこのファイルだけを直す。他のファイルには数値を書かない。
  ・APIキーは KEYS_FILE(既定は同じフォルダの keys.env)に「NAME=値」の形で
    書くか、環境変数で渡す。
  ・同じ名前の環境変数があれば、そちらが優先される(一時的に試すとき用)。
        PREFILTER_MODE=on python research_bot.py
        FILTER_BATCH_SIZE=4 python research_bot.py --resume
    keys.env に書いた「名前=値」も同じ扱いになる。
  ・相対パスは、このファイルのあるフォルダからの位置として読む。

★ の付いた値は、旧 config.py が手元に無かったため使われ方から推定したもの。
  旧 config.py の値に置き換えてから使うこと。
"""

import os

# ==========================================
# 1. 保存先
# ==========================================
# カタログ一式(テーマごとのフォルダ)を置く場所。Obsidian の Vault の中。
CATALOG_ROOT = "~/storage/shared/Obsidian/Research/抄録カタログ"     # ★
# レポートの保存先(案内の表示に使う)
REPORT_DIR = "~/storage/shared/Obsidian/Research/レポート"          # ★
# テーマを書くファイル。research_bot.py をテーマ無しで実行すると読む。
QUERY_FILE = "query.js"                                              # ★
# カタログの世代間差分(diff)に使う前回分の記録
SNAP_DIR = "snapshots"                                               # ★
# APIキーを書いておくファイル(NVIDIA_API_KEY=... の形。1行に1つ)
KEYS_FILE = "keys.env"
# 1段目(prefilter)の除外ログ
PREFILTER_LOG_DIR = "~/.local/share/research_prefilter"
# 中断復帰用の途中経過(CATALOG_ROOT の下に作る)
CHECKPOINT_DIRNAME = ".checkpoint"

# ==========================================
# 2. 連絡先
# ==========================================
# Crossref・Unpaywall の利用規約で求められる連絡先。空なら環境変数
# ACADEMIC_CONTACT_EMAIL を使う。空のままだと Unpaywall は使われない。
ACADEMIC_EMAIL = ""                                                  # ★

# APIキー(値は KEYS_FILE か環境変数から読む。ここには書かない)
#   NVIDIA_API_KEY    判定に使うLLM(NVIDIA API)
#   OPENALEX_API_KEY  OpenAlex。2026年2月から必須。無いと検索・引用連鎖が0件になる
#   NCBI_API_KEY      PubMed(無くても動くが遅い)
#   S2_API_KEY        Semantic Scholar(無いとほぼ拒否される)
#   CINII_APPID       CiNii Research(無ければCiNiiは検索しない)

# ==========================================
# 3. モデル(NVIDIA API)
# ==========================================
NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"

# 役割ごとのモデル
PLANNING_MODEL = "nvidia/nemotron-3-super-120b-a12b"   # ★ テーマ文→検索ファセット
FILTER_MODEL = "nvidia/nemotron-3-super-120b-a12b"     # ★ 関連度判定・設計の抽出
ENSEMBLE_MODEL = "google/gemma-3-27b-it"               # ★ 事後チェックの再判定(別系統に)
PREFILTER_MODEL = "nvidia/nemotron-3-super-120b-a12b"  # 1段目の粗選別

# --model に渡せる短い名前(python research_bot.py models で実在を確認できる)
MODEL_PRESETS = {                                      # ★
    "1": "nvidia/nemotron-3-super-120b-a12b",
    "2": "openai/gpt-oss-120b",
    "3": "openai/gpt-oss-20b",
    "4": "meta/llama-3.3-70b-instruct",
    "5": "z-ai/glm-5.3-flash",
    "6": "qwen/qwen3-next-80b-a3b-instruct",
    "7": "google/gemma-3-27b-it",
}

# ==========================================
# 4. 通信
# ==========================================
CONCURRENCY = 3               # ★ 同時に投げる問い合わせの数
REQUESTS_PER_MINUTE = 30      # ★ 全スレッド合計の送信上限(1段目も含む)
TEMPERATURE = 0.1             # ★
MAX_TOKENS = 4096             # ★
USE_GUIDED_JSON = False       # NVIDIA の構造化出力(guided_json)を使うか
READ_TIMEOUT = 120            # ★ 秒。この間サーバーから何も届かなければ時間切れ
REQUEST_TIMEOUT = 240         # 秒。応答全体の上限
MAX_RETRIES = 3               # ★ 通信エラー時の再試行回数
MAX_TIMEOUTS = 2              # ★ 時間切れがこの回数続いたらそのバッチを諦める
RETRY_WAIT = 5                # ★ 秒。通信エラー時の待ち(回数に比例して延ばす)
RATE_LIMIT_WAIT_BASE = 10     # ★ 秒。429 のときの待ち(10→20→40…と倍々)
DEAD_MODEL_AFTER = 3          # ★ 続けて諦めたバッチがこの数に達したモデルは以後呼ばない
HEARTBEAT_SECONDS = 60        # ★ 応答待ちの状況を表示する間隔

# ==========================================
# 5. 収集
# ==========================================
# 1回の検索で取る件数(ページングはしない。上限に張り付いたら警告が出る)
FETCH_LIMIT = 100
ERIC_LIMIT = 200              # ERICは1回200件まで
NDL_LIMIT = 200               # NDLサーチは1回500件まで
REQUEST_PAUSE = 1.0           # 秒。DBへの問い合わせの間隔(相手への礼儀)
DB_TIMEOUT = 20               # 秒。DBへの1回の問い合わせの上限
# 抄録がこれより短い文献は収集しない(日本語は1字あたりの情報量が多い)
MIN_ABSTRACT_LENGTH = 200         # ★
MIN_ABSTRACT_LENGTH_JA = 150
# 「ここまで下げれば何件拾えたか」を報告するための参照値
SHORT_REFERENCE_LENGTH = 100      # ★
SHORT_REFERENCE_LENGTH_JA = 80    # ★
# 引用連鎖
SNOWBALL_HOPS = 1                 # ★ 世代数。0で無効
SNOWBALL_SEEDS = 10               # ★ シード数(被引用数の多い順)
SNOWBALL_MIN_GAIN = 0.05          # 新規獲得がシード数のこの割合を下回ったら打ち切る
# 精度重視の検索でこの件数以上集まったら、中核ファセット単独の検索を省く(0で省かない)
CORE_PASS_SKIP_AT = 500           # ★
# 検索式に使うファセットの数(LLMは4つ以上出すことがあるが、ANDが増えるほど件数が枯れる)
MAX_FACETS = 3
# 日本語DB(J-STAGE・CiNii)の検索回数の上限。1語(1組)ごとに1回のリクエストになる。
JA_PAIR_LIMIT = 4                 # 「中核語 × 別ファセットの語」の組
JA_SINGLE_LIMIT = 2               # 中核語だけの検索

# ==========================================
# 6. 1段目: 粗選別(prefilter)
# ==========================================
# 軽い問い合わせで「明らかに無関係」だけを先に弾き、2段目の判定件数を減らす。
#   dryrun … 判定だけして除外しない。2段目のあとに取りこぼし監査を表示する
#   on     … off と判定したものを除外する(off率が上限を超えたら中止)
#   off    … 使わない
PREFILTER_MODE = "dryrun"
PREFILTER_EFFORT = "low"          # 思考の量。空文字にすると指定しない(モデル任せ)
PREFILTER_BATCH_SIZE = 15
PREFILTER_CONCURRENCY = 3
PREFILTER_EXCERPT_CHARS = 500     # 抄録を先頭から何字渡すか
PREFILTER_MAX_TOKENS = 4096
PREFILTER_MAX_DROP_RATIO = 0.6    # off率がこれを超えたら異常とみなし除外しない
PREFILTER_TIMEOUT = 60            # 秒。1段目は省いても困らないので短く待つ
# python research_bot.py bench で比べるモデル(--model で差し替え可)
PREFILTER_BENCH_MODELS = (
    "openai/gpt-oss-20b",
    "z-ai/glm-5.3-flash",
    "meta/llama-3.3-70b-instruct",
    "nvidia/nemotron-3-super-120b-a12b",
)

# ==========================================
# 7. 2段目: 関連度判定
# ==========================================
RELEVANCE_THRESHOLD = 70      # これ未満は除外
CORE_SCORE = 90               # これ以上かつ実測あり → core(中心クラスタ)
OFF_SCORE = 20                # これ以下 → off
CORE_MIN_ITEMS = 5            # ★ core がこれ未満なら最高スコア帯を core として扱う
FILTER_BATCH_SIZE = 6         # 1回の問い合わせで判定する件数
FILTER_EXCERPT_CHARS = 900    # 抄録を先頭から何字渡すか
JUDGE_BATCH_RETRIES = 2       # ★ 応答を読めなかったバッチを送り直す回数
JUDGE_CHECKPOINT_EVERY = 20   # 何バッチごとに途中経過を保存するか
RESCUE_BATCH_SIZE = 2         # ★ 未判定を判定し直すときの件数(少ないほど壊れにくい)

# ==========================================
# 8. 研究設計の抽出・本文での確認
# ==========================================
EXTRACT_BATCH_SIZE = 6        # ★
EXTRACT_EXCERPT_CHARS = 1200  # 設計・参加者は方法と結果に書かれるので判定より広く渡す
OA_LOOKUP_LIMIT = 100         # ★ OA全文の所在を調べる件数(core から順に)
FULLTEXT_REFINE_LIMIT = 30    # ★ 本文(Methods章)で設計を確かめ直す件数。0で無効
FULLTEXT_METHODS_CHARS = 6000 # Methods章の抜粋としてモデルに渡す上限
FULLTEXT_MIN_USABLE_CHARS = 800  # 取れた本文がこれ未満なら要旨だけのページとみなす
FULLTEXT_TIMEOUT = 30         # 秒
FULLTEXT_CONCURRENCY = 3      # 全文の取得・照会の同時接続数(相手のサーバーに配慮して少なめ)

# ==========================================
# 9. 事後チェック(check)
# ==========================================
RUN_CHECK_AFTER_SEARCH = True # 収集が終わったら続けて check を行う
ENSEMBLE_MAX_TOKENS = 4096    # ★
ENSEMBLE_SCORE_GAP = 30       # ★ 2モデルのスコア差がこれ以上なら「その他の不一致」に載せる
DIFF_SCORE_GAP = 15           # ★ 前回とのスコア差がこれ以上なら「スコア変動」に載せる

# ==========================================
# 10. カタログとレポート用プロンプト
# ==========================================
# 抄録がこれより短いものは「内容を判断できない」と警告する
THIN_ABSTRACT_CHARS = 200
THIN_ABSTRACT_CHARS_JA = 100
# レポート生成プロンプトに書く専門領域と、「実践への示唆」の2つの観点
PROMPT_DOMAIN = "心理学(特に発達障害・行動障害領域)"
PROMPT_SUB_DOMAIN = "福祉"
PROMPT_PERSPECTIVE_A = "心理学的支援"
PROMPT_PERSPECTIVE_B = "福祉制度・サービス提供体制"
# relink: 生成元を宣言していないレポートを、引用キーの一致率で推定するときの足切り
RELINK_MIN_RATE = 0.5

# 心理学・福祉・医療・教育のいずれとも無関係な分野を示す語。タイトルか抄録に
# 含まれていたらカタログで警告する(除外はしない。判断は人が行う)。
# 略語の衝突で紛れ込んだ実例: 代謝工学の flux balance analysis、外国語教育の
# 言語選択、小児気道異物のCT診断。
OFF_DOMAIN_PATTERNS = (
    # 基礎生物学・分子生物学・代謝工学
    "flux balance analysis", "genome-scale model", "metabolic network",
    "gene expression profil", "transcriptome", "crystal structure",
    "in vitro assay", "mouse model of cancer",
    # 腫瘍学・薬剤開発
    "chemotherapy", "tumor", "tumour", "carcinoma", "oncolog",
    "antibody-drug conjugate", "myeloma",
    # 工学・物理・情報
    "wireless network", "semiconductor", "combustion",
    "finite element", "hydraulic",
    # 語学教育(behavior/function の語義衝突)
    "foreign language classroom", "second language acquisition",
)

# 日本語の学会誌・大会論文集に混ざる、研究論文でない記事のタイトル。
# 部分一致で弾く語(記事の種別そのものを指し、論文の題名にはまず現れない)
NOISE_TITLE_PATTERNS = (
    "大会長挨拶", "会長挨拶", "巻頭言", "祝辞",
    "各種委員会報告", "委員会報告", "会務報告", "総会報告",
    "会場案内", "タイムスケジュール", "日程表",
    "座長一覧", "賛助会員", "編集後記",
    "学会賞", "会則", "投稿規定", "執筆要領", "奥付",
)
# 完全一致でのみ弾く語。論文の題名の一部として普通に現れるため、部分一致に
# すると本文まで巻き込む。実測:「強度行動障害支援のはじめに考えること」が
# 「はじめに」で、「行動障害のある人への広告リテラシー支援」が「広告」で落ちていた。
NOISE_TITLE_EXACT = (
    "はじめに", "序文", "目次", "索引", "広告", "事務局", "参加費",
    "訂正", "正誤表", "お知らせ", "編集後記", "巻頭言",
)

# ==========================================
# 11. 同義語辞書
# ==========================================
# テーマ文にキー(日本語)が含まれていると、対応するファセットへ同義語を足す。
# LLMの同義語展開が薄いときの下支え。新しい概念を扱うときはここに足す。
#
# 旧診断名を意図的に多く含めている。診断名は改訂のたびに置き換わるのに、
# 文献はその時代の名前のまま残る。intellectual disability だけで検索すると
# 2013年のDSM-5改訂より前の文献がほとんど掛からず、日本語でも「知的障害」
# だけでは1999年の法改正以前の「精神薄弱」の文献に届かない。
BUILTIN_SYNONYMS = {
    "強度行動障害": {
        "en": ["challenging behavior", "challenging behaviour",
               "severe behavior problem", "problem behavior",
               "self-injurious behavior", "self-injury", "aggression",
               "destructive behavior"],
        "ja": ["強度行動障害", "行動障害", "著しい行動障害", "問題行動",
               "自傷行為", "他害行為"],
    },
    "知的障害": {
        "en": ["intellectual disability", "intellectual disabilities",
               "developmental disability", "learning disability",
               "learning difficulties",
               # DSM-5(2013)以前の標準的な呼称
               "mental retardation", "mentally retarded",
               "mental deficiency", "mental handicap"],
        # 「精神薄弱」は1999年の法改正で「知的障害」に改められた語
        "ja": ["知的障害", "精神遅滞", "精神薄弱", "知的能力障害"],
    },
    "自閉症": {
        "en": ["autism", "autism spectrum disorder", "ASD", "autistic",
               # DSM-IV期の下位分類。DSM-5で自閉スペクトラム症に統合された
               "pervasive developmental disorder", "PDD-NOS",
               "Asperger syndrome", "Asperger's disorder",
               "infantile autism", "childhood autism"],
        "ja": ["自閉症", "自閉スペクトラム症", "自閉性障害",
               "広汎性発達障害", "アスペルガー症候群"],
    },
    "応用行動分析": {
        "en": ["applied behavior analysis", "applied behaviour analysis",
               "behavior analytic", "behavioral intervention",
               "behavior modification", "operant conditioning",
               "positive behavior support"],
        "ja": ["応用行動分析", "行動分析", "行動療法", "行動変容",
               "積極的行動支援"],
    },
    "機能的アセスメント": {
        "en": ["functional assessment", "functional behavior assessment",
               "functional analysis", "FBA", "analogue functional analysis",
               "functional communication training"],
        "ja": ["機能的アセスメント", "機能アセスメント", "機能分析"],
    },
    "感覚統合": {
        "en": ["sensory integration", "Ayres sensory integration",
               "sensory processing", "sensory modulation",
               "sensory integrative dysfunction", "sensory defensiveness"],
        "ja": ["感覚統合", "感覚処理", "感覚調整", "感覚防衛"],
    },
    "作業療法": {
        "en": ["occupational therapy", "occupational therapist"],
        "ja": ["作業療法", "作業療法士"],
    },
    "愛着": {
        "en": ["attachment", "attachment security", "caregiver relationship",
               "attachment disorder", "reactive attachment disorder",
               "disinhibited social engagement disorder",
               "maternal deprivation"],
        "ja": ["愛着", "アタッチメント", "愛着障害", "反応性愛着障害"],
    },
}


# ==========================================================================
# ここから下は仕組み。通常は触らなくてよい。
# ==========================================================================
def _load_keys(path: str) -> None:
    """KEYS_FILE の NAME=値 を環境変数に読み込む。

    既に環境変数で渡されているものは上書きしない。「export NAME="値"」の
    形(.bashrc からの写し)でも読める。
    """
    try:
        with open(os.path.expanduser(path), encoding="utf-8") as f:
            lines = f.read().splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        if k.startswith("export "):
            k = k[len("export "):].strip()
        v = v.strip().strip('"').strip("'")
        if k and v and not os.environ.get(k):
            os.environ[k] = v


def _cast(raw: str, default):
    """環境変数の文字列を、既定値と同じ型に直す。"""
    if isinstance(default, bool):
        return raw.strip().lower() in ("1", "true", "yes", "on")
    if isinstance(default, int):
        return int(raw)
    if isinstance(default, float):
        return float(raw)
    return raw


def _apply_env_overrides() -> None:
    """同じ名前の環境変数があれば、その値で上書きする(文字列・数値・真偽値のみ)。"""
    g = globals()
    for name, value in list(g.items()):
        if not name.isupper() or not isinstance(value, (str, int, float, bool)):
            continue
        raw = os.environ.get(name)
        if raw is None or raw == "":
            continue
        try:
            g[name] = _cast(raw, value)
        except ValueError:
            print(f"[設定] 環境変数 {name}={raw!r} を読めないため、"
                  f"既定値 {value!r} を使います。")


_HERE = os.path.dirname(os.path.abspath(__file__))


def _path(p: str) -> str:
    """~ を展開し、相対パスはこのファイルのあるフォルダを起点にする。"""
    p = os.path.expanduser(p)
    return p if os.path.isabs(p) else os.path.join(_HERE, p)


KEYS_FILE = _path(os.environ.get("KEYS_FILE") or KEYS_FILE)
_load_keys(KEYS_FILE)
_apply_env_overrides()
for _name in ("CATALOG_ROOT", "REPORT_DIR", "QUERY_FILE", "SNAP_DIR",
              "PREFILTER_LOG_DIR"):
    globals()[_name] = _path(globals()[_name])

ACADEMIC_EMAIL = ACADEMIC_EMAIL or os.environ.get("ACADEMIC_CONTACT_EMAIL", "")
OPENALEX_API_KEY = os.environ.get("OPENALEX_API_KEY", "")
NCBI_API_KEY = os.environ.get("NCBI_API_KEY", "")
S2_API_KEY = os.environ.get("S2_API_KEY", "")
CINII_APPID = os.environ.get("CINII_APPID", "")


def resolve_model(name: str) -> str:
    """--model に渡された名前(短い名前か正式名)を正式名にする。空なら空文字。"""
    name = (name or "").strip()
    return MODEL_PRESETS.get(name, name)
