"""設定はすべてここ。よく変えるものほど上にある。

目次
  1. 場所(入力・出力・用語集・作業場所・API キー)
  2. 文字起こしエンジン(ENGINES)
  3. 統合・校正に使う LLM(LLMS・MERGE_MODELS・PROOF_MODELS)
  4. 出力の書き方(フィラー・記号)
  5. 音声の前処理と区切り方
  6. 幻覚(ハルシネーション)対策のしきい値
  7. 通信(送信間隔・再試行)

同じ名前の環境変数で、数値・真偽値・文字列の設定を一時的に変えられる
(例: CHUNK_TARGET_SEC=30 python mojiokoshi.py)。ENGINES と LLMS は変えられない。
"""

import os

# ==========================================
# 1. 場所
# ==========================================
INPUT_DIR = "/storage/emulated/0/Converter"
OUTPUT_DIR = "/storage/emulated/0/Converter/Output"
GLOSSARY_FILE = "/storage/emulated/0/Converter/用語.txt"
# 途中経過(区切った音声・各エンジンの結果)を置く場所。中断してもここから再開する。
# 共有ストレージの外(Termux のホーム)に置く。
WORK_DIR = os.path.expanduser("~/.cache/mojiokoshi")
KEYS_FILE = os.path.expanduser("~/.config/mojiokoshi/keys.env")
# KEYS_FILE に無いキーを探す場所(research_bot の NVIDIA キーを使い回す)
KEYS_FALLBACK_FILES = (os.path.expanduser("~/.config/research_bot/keys.env"),)

AUDIO_EXTS = (".m4a", ".mp3", ".wav", ".aac", ".ogg", ".opus", ".oga", ".flac",
              ".amr", ".3gp", ".3gpp", ".webm", ".wma", ".mp4", ".mkv", ".mov", ".m4v")
ASR_LANGUAGE = "ja"            # Whisper に渡す言語
ASR_LANGUAGE_BCP47 = "ja-JP"   # Gemini に渡す言語

# ==========================================
# 2. 文字起こしエンジン
# ==========================================
# 上から順に候補 A・B・C… として統合役の LLM に渡す(LLM にはエンジン名を見せない)。
# enabled=False で使わない。`python mojiokoshi.py check` で今使えるかを確かめられる。
#
# kind
#   groq               Groq の Whisper(OpenAI 互換 API)
#   riva               NVIDIA の音声認識(gRPC の Recognize。build.nvidia.com の function-id)
#   riva_stream        NVIDIA の音声認識(gRPC の StreamingRecognize。ストリーミング専用のモデル用)
#   gemini_transcribe  Gemini の文字起こし専用モデル(Interactions API)
#   gemini_llm         Gemini の通常モデルに音声を聞かせて書き起こさせる
# family   同じ系統(同じモデルの別配信など)は誤りも重なりやすいので、一致の数え方で
#          1つにまとめる。系統の違うエンジン同士の一致を重く見る。
# audio    前処理の種類(AUDIO_PROFILES)。エンジンごとに変えると誤りが重なりにくい。
# glossary 用語集をエンジンに渡すか(Whisper はプロンプト、NVIDIA は単語ブースト、
#          Gemini は custom_vocabulary)。実際の録音(2026-10、1時間47分の会話)で、
#          Whisper はプロンプトの用語を聞こえていない所に差し込み(「〇〇棟の地表は」等)、
#          Parakeet は単語ブーストで用語(人名・棟の名前)の羅列とキリル文字しか出さなく
#          なった。どちらも既定では渡さない。用語集は Gemini と、統合・校正の LLM に渡る。
# trust    音声認識の候補だけから選ぶとき(LLM の統合が無い区間)の信頼の重み(0〜1)。
#          同じ録音で、聞き取りの良かった順に高くしてある。
# max_request_sec  1回に送る音声の長さの上限(秒)。区間(チャンク)を無音を詰めて
#          つなぎ、単語の時刻で区間に振り分け直す。1日の回数制限が厳しいエンジンほど長くする。
ENGINES = [
    dict(name="whisper-v3", kind="groq", model="whisper-large-v3",
         family="whisper", audio="light", glossary=False, trust=0.8, enabled=True),
    dict(name="whisper-turbo", kind="groq", model="whisper-large-v3-turbo",
         family="whisper", audio="denoise", glossary=False, trust=0.7, enabled=True),
    # 25言語対応の Parakeet(日本語は ja-JP)。function-id は build.nvidia.com の
    # parakeet-1_1b-rnnt-multilingual-asr のページの例と同じもの。
    dict(name="parakeet", kind="riva", function_id="71203149-d3b7-4460-8231-1be2543a1fca",
         language_code="ja-JP", family="parakeet", audio="denoise", glossary=False, trust=0.3, enabled=True),
    dict(name="gemini-transcribe", kind="gemini_transcribe", model="gemini-3.5-transcribe",
         family="gemini", audio="light", glossary=True, max_request_sec=1200, trust=1.0, probe=False,
         enabled=True),
    # NVIDIA 上の Whisper large-v3。function-id は build.nvidia.com/openai/whisper-large-v3 の
    # API のページで確かめること(check で ✗ になったら、そのページの値に書き換える)。
    dict(name="nv-whisper", kind="riva", function_id="b702f636-f60c-4a3d-a6f4-f3568c13bd7d",
         language_code="ja", family="whisper", audio="raw", glossary=False, trust=0.7, enabled=True),
    # Nemotron 3.5 ASR(40言語、ストリーミング専用)。function-id を build.nvidia.com の
    # nemotron-asr-streaming のページで調べて入れ、enabled=True にする。
    dict(name="nemotron-asr", kind="riva_stream", function_id="",
         language_code="ja-JP", family="nemotron", audio="denoise", glossary=True, enabled=False),
    # Gemini の通常モデルに書き起こさせる。1日の回数制限が厳しいので既定では使わない。
    dict(name="gemini-flash-asr", kind="gemini_llm", model="gemini-3.8-flash",
         family="gemini-llm", audio="light", glossary=True, max_request_sec=300, enabled=False),
]
# 用語集をエンジンに渡すときの上限
WHISPER_PROMPT_CHARS = 150      # Whisper のプロンプトは 224 トークンまで
ENGINE_VOCAB_MAX = 100          # NVIDIA の単語ブースト・Gemini の custom_vocabulary の語数
RIVA_BOOST = 20.0               # NVIDIA の単語ブーストの強さ(20〜100 が目安)
RIVA_SERVER = "grpc.nvcf.nvidia.com:443"
RIVA_USE_SSL = True
# NVIDIA への送り方。auto = grpcio が入っていればそれを、無ければ curl(HTTP/2)を使う
RIVA_TRANSPORT = "auto"         # auto / curl / grpcio
# NVIDIA に送る音声の形式。pcm(無圧縮)が最も確実。flac は通信量が半分ほど
RIVA_AUDIO = "pcm"
# Groq・Gemini に送る音声の形式。flac(劣化なし)か opus(1/5 ほどの通信量。わずかに劣化)
UPLOAD_FORMAT = "flac"

