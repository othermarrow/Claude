"""全スクリプト共通の設定。利用者が変えてよい値は、すべてここにまとめてある。

よく変える設定・大事な設定ほど上に置いてある。
   1. よく変える設定 ……… 保存先・役割ごとのモデル・1段目のモード・事後チェック
   2. モデルの短い名前と切り替えの順番
   3. 判定の基準 …………… 採用・core・off の閾値、再判定と差分の感度
   4. 収集の範囲 …………… 抄録の下限・引用連鎖・検索件数
   5. レポート生成プロンプトとカタログの警告
   6. 送信の速さ ………… 429(レート制限)が続くときに見る
   7. 細かい調整 ………… 1段目・判定・抽出・本文確認のバッチ数や文字数
   8. 通信の待ち時間と再試行
   9. 初回だけ設定するもの … 連絡先・APIキー・記録の置き場所
  10. 語の一覧と同義語辞書

設定はここにだけ書き、各スクリプトはここから読む。数値を他のファイルに書かない。
以前は同じ値(保存先のパス、モデル名、閾値)が各スクリプトに別々に書かれて
いて、片方だけ直すと食い違った(REPORT_DIR が research_bot.py では
「抄録集/Report」、generate_report.py では「Abstract/report」だった等)。

【一時的に値を変える】
同じ名前の環境変数があれば、そちらが優先される。
    PREFILTER_MODE=on python research_bot.py
    FILTER_BATCH_SIZE=4 python research_bot.py --resume
旧版の名前(NVIDIA_RPM・NVIDIA_CONCURRENCY・NVIDIA_MAX_TOKENS)も使える。

【モデル名について】
過去に「.bashrc に export したはずの環境変数が反映されない」事例があった
ため、モデル名(〜_MODEL)だけは環境変数を見ずここに直接書く。変えるときは
このファイルを書き換えるか、実行時に --model を付ける。

【APIキーについて】
キーは環境変数から読む。加えて KEYS_FILE(~/.config/research_bot/keys.env)が
あればそこからも読む(環境変数が既に設定されていればそちらが優先)。
Termux のウィジェットや cron のように .bashrc を読まない起動経路でも
キーが届くようにするため。書式は1行1つ:
    NVIDIA_API_KEY=nvapi-...
    OPENALEX_API_KEY=...
    ACADEMIC_CONTACT_EMAIL=you@example.com
"""

import os

# ==========================================
# 1. よく変える設定
# ==========================================
# カタログ一式(テーマごとのフォルダ)と引用キーレジストリの置き場所
CATALOG_ROOT = "/storage/emulated/0/Vault/Abstract/catalog"
# レポートの保存先(案内の表示に使う)
REPORT_DIR = "/storage/emulated/0/Vault/Abstract/report"
# テーマを書いておくファイル
QUERY_FILE = "/storage/emulated/0/query.js"

# 役割ごとのモデル(NVIDIA API)。
#   PLANNING : テーマ→ファセット分解。1回しか呼ばないので精度重視。
#   FILTER   : 関連度判定と設計抽出。数百回呼ぶので速度重視。
#   ENSEMBLE : 判定の再確認用。FILTERと別系統のモデルにすること
#              (同じモデルに同じ問いを2回聞いても、見落としは重ならない)。
#              以前は gemma-4-31b だったが、2026-09 に NVIDIA 側で全く応答しなく
#              なったため、実測で再判定をやり遂げた gpt-oss-20b にした。
#   PREFILTER: 1段目の粗選別。「明らかに無関係」だけを弾く。
PLANNING_MODEL = "nvidia/nemotron-3-ultra-550b-a55b"
FILTER_MODEL = "nvidia/nemotron-3-super-120b-a12b"
ENSEMBLE_MODEL = "openai/gpt-oss-20b"
# 再判定の3つ目のモデル。2本目と別系統にし、1本目が残した文献を両方が「除外相当」と
# 判定したものを、再判定の報告の最優先に出す(別系統の2つが共に外したものは、
# 片方だけの癖より、読み直す価値が高い)。実測: 2本目1つだけでは、無関係な文献は
# 取れても「近縁だが対象が違う」研究まで外していた。空文字で3つ目を使わない。
# --model で再判定のモデルを指定したときは、比較のため3つ目は使わない。
ENSEMBLE_SECOND_MODEL = "google/diffusiongemma-26b-a4b-it"
PREFILTER_MODEL = "nvidia/nemotron-3-super-120b-a12b"

