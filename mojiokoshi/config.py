"""mojiokoshi の設定。よく変える設定ほど上にある。

【設定を変える】
このファイルは更新(update.sh)で上書きされる。ずっと変えておきたい設定は
~/.config/mojiokoshi/settings.env に `名前=値` の形で1行ずつ書く(更新しても残る)。
    OUTPUT_DIR=/storage/emulated/0/Vault/文字起こし
    VAD_THRESHOLD=0.35
一時的に変えるときは、同じ名前の環境変数でもよい(settings.env より優先)。
    VAD_THRESHOLD=0.3 python mojiokoshi.py 録音.m4a
コマンドの引数(--vad-threshold など)があれば、そちらが最優先。
モデルの表(ASR_MODELS)は変えられない。function-id は `models` で確かめた値が
~/.config/mojiokoshi/functions.json に残り、こちらより優先される。

【APIキー】
環境変数 NVIDIA_API_KEY を使う(.bashrc の export でよい)。無ければ KEYS_FILES の
ファイルから読む(書式は1行1つ `NVIDIA_API_KEY=nvapi-...`)。research_bot の
keys.env があれば、そのキーも使える。
"""

import os

# ==========================================
# 1. よく変える設定
# ==========================================
# 結果の保存先。空なら録音ファイルと同じフォルダ
OUTPUT_DIR = ""

# 書き出す形式(カンマ区切り)。md … 時刻つきの本文と一覧(Obsidian 用)、
# txt … 文ごとに改行したテキスト、srt … 字幕形式
OUTPUT_FORMATS = "md,txt"
# txt にも区間の時刻を書く
TXT_TIMESTAMPS = True
# txt では、間がこれ(秒)より短い区間どうしを1つの段落にまとめる(時刻は段落の頭だけ)
PARAGRAPH_GAP_SEC = 3.0

# 文字起こしに使うモデル(下の ASR_MODELS の短い名前)
ASR_MODEL = "whisper"

# 確認用のモデル。空なら使わない。設定すると、ASR_MODEL が文字を返した区間を
# このモデルでも認識し、こちらが「声なし」とした区間を要確認にする
# (Whisper は物音だけの区間でも文章を作ることがあるが、parakeet・canary の
# 方式は作りにくい)。送信回数は最大で倍になる
VERIFY_MODEL = ""

# 声とみなす確からしさ(0〜1)。下げると、物音にかき消されかけた声も拾うが、
# 物音を声とみなすことも増える(その分は送信回数と誤認識の確認が増える)。
# Silero VAD の標準は 0.5。実際の録音で会話が抜けたため 0.4 から下げた
# (テスト音源3本で、発話の一部欠け 5 → 3、物音だけの区間 11 → 17)
VAD_THRESHOLD = 0.3

# 声の検出を、雑音を除いて音量をそろえた音声(RNNoise → dynaudnorm)でも行い、
# 元の音声での結果と合わせる(どちらかで声なら声)。掃除機のような大きな定常音の
# 下の声や、小さな返事を拾いやすくなる。そのぶん声の検出に時間がかかる
# (ffmpeg の RNNoise が録音の長さの 3〜5% ほど)。--fast-vad で一時的に切れる。
# テスト音源3本(声60発話・物音120回)での実測:
#   元の音声だけ      取りこぼし 15 / 物音だけの区間 10
#   合わせる          取りこぼし 11 / 物音だけの区間 11
VAD_DENOISED = True

# 雑音を減らす処理(文字起こしに送る音声だけにかける。声の検出には使わない)
#   none    … かけない(既定)。Whisper は雑音の中で学習されていて、雑音除去の
#             ひずみで逆に誤りが増えることがある
#   rnnoise … ffmpeg の arnndn(RNNoise)。スマホの中で処理する
#   bnr     … NVIDIA Maxine BNR(API)。区間ごとに送る。試験的
DENOISE = "none"

# 同じ区間を、雑音を除いた音声(RNNoise)でももう1回認識し、2つの結果を LLM の
# 手直し(txt)で突き合わせる。食い違う所は文脈から自然な方を選ばせる。
# A(元の音声)が文字にならず B だけが文字になった区間は B を使う。
# 送信回数は倍になる。none で切る(--single-pass でも一時的に切れる)
SECOND_PASS = "rnnoise"