# ==========================================
# 3. 統合・校正に使う LLM
# ==========================================
# candidates は上から順に、そのサービスのモデル一覧にあるものを使う(無ければ次)。
# batch は統合で1回に送る区間の数、proof_batch は校正で1回に送る区間の数(無ければ PROOF_BATCH)。
# 1日の回数制限が厳しいモデルほど大きく、1分あたりのトークン数が小さいモデル(Groq の無料枠)
# ほど小さくする。大きすぎて断られたら、自動で半分ずつ送り直す。
# glossary_chars はプロンプトに入れる用語集の字数の上限(無ければ 4000)。
# temperature を None にすると送らない(Gemini 3 系は既定値のまま使うよう案内されている)。
# extra は API にそのまま足すパラメータ(None なら自動。思考の量の指定など)。
LLMS = {
    "gemini": dict(provider="gemini", batch=8, temperature=None, extra=None, candidates=[
        "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash",
        "gemini-3-flash-preview", "gemini-2.5-flash"]),
    "gpt-oss": dict(provider="groq", batch=2, proof_batch=4, glossary_chars=1500, temperature=0.0, extra=None,
                    candidates=["openai/gpt-oss-120b", "openai/gpt-oss-20b"]),
    "qwen": dict(provider="groq", batch=2, proof_batch=4, glossary_chars=1500, temperature=0.0, extra=None, candidates=[
        "qwen/qwen3.8-27b", "qwen/qwen3.6-27b", "qwen/qwen3-32b",
        "moonshotai/kimi-k2-instruct-0905", "moonshotai/kimi-k2-instruct"]),
    "nemotron": dict(provider="nvidia", batch=4, temperature=0.0, extra=None, candidates=[
        "nvidia/nemotron-3-super-120b-a12b", "nvidia/nemotron-3-ultra-550b-a55b",
        "openai/gpt-oss-120b", "nvidia/nemotron-3.5-lightning-30b-a3b", "openai/gpt-oss-20b",
        "google/gemma-4-31b-it"]),
    "gemini-lite": dict(provider="gemini", batch=8, temperature=None, extra=None, candidates=[
        "gemini-3.5-flash-lite", "gemini-2.5-flash-lite"]),
}
# 統合(候補を読み比べて1つの本文にする)に使う LLM。2〜5個。それぞれが独立に統合し、
# 音声認識の候補との一致・取りこぼしの少なさ・LLM 同士の一致で、区間ごとに最良を選ぶ。
MERGE_MODELS = ["gemini", "gpt-oss", "qwen", "nemotron"]
# MERGE_MODELS のどれからも統合が返らなかった区間だけを回す代わりの LLM
MERGE_BACKUPS = ["gemini-lite"]
# 校正(句読点・誤変換・フィラー・段落)に使う LLM。上から順に PROOF_COUNT 個を使い、
# 使えないものは次へ回る。複数の校正結果は、元の文からの変わり方が小さいものを選ぶ。
PROOF_MODELS = ["gemini", "gpt-oss", "nemotron", "qwen", "gemini-lite"]
PROOF_COUNT = 2
PROOF_BATCH = 6                 # 校正で1回に送る区間の数
MERGE_ENABLED = True
PROOF_ENABLED = True
# 実行前に、統合・校正の LLM と文字起こしエンジンへごく短い問い合わせを送り、
# 使えるもの(403・404 なら同じ枠の次の候補)だけで始める。結果はこの時間だけ覚えておく
# (上限に当たったものは1時間)。--recheck で問い合わせ直す、--no-preflight で確かめない。
PREFLIGHT = True
PREFLIGHT_CACHE_HOURS = 6