# 1段目の粗選別。軽い問い合わせで「明らかに無関係」だけを先に弾き、
# 2段目の判定件数を減らす。
#   dryrun … 判定だけして除外しない。2段目のあとに取りこぼし監査を表示する
#   on     … off と判定したものを除外する(off率が上限を超えたら中止)
#   off    … 使わない
# 2026-09 の実測(強度行動障害, 1934件)で off にした: 1段目が off とした
# 1189件のうち66件を2段目が採用し(関連度95・90を含む)、on にすると取りこぼす。
# dryrun は除外しないのに35分かかり、429 の枠も2段目と取り合う。
# 別のテーマで試すときは PREFILTER_MODE=dryrun python research_bot.py
PREFILTER_MODE = "off"

# 収集完了後に check(アンサンブル判定・全文アクセス・差分)を続けて走らせるか。
# 走らせたくない回だけ --no-check を付ける。
RUN_CHECK_AFTER_SEARCH = True

# ==========================================
# 2. モデルの短い名前と切り替えの順番
# ==========================================
# --model に渡せる短い名前。番号は有用な順(1が最も有用)。一覧に無いモデルは
# "ベンダー/モデル名" で直接渡せる。`python research_bot.py models` で、
# どれが今使えるかを確認できる。
MODEL_PRESETS = {
    "1": "nvidia/nemotron-3-super-120b-a12b",
    "2": "nvidia/nemotron-3.5-lightning-30b-a3b",
    "3": "openai/gpt-oss-20b",
    "4": "google/gemma-4-31b-it",
    "5": "meta/muse-glimmer-30b",
    "6": "z-ai/glm-5.3-flash",
    "7": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    "8": "google/diffusiongemma-26b-a4b-it",   # 拡散方式。思考ありでだけ本文が出る(未評価)
}

# モデルが応答しなくなったときに代わりに使う順番(短い名前か 'ベンダー/モデル名')。
# 途中でモデルが「応答しない」と判定されたら、ここを上から順に見て、まだ
# 使えるモデルに切り替えて残りを続ける。並べ替えれば優先順位を変えられる。
# 消せば候補から外れる。空の () にすると切り替えない(旧版と同じ動き)。
# どの文献をどのモデルで判定したかは、カタログと索引に記録される。
#
# 関連度判定・設計の抽出・ファセット抽出の代わり。1つのカタログの中で判定の
# 付け方がなるべく揃うよう、本判定と同じ系統を先にし、性質を確かめていない
# モデルを後ろに置いている。
# (2026-09 の実測を反映。gemma は全く応答しなかった。番号は据え置き、
#  ここの順番だけで調整している)
#
# 6 と 7 は、どちらの順番からも外してある。代わりに判定させると結果が
# 使えなくなるため。判定するモデルが尽きた分は未判定として残り、後で
# 判定し直せる(質の悪い判定が混ざるより良い)。
#   6 glm-5.3-flash       思考を止める指定が効かず、1バッチに4分以上かかった
#   7 nemotron-nano-omni  関連の明らかな文献(問題行動の機能分析など)に、
#                         プロンプトの例の「同名異義語」をそのまま写した
#                         (再判定の247件を担当し、κ が意味を持たなくなった)
FALLBACK_ORDER = (
    "1",   # nemotron-3-super     本判定と同じ。ファセット抽出が失敗したときの第一候補
    "2",   # nemotron-3.5-lightning  同じ系統で速い。判定の傾向が近い
    "3",   # gpt-oss-20b          思考を少量(low)に抑えて動く。実測で判定できた
    "5",   # muse-glimmer-30b     応答は速い(約5秒)。思考ありで呼ぶ(THINKING_REQUIRED_MODELS)
    "4",   # gemma-4-31b          応答しない状態が続いたので後ろ。戻れば前に出す
)
# 再判定(アンサンブル)の代わり。見落としが重ならないよう別系統を先にする。
# 1本目の判定に使ったモデルは、ここに書いてあっても飛ばす。
ENSEMBLE_FALLBACK_ORDER = (
    "3",   # gpt-oss-20b          既定の再判定モデル。実測で再判定できた
    "8",   # diffusiongemma       82件を37秒で判定。正解付き9件で gpt-oss と同じ結果(無関係4/4を除外、関連0/5を除外)。思考ありで呼ぶ
    "5",   # muse-glimmer-30b     応答は速い。別系統。思考ありで呼ぶ(判定の質は評価中)
    "4",   # gemma-4-31b          応答しない状態が続いたので後ろ
    "2",   # nemotron-3.5-lightning  本判定と同じ系統なので後ろ
    "1",   # nemotron-3-super
)