# 発話のない時間がこれ以上続いたら、本文に「発話なし ○分」と書く(秒)
GAP_NOTE_SEC = 60

# ==========================================
# 2. 文字起こしのモデル(NVIDIA API の Riva)
# ==========================================
# function_id は build.nvidia.com の各モデルの API ページにある値。
# 空のときや古くなったときは `python mojiokoshi.py models` で探せる。
#   language … そのモデルに渡す言語コード
#   mode     … offline(一括) / streaming(ストリーミング。API ページの例が
#              transcribe_file.py のモデル)
ASR_MODELS = {
    "whisper": {
        "name": "openai/whisper-large-v3",
        "function_id": "b702f636-f60c-4a3d-a6f4-f3568c13bd7d",
        "language": "ja",
        "mode": "offline",
        "match": ("whisper", "large-v3"),
        "hallucinates": True,
    },
    "parakeet": {
        "name": "nvidia/parakeet-1.1b-rnnt-multilingual-asr",
        "function_id": "71203149-d3b7-4460-8231-1be2543a1fca",
        "language": "ja-JP",
        "mode": "streaming",
        "match": ("parakeet", "multilingual"),
        "hallucinates": False,
    },
    "canary": {
        "name": "nvidia/canary-1b-asr",
        "function_id": "b0e8b4a5-217c-40b7-9b96-17d84e666317",
        "language": "ja-JP",
        "mode": "offline",
        "match": ("canary",),
        "hallucinates": False,
    },
}

# 言語コードが受け付けられなかったときに試す順番(models で確かめるとき)
LANGUAGE_CANDIDATES = ("ja", "ja-JP", "multi")

# 句読点を付けさせる
AUTOMATIC_PUNCTUATION = True

# 音声の送り方(オフライン方式のモデル)
#   pcm  … 生データに形式(16kHz・16bit・1ch)を明示して送る
#   wav  … WAV のヘッダを付けて送る(公式の transcribe_file_offline.py と同じ)
#   auto … pcm で始め、声のはっきりした区間が続けて空で返ったら wav を試し、
#          文字が返れば以降 wav にする(結果は functions.json に残る)
AUDIO_STYLE = "auto"

# ==========================================
# 3. 声の検出と区間分け(Silero VAD)
# ==========================================
# いったん声と判定したあと、これを下回ったら声の終わりの候補
VAD_NEG_THRESHOLD = 0.15
# これより短い声は捨てる(秒)。咳払いや物音の誤検出を減らす
MIN_SPEECH_SEC = 0.25
# 声らしさがしきい値以上のフレームが合わせてこれ未満の区間は送らない(秒)。
# 物音で一瞬だけ声らしさが上がった区間から、Whisper が「ありがとうございました」
# などを作るのを防ぐ(実際の録音で、声らしい部分 0.0〜0.2秒の区間から多数出た。
# テスト音源では、物音だけの区間 17 → 12、発話の取りこぼしは増えず)
MIN_VOICED_SEC = 0.2
# 声の途切れがこれより短ければ、同じ発話とみなす(秒)
MIN_SILENCE_SEC = 0.5
# 区間の前後に足す余白(秒)。語頭・語尾の欠けを防ぐ。物音が重なった発話は
# 声らしさが途中で下がり、区間が発話の途中で終わりやすい(テスト音源では
# 0.3秒 → 0.5秒で、発話の欠けが 8件 → 5件。送る量は 6% 増)
SPEECH_PAD_SEC = 0.5
# 区間どうしの間がこれ以下なら1つにまとめる(秒)。前後の文脈があるほど
# 認識は正確になり、短い断片で起きやすい誤認識も減る
MERGE_GAP_SEC = 2.0
# 1回に送る長さの上限(秒)。長い発話は声の途切れた所で分ける。Whisper は長い
# 区間の後半や、物音・間の後を飛ばすことがあり、実際の録音で会話が抜けたため
# 25秒から縮めた(送信回数はテスト音源で 4割ほど増える)
MAX_SEGMENT_SEC = 15.0
# 声の検出を並べて流す本数(多いほど速い。1本のつなぎ目の0.5秒ほどは精度が落ちる)
VAD_STREAMS = 16
# Silero VAD のモデル(setup.sh が取ってくる)
VAD_MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                              "models", "silero_vad.onnx")