# ==========================================
# 4. 出力の書き方
# ==========================================
# フィラー(えー、あのー、えっと 等)を最終稿で消すか。remove / keep
FILLER_MODE = "remove"
UNCERTAIN_MARK = "〔?〕"          # 候補が割れて決めきれなかった語の直後に付く
INAUDIBLE_MARK = "〔聞き取れず〕"  # どの候補も聞き取れていない箇所
# 記号を消した版(.txt の「_記号なし」)も書き出すか
WRITE_UNMARKED_COPY = True
# Markdown の各段落の頭に時刻を付ける
MD_TIMESTAMPS = True
# 書き出したあと、作業用の音声(WAV)を消す(区間・各エンジンの結果は残すので再開できる。
# 1時間の録音で WAV は 500MB 近くになる)
KEEP_AUDIO_CACHE = False
# 一致度がこれ未満の区間を「要確認」に挙げる(0〜1)
REVIEW_AGREEMENT = 0.55
OBSIDIAN_TAGS = ["文字起こし"]

# ==========================================
# 5. 音声の前処理と区切り方
# ==========================================
# 前処理の種類(ffmpeg のフィルタ)。空文字は 16kHz モノラルにするだけ。
#   light   低域の雑音を切り、小さい声を持ち上げる
#   denoise さらに定常的な雑音(空調・ファン等)を減らす
# 雑音除去は強くかけすぎると子音が削れて認識が悪くなる。エンジンごとに違う
# 前処理を当てて、誤りが重ならないようにしている。
AUDIO_PROFILES = {
    "raw": "",
    "light": "highpass=f=70,dynaudnorm=f=250:g=15:p=0.9:m=8",
    "denoise": "highpass=f=80,lowpass=f=7600,afftdn=nr=12:nf=-40:tn=1,dynaudnorm=f=250:g=15:p=0.9:m=8",
}
# 区間(チャンク)の長さ。区切りは声の切れ目(短い無音)に置く。
CHUNK_TARGET_SEC = 40
CHUNK_MAX_SEC = 60
CHUNK_MIN_SEC = 8
# これ以上続く無音は区間から外し、どのエンジンにも送らない(無音での幻覚を防ぐ)
SILENCE_SKIP_SEC = 4.0
# 声の検出。雑音の床(下位10%の音量)からこの dB 以上大きい所を声とみなす。
# 小さい声を取りこぼすより多めに拾うほうがよいので、低めにしてある。
VAD_MARGIN_DB = 6.0
VAD_HANGOVER_SEC = 0.4          # 声の前後に付ける余白
# 声の割合がこれ未満の区間は送らない
MIN_SPEECH_RATIO = 0.02