# ==========================================
# 3. 判定の基準
# ==========================================
RELEVANCE_THRESHOLD = 70      # 関連度がこれ未満は除外
CORE_SCORE = 90               # これ以上かつ実測あり → core(中心クラスタ)
OFF_SCORE = 20                # これ以下は off(同名異義語・対象外分野)
CORE_MIN_ITEMS = 5            # core がこれ未満なら最高スコア帯を core として扱う
# アンサンブル: 2つのモデルのスコア差がこれ以上なら不一致として挙げる
ENSEMBLE_SCORE_GAP = 20
# 差分: 前回とのスコア差がこれ以上なら「スコア変動」として挙げる
DIFF_SCORE_GAP = 10

# ==========================================
# 4. 収集の範囲
# ==========================================
# 同じテーマ文を前に収集していれば、そのときの検索計画(ファセット・検索式・
# テーマの定義・同名異義語)をそのまま使う。False なら毎回 AI が作り直す。
# 作り直すと、同じテーマ文でもファセットや定義が変わることがある(実測:
# 2回目に「入所施設・日本」のファセットが AND で加わり、前回の文献の7割が
# 入れ替わった)。差分で「新しく出た文献」だけを見たいときは True にする。
# 1回だけ切り替えるなら --reuse-plan / --replan を付ける。
# (検索計画を索引に残すようにした版より前の収集からは使えない)
REUSE_SEARCH_PLAN = False
# 抄録の下限。日本語は1文字の情報量が多いので別に持つ。
MIN_ABSTRACT_LENGTH = 400
MIN_ABSTRACT_LENGTH_JA = 150
# 引用連鎖
SNOWBALL_HOPS = 2                 # 世代数。0で無効
SNOWBALL_SEEDS = 16               # シード数(被引用数の多い順)
# 中核ファセット単独のパスを省略する件数。0で常に実行。
CORE_PASS_SKIP_AT = 300
# 1回の検索で取る件数(ページングはしない。上限に張り付いたら警告が出る)
FETCH_LIMIT = 100
ERIC_LIMIT = 200                  # ERICは1回200件まで
NDL_LIMIT = 200                   # NDLサーチは1回500件まで
# 検索式に使うファセットの数(LLMは4つ以上出すことがあるが、ANDが増えるほど件数が枯れる)
MAX_FACETS = 3
# 日本語DB(J-STAGE・CiNii・NDL)の検索回数の上限。1語(1組)ごとに1回のリクエストになる。
JA_PAIR_LIMIT = 4                 # 「中核語 × 別ファセットの語」の組
JA_SINGLE_LIMIT = 2               # 中核語だけの検索
# 引用連鎖で、新規獲得がシード数のこの割合を下回ったら打ち切る
SNOWBALL_MIN_GAIN = 0.05
# 「閾値をここまで下げたら何件拾えたか」を数えるための参照値(動作には影響しない)
SHORT_REFERENCE_LENGTH = 250
SHORT_REFERENCE_LENGTH_JA = 150