# ==========================================
# 4. 送る音声の整え方
# ==========================================
# 低い音(空調・足音・机を叩く振動など)を切る周波数(Hz)。0 で切らない
HIGHPASS_HZ = 80
# 区間の中で、声のない瞬間の大きな物音(ドア・食器・叩く音)を、声の大きさまで
# 下げる。音量の基準が物音に引っぱられて、声が相対的に小さくなるのを防ぐ
DUCK_TRANSIENTS = True
# 声の部分の音量をこの大きさにそろえる(dBFS)
TARGET_SPEECH_DBFS = -23.0
# 声の音量をそろえるときに足す音量の上限(dB)。遠くで録った小さな声でも target まで
# 持ち上げる。実際の録音で声が -50〜-68dBFS(普通の録音より 30dB ほど小さい)だった。
# Whisper は音の大きさをそろえずに特徴量を作るので、小さいまま送ると不利になる
MAX_GAIN_DB = 45.0
# rnnoise のモデル(setup.sh が取ってくる)と、元の音を混ぜる割合
# (1.0 で雑音除去だけ。0.85 なら15%は元の音を残し、声のひずみを抑える)。
# モデルは rnnoise-models の leavened-quisling(雑音: 一般、残す音: 声。
# 笑い声など言葉でない発声も残す組み合わせ)
RNNOISE_MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                  "models", "rnnoise_lq.rnnn")
RNNOISE_MIX = 0.85
# BNR の強さ(0〜1)
BNR_INTENSITY = 1.0

# ==========================================
# 5. 抜けの立て直しと、誤認識の扱い
# ==========================================
# 声らしい部分の長さに比べて文字が少ない区間(飛ばされた疑い)を、声の途切れで
# 細かく分けて送り直し、文字が多く取れた方を使う
RECOVER_SHORT = True
# 声らしい部分がこれ以上あり(秒)、1秒あたりの文字数がこれ未満なら送り直す
# (日本語の会話は、声らしい部分1秒あたり 5〜8字ほど)
RECOVER_MIN_VOICED_SEC = 2.5
RECOVER_MIN_CHARS_PER_SEC = 3.0
# 送り直すときの1片の長さの上限(秒)
RECOVER_PIECE_SEC = 7.0
# 送り直しても、声らしい部分がこれ以上(秒)あるのに 1秒あたりこの字数未満なら
# 要確認にする(聞き取れなかった部分があるかもしれない)
LOW_DENSITY_VOICED_SEC = 4.0
LOW_DENSITY_CHARS_PER_SEC = 1.5
# 声らしい部分がこれ以上(秒)あるのに文字にならなかった区間は、本文に
# 「(文字にならず)」と残す(消さない)
EMPTY_FLAG_VOICED_SEC = 2.0

# 1秒あたりの文字数がこれを超えたら要確認(物音から長い文章を作った疑い)
MAX_CHARS_PER_SEC = 20.0
# 声らしい部分(声らしさがしきい値以上の時間)がこれ未満の区間で、物音だけでも
# 出やすい言葉(「はい」「ありがとうございました」など)だけが返ったら要確認(秒)
WEAK_VOICED_SEC = 0.5
# 声らしい部分がこれ未満で、声らしさの最大もこれ未満の区間は、何が返っても要確認
LOW_EVIDENCE_VOICED_SEC = 0.3
LOW_EVIDENCE_PROB = 0.7

# ==========================================
# 6. 読みやすく整える(txt。--no-polish で切る)
# ==========================================
# 文字起こしの後で LLM に、聞き間違い(音の近い別の言葉)・句読点・紛れ込んだ
# 定型句だけを、前後の文脈から直させる。方言や話し言葉はそのまま残させる。
# 直した版は .txt に、元の認識結果は .md に書く
POLISH = True
# research_bot で 2026-10 に動いた中で最も大きいモデル。日本語の聞き間違いを文脈から
# 直すのに向く。使えなければ順に切り替える。gemma-4-31b-it は、research_bot で
# 2026-09 から応答しない状態が続いたため入れていない
POLISH_MODEL = "nvidia/nemotron-3-ultra-550b-a55b"
POLISH_FALLBACK_MODELS = ("nvidia/nemotron-3-super-120b-a12b", "openai/gpt-oss-20b")
# 1回に直させる行の数。返答が長いほど時間切れ・途中切れが起きやすいので短めにする
# (ultra は research_bot の実測で、思考なしの1回に約1分かかった)
POLISH_BATCH_LINES = 20
# 録音の場面の説明(LLM に渡す。空にすると渡さない)。場面が違う録音では settings.env で変える
POLISH_CONTEXT = ("障害者支援施設(強度行動障害のある人が暮らす入所施設)で録音した、"
                  "職員どうしの会話・会議・電話。関西弁を含む")