# ==========================================
# 6. 幻覚対策のしきい値
# ==========================================
# Whisper の区間ごとの指標で捨てる条件(Whisper 本体の既定と同じ考え方)
WHISPER_NO_SPEECH_PROB = 0.6    # 無音らしさがこれより高く、
WHISPER_LOGPROB = -1.0          # 平均対数確率がこれより低ければ捨てる
WHISPER_COMPRESSION_RATIO = 2.4  # これより高い(同じ文の繰り返し)なら繰り返しを畳む
# 1秒あたりの文字数がこれを超える候補は「多すぎる」と注記する(日本語の会話は 4〜10 字/秒)
MAX_CHARS_PER_SEC = 20
# 動画由来の定型句(無音や雑音で Whisper が書きがち)。他の系統のエンジンに無ければ消す。
# (文の切れ端になる短い語は入れない。本物の会話の一部を消してしまうため)
HALLUCINATION_STRONG = [
    "ご視聴ありがとうございました", "ご清聴ありがとうございました", "最後までご視聴",
    "チャンネル登録", "高評価", "グッドボタン", "字幕は視聴者", "字幕作成", "字幕by", "字幕提供",
    "次回もお楽しみに", "見てくれてありがとう", "ご覧いただきありがとうございました",
]
# 実際の会話にも出る句。他の系統に無く、かつ声がほとんど無い所に出たときだけ消す。
HALLUCINATION_WEAK = [
    "ありがとうございました", "おやすみなさい", "お疲れ様でした", "さようなら",
    "それではまた", "ではまた", "よろしくお願いします",
]
# 統合結果のうち、どの音声認識の候補にも無い連なり(読みでこの字数以上)に〔?〕を付ける
UNSUPPORTED_MIN_CHARS = 5
# 校正の検証。元の文(フィラーを除く)との一致がこれ未満、または長さがこの倍率を超えたら
# その区間の校正は使わない
PROOF_MIN_SIMILARITY = 0.85
PROOF_MAX_GROWTH = 1.15
# 言葉の減り方の下限。統合は「最も信頼できる音声認識の候補」の内容をこの割合以上残して
# いなければ使わない(その区間は候補をそのまま使う)。校正は元の文(フィラーを除く)の
# この割合以上の長さが無ければ使わない。実際の録音で、統合役が1つしか動かなかった回に
# 内容がかなり削られたため。
MERGE_MIN_KEEP = 0.8
PROOF_MIN_KEEP = 0.92

# ==========================================
# 7. 通信
# ==========================================
# 1分あたりの送信上限。Groq はモデルごと、NVIDIA はアカウント全体、Gemini はモデルごと。
# groq_audio は Whisper 2つの合計(Groq のプロジェクト全体で 20 回/分。実測)。
RPM = {"groq": 18, "groq_audio": 18, "nvidia": 35, "gemini": 8}
REQUEST_TIMEOUT = 300           # 1回の問い合わせの上限(秒)
MAX_RETRIES = 6
# 429 で待つよう言われた時間がこれを超えたら、そのモデルは今回の実行では使わない
# (1日の上限に達したとみなす)。次に実行したとき、残りの分だけ問い合わせる。
# Groq の音声は「1時間あたりの秒数」の上限があり、長い録音では途中で十数分待てと
# 言われる(実測: 1時間47分の録音で whisper-turbo が 64/170 区間で止まった)。
# 一括処理なので、20分までは待つ。
MAX_WAIT_SEC = 1200
MODELS_CACHE_HOURS = 12
# 時間内に応答が無かったとき、送り直す回数。これを超えたら、そのモデルは今回は使わない
# (以前は通信エラーと同じく6回送り直し、最悪30分以上、何も表示せずに止まって見えた)
TIMEOUT_RETRIES = 1
HEARTBEAT_SEC = 60              # 応答待ちを表示する間隔(秒)         # モデル一覧を取り直す間隔


# ------------------------------------------
# 自分用の上書き(更新で消えない)
# ------------------------------------------
# ~/.config/mojiokoshi/config_local.py があれば、ここで読み込む。zip で更新すると
# この config.py は入れ替わるので、自分で変えた所はそちらに書いておく。例:
#   engine("nv-whisper")["function_id"] = "build.nvidia.com で調べた値"
#   engine("nemotron-asr")["enabled"] = True
#   MERGE_MODELS = ["gemini", "gpt-oss", "nemotron"]
#   FILLER_MODE = "keep"
LOCAL_CONFIG = os.path.expanduser("~/.config/mojiokoshi/config_local.py")


def engine(name):
    """ENGINES の中の name のエンジンの設定(config_local.py で書き換えるとき用)。"""
    for e in ENGINES:
        if e["name"] == name:
            return e
    raise KeyError(f"ENGINES に {name} がありません")


if os.path.exists(LOCAL_CONFIG):
    with open(LOCAL_CONFIG, encoding="utf-8") as _f:
        exec(compile(_f.read(), LOCAL_CONFIG, "exec"))


# ------------------------------------------
# 環境変数での上書き(数値・真偽値・文字列のみ)
# ------------------------------------------
def _apply_env():
    g = globals()
    for name, val in list(g.items()):
        env = os.environ.get(name)
        if env is None or not name.isupper() or name.startswith("_"):
            continue
        if isinstance(val, bool):
            g[name] = env.strip().lower() in ("1", "true", "yes", "on")
        elif isinstance(val, int):
            g[name] = int(env)
        elif isinstance(val, float):
            g[name] = float(env)
        elif isinstance(val, str):
            g[name] = env


_apply_env()