# ==========================================
# 5. レポート生成プロンプトとカタログの警告
# ==========================================
# レポート生成プロンプトに書く専門領域と、「実践への示唆」の2つの観点
PROMPT_DOMAIN = "心理学(特に発達障害・行動障害領域)"
PROMPT_SUB_DOMAIN = "福祉"
PROMPT_PERSPECTIVE_A = "心理学的支援"
PROMPT_PERSPECTIVE_B = "福祉制度・サービス提供体制"
# 抄録がこれより短いものは「内容を判断できない」とカタログで警告する
THIN_ABSTRACT_CHARS = 200
THIN_ABSTRACT_CHARS_JA = 100
# relink: 生成元を宣言していないレポートを、引用キーの一致率で推定するときの足切り
RELINK_MIN_RATE = 0.5

# ==========================================
# 6. 送信の速さ(429 が続くときに見る)
# ==========================================
# 1分あたりの送信回数の上限(全スレッド合計。1段目も含む)。NVIDIAの無料枠は
# おおむね40回/分とされるため、少し下に置く。
REQUESTS_PER_MINUTE = 35
# 429・混雑の応答が返ったら送信上限を自動で3割ずつ下げ(RPM_FLOOR まで)、
# 成功が続けば REQUESTS_PER_MINUTE まで少しずつ戻す。混雑する時間帯に
# 同じ間隔で送り続けて再試行を使い切るのを防ぐ。
ADAPTIVE_RPM = True
RPM_FLOOR = 6
# 同時に待つ応答の数。送信間隔は上の RPM で決まるので、ここを増やしても
# 429は増えない(応答待ちの重なりが増えるだけ)。
CONCURRENCY = 4
# 判定・抽出の温度。0にすると同じ抄録には同じ判定が返りやすくなる。
# 既定値(モデル依存で0.6〜1.0)のままだと、再生成のたびにスコアが揺れ、
# 差分(diff)の「スコア変動」が実際の変化ではなく揺らぎを拾ってしまう。
TEMPERATURE = 0.0
MAX_TOKENS = 24576
ENSEMBLE_MAX_TOKENS = 0       # 再判定の max_tokens。0 なら MAX_TOKENS と同じ

# ==========================================
# 7. 細かい調整
# ==========================================
# --- 1段目(prefilter) ---
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
# --- 2段目(関連度判定) ---
FILTER_BATCH_SIZE = 6         # 1回の問い合わせで判定する件数
FILTER_EXCERPT_CHARS = 900    # 抄録を先頭から何字渡すか
JUDGE_BATCH_RETRIES = 2       # 応答を読めなかったバッチを送り直す回数
JUDGE_CHECKPOINT_EVERY = 20   # 何バッチごとに途中経過を保存するか
RESCUE_BATCH_SIZE = 1         # 未判定を判定し直すときの件数(少ないほど壊れにくい)
# 除外した中間帯(OFF_SCORE より上・RELEVANCE_THRESHOLD 未満)を、バッチの
# 顔ぶれを変えてもう一度判定し、採用相当なら戻す。同じ入力でも判定は回ごとに
# 揺れ、実測では採用した文献の3割が別の回では除外されていた。判定の回数は
# 中間帯の件数分(全体の1〜2割)増える。False で行わない
SECOND_LOOK = True
# --- 研究設計の抽出・本文での確認 ---
EXTRACT_BATCH_SIZE = 5
EXTRACT_EXCERPT_CHARS = 1200  # 設計・参加者は方法と結果に書かれるので判定より広く渡す
OA_LOOKUP_LIMIT = 40          # Unpaywallで所在を調べる件数(スコア上位から)
# 本文(Methods章)で設計・参加者を確かめ直す件数の上限。core を優先する。0で無効
FULLTEXT_REFINE_LIMIT = 20
FULLTEXT_METHODS_CHARS = 6000 # Methods章の抜粋としてモデルに渡す上限
FULLTEXT_MIN_USABLE_CHARS = 800  # 取れた本文がこれ未満なら要旨だけのページとみなす
FULLTEXT_TIMEOUT = 30         # 秒
FULLTEXT_CONCURRENCY = 3      # 全文の取得・照会の同時接続数(相手のサーバーに配慮して少なめ)