# 施設の録音に出てきやすい専門用語・勤務の言葉(glossary.py)も LLM に渡す
BUILTIN_GLOSSARY = True
# よく出る言葉・人名を1行に1つずつ書いたファイル(LLM に渡す。無くてもよい)
GLOSSARY_FILE = "~/.config/mojiokoshi/words.txt"
# 直した行が元の行とどれだけ似ていれば採用するか(0〜1)。下回れば元の行を使う
POLISH_MIN_SIMILARITY = 0.6
# LLM の返答は少しずつ受け取る。この秒数のあいだ何も届かなければ時間切れ
POLISH_READ_TIMEOUT = 120
# 1回の返答全体の上限(秒)。時間切れが2回続いたモデルは、その回は次のモデルに任せる
POLISH_TOTAL_TIMEOUT = 600

# ==========================================
# 7. 通信
# ==========================================
NVIDIA_GRPC_SERVER = "grpc.nvcf.nvidia.com:443"
# 試験用(手元の偽サーバーにつなぐとき True。ふだんは False のまま)
NVIDIA_GRPC_INSECURE = False
NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"
NVCF_FUNCTIONS_URL = ("https://api.nvcf.nvidia.com/v2/nvcf/functions"
                      "?visibility=public,authorized")
# 1分あたりの送信上限(全モデル合計)。混雑(RESOURCE_EXHAUSTED)が返ると自動で下げる
REQUESTS_PER_MINUTE = 35
RPM_FLOOR = 6
# 同時に送る数
CONCURRENCY = 3
# 1回の待ち時間(秒)と再試行の回数
REQUEST_TIMEOUT = 120
MAX_RETRIES = 5

# ==========================================
# 8. 初回だけ設定するもの
# ==========================================
KEY_NAME = "NVIDIA_API_KEY"
KEYS_FILES = ("~/.config/mojiokoshi/keys.env", "~/.config/research_bot/keys.env")
# 途中経過(再開用)の置き場所。録音ごとにフォルダができる
WORK_DIR = "~/.cache/mojiokoshi"
# 処理が終わったら、変換した音声(長い録音では数百MB)を消す。
# 認識結果の記録は残るので、同じ録音のやり直しでは送り直さない
DELETE_AUDIO_CACHE = True
# 長い処理の間、画面を消してもスマホが眠らないようにする(termux-wake-lock)
WAKE_LOCK = True
# 終わったら通知する(Termux:API があるとき)
NOTIFY = True


# ==========================================
# 環境変数での上書き
# ==========================================
_NO_ENV = ("ASR_MODELS", "KEY_NAME", "VAD_MODEL_PATH", "RNNOISE_MODEL_PATH", "SETTINGS_FILE")


SETTINGS_FILE = "~/.config/mojiokoshi/settings.env"


def _settings_file():
    vals = {}
    try:
        with open(os.path.expanduser(SETTINGS_FILE), encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("export "):
                    line = line[7:].strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                vals[k.strip()] = v.strip().strip("'\"")
    except OSError:
        pass
    return vals


def _override():
    g = globals()
    vals = _settings_file()
    for name, val in list(g.items()):
        if not name.isupper() or name in _NO_ENV:
            continue
        env = os.environ.get(name, vals.get(name))
        if env is None:
            continue
        if isinstance(val, bool):
            g[name] = env.strip().lower() in ("1", "true", "yes", "on")
        elif isinstance(val, int):
            g[name] = int(env)
        elif isinstance(val, float):
            g[name] = float(env)
        elif isinstance(val, str):
            g[name] = env


_override()