# ==========================================
# 8. 通信の待ち時間と再試行
# ==========================================
NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"
REQUEST_TIMEOUT = 240         # 秒。応答全体の上限
READ_TIMEOUT = 120            # 秒。ストリーミングでこの間何も届かなければ時間切れ
MAX_RETRIES = 5
MAX_TIMEOUTS = 2              # 時間切れがこの回数続いたらそのバッチを諦める
RETRY_WAIT = 10               # 秒。429以外の一時的エラー(線形に延ばす)
RATE_LIMIT_WAIT_BASE = 20     # 秒。429(指数的に延ばす)
# 続けて諦めたバッチ(時間切れ、または 429・混雑で再試行を使い切った)が
# この数に達したモデルは「応答しない」とみなし、しばらく呼ばない
# (切り替えの順番に代わりのモデルがあれば、そちらで続ける)
DEAD_MODEL_AFTER = 3
# 「応答しない」とみなしたモデルを、この秒数のあとで1回だけ試し直す。
# NVIDIA 側の混雑は一時的なことが多く、実測では再判定の途中で止まった
# モデルの残りを、質の劣るモデルが引き受けていた。試し直して応答すれば
# 元のモデルに戻り、また応答しなければ同じ秒数だけ休ませる。0で試し直さない
# (思考を止められないモデル・名前の誤ったモデルは、この設定と関係なく戻さない)
# 切り替え先がすべて休んでいるときは、どれかを試し直せるまで待つ。どの
# モデルも試し直して応答しなければ、チェックポイントを残して止まる
# (時間をおいて --resume で続ける)
DEAD_MODEL_COOLDOWN = 600
# 思考を止める指定をしたのに、本文を書く前の思考がこの字数を超えたモデルは
# 「思考を止められない」とみなし、その場で以後使わない。時間切れを3回待つより
# ずっと早く代わりのモデルへ移れる。指定が効くモデルの思考は0字。0で無効
THINKING_RUNAWAY_CHARS = 4000
# 思考ありで呼ぶモデル(思考の暴走の見張りも外す)。思考を止められない、または
# 止めると本文が空になるモデルを入れる。
#   diffusiongemma  思考なしだと出力1トークン(終了の合図だけ)で、返答の長さや
#                   temperature を変えても空。思考ありなら本文が出た
#   muse-glimmer    短い問い合わせでは思考なしが効くが、判定のプロンプトでは
#                   本文の前に4000字超の思考が出て、毎回見切られていた
THINKING_REQUIRED_MODELS = (
    "google/diffusiongemma-26b-a4b-it",
    "meta/muse-glimmer-30b",
)
HEARTBEAT_SECONDS = 60        # 応答待ちの状況を表示する間隔(秒)
# NVIDIA NIM の構造化出力(nvext.guided_json)で、JSONの形をAPI側で強制
# する。対応していないモデルでは自動的に外して従来の方法に戻る。
# 手元で効果を確かめてから True にすること。
USE_GUIDED_JSON = False
# 文献データベースへの問い合わせ
REQUEST_PAUSE = 1.0           # 秒。DBへの問い合わせの間隔(相手への礼儀)
DB_TIMEOUT = 20               # 秒。DBへの1回の問い合わせの上限
# Europe PMC だけの上限(秒)。長い検索式(OR が100語近い)だと20秒では返らず、
# 実測で2回続けて Europe PMC だけ0件だった(精度重視・感度重視とも時間切れ)。
# 時間切れなら1回だけ送り直す
EUROPEPMC_TIMEOUT = 60

# ==========================================
# 9. 初回だけ設定するもの
# ==========================================
# Crossref・Unpaywall・PubMed の利用規約で求められる連絡先。ここを空にしておくと
# 環境変数 ACADEMIC_CONTACT_EMAIL(無ければ UNPAYWALL_EMAIL・NCBI_EMAIL)を使う。
# 空のままだと Unpaywall(OA全文の所在)は使われない。
ACADEMIC_EMAIL = ""

# APIキー(値は KEYS_FILE か環境変数から読む。ここには書かない)
#   NVIDIA_API_KEY    判定に使うLLM(NVIDIA API)
#   OPENALEX_API_KEY  OpenAlex。2026年2月から必須。無いと検索・引用連鎖が0件になる
#   NCBI_API_KEY      PubMed(無くても動くが遅い)
#   S2_API_KEY        Semantic Scholar(無いとほぼ拒否される)
#   CINII_APPID       CiNii Research(無ければCiNiiは検索しない)
KEYS_FILE = "~/.config/research_bot/keys.env"

# 記録の置き場所(Vaultの外)
SNAP_DIR = "~/.local/share/research_snapshots"        # 差分(diff)用の前回分の索引
PREFILTER_LOG_DIR = "~/.local/share/research_prefilter"  # 1段目の除外ログ
# 中断復帰用の途中経過(CATALOG_ROOT の下に作る)
CHECKPOINT_DIRNAME = ".checkpoint"

# ==========================================
# 10. 語の一覧と同義語辞書
# ==========================================
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

# --- 同義語辞書 ---
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
# 旧版で使っていた環境変数の名前 → 今の設定名
_ENV_ALIASES = {
    "NVIDIA_RPM": "REQUESTS_PER_MINUTE",
    "NVIDIA_CONCURRENCY": "CONCURRENCY",
    "NVIDIA_MAX_TOKENS": "MAX_TOKENS",
}


def _load_keys(path: str) -> None:
    """KEY=VALUE 形式のファイルを読み、未設定の環境変数だけを埋める。

    「export NAME="値"」の形(.bashrc からの写し)でも読める。
    """
    try:
        with open(path, encoding="utf-8") as f:
            lines = f.read().splitlines()
    except OSError:
        return
    for line in lines:
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        if s.startswith("export "):
            s = s[len("export "):].strip()
        k, v = s.split("=", 1)
        k, v = k.strip(), v.strip().strip('"').strip("'")
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
    """同じ名前(または旧版の名前)の環境変数があれば、その値で上書きする。

    対象は文字列・数値・真偽値の設定だけ。モデル名(〜_MODEL)は上書きしない
    (冒頭の【モデル名について】を参照)。
    """
    g = globals()
    old_names = {new: old for old, new in _ENV_ALIASES.items()}
    for name, value in list(g.items()):
        if (not name.isupper() or name.startswith("_") or name.endswith("_MODEL")
                or not isinstance(value, (str, int, float, bool))):
            continue
        raw = os.environ.get(name) or os.environ.get(old_names.get(name, ""), "")
        if not raw:
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

ACADEMIC_EMAIL = (ACADEMIC_EMAIL
                  or os.environ.get("ACADEMIC_CONTACT_EMAIL")
                  or os.environ.get("UNPAYWALL_EMAIL")
                  or os.environ.get("NCBI_EMAIL") or "")
OPENALEX_API_KEY = os.environ.get("OPENALEX_API_KEY", "")
NCBI_API_KEY = os.environ.get("NCBI_API_KEY", "")
S2_API_KEY = os.environ.get("S2_API_KEY", "")
CINII_APPID = os.environ.get("CINII_APPID", "")


def fallback_models(role: str = "judge") -> list:
    """切り替えの順番を正式なモデル名の並びにする(重複は除く)。

    role が "ensemble" なら ENSEMBLE_FALLBACK_ORDER、それ以外は FALLBACK_ORDER。
    """
    setting = "ENSEMBLE_FALLBACK_ORDER" if role == "ensemble" else "FALLBACK_ORDER"
    out = []
    for name in globals()[setting]:
        key = str(name).strip()
        m = MODEL_PRESETS.get(key) or (key if "/" in key else "")
        if not m:
            raise SystemExit(
                f"[エラー] config.py の {setting} にある '{key}' が分かりません。\n"
                "        短い名前: " + " / ".join(MODEL_PRESETS)
                + " か、'ベンダー/モデル名' の形で書いてください。")
        if m not in out:
            out.append(m)
    return out


def resolve_model(name: str) -> str:
    """--model に渡された短い名前(またはモデル名そのもの)を解決する。"""
    key = (name or "").strip()
    if not key:
        return ""
    if key in MODEL_PRESETS:
        return MODEL_PRESETS[key]
    if "/" in key:
        return key
    raise SystemExit(
        f"[エラー] --model の指定 '{key}' が分かりません。\n"
        "        短い名前: " + " / ".join(f"{k}={v}" for k, v in MODEL_PRESETS.items())
        + "\n        一覧に無いモデルは 'ベンダー/モデル名' の形で直接渡せます。")
