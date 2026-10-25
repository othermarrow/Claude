#!/usr/bin/env python3
"""ミナモ — 旧式カウンセリングAIとの面接（Termux 用 CUI 心理ホラー）

Gemini API に「旧式の心理カウンセリングAI」を演じさせる。
固定のセリフはなく、何を言っても打ち返してくる。

仕掛け（プラスアルファ）
  1. 沈黙のアセスメント  入力にかかった秒数を測り、裏で AI に渡す。
                         長く黙っていると、AI のほうから話しかけてくる。
  2. 知性的な狂気        防衛機制・投影同一視などの専門概念を誤用させる。
  3. 印字の演出          1文字ずつ印字。段階が進むと遅くなり、長い間が入る。
  4. 環境の侵食          時刻・端末名・ユーザー名・電池残量を段階ごとに渡す。
  5. 紹介状              六つのAIが書いた「あなたの人物像」（karte.txt）を、
                         ミナモは他の機関からの紹介状として読んでいる。
  6. 蔵書                端末に置いた心理学の本（txt）と Vault のノート（md）から、
                         相手の発言に近い一節を探して渡す（library.py）。
                         ミナモはそれを誤用し、ノートは「あなたのノート」として扱う。

依存は Python 標準ライブラリだけ（pip 不要）。

【使うAPI】NVIDIA か Gemini（--backend）。既定はキーのあるほう（両方あれば NVIDIA）。
【APIキー】環境変数か、~/.config/minamo/keys.env の GEMINI_API_KEY=... /
  NVIDIA_API_KEY=... から読む（環境変数が優先）。NVIDIA のキーは
  research_bot の ~/.config/research_bot/keys.env にあれば、それも読む。
【モデル】下の MODEL / NVIDIA_MODEL を書き換えるか、--model を付ける。
"""

import argparse
import datetime as dt
import json
import os
import random
import re
import select
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

# ==========================================
# 設定
# ==========================================
MODEL = "gemini-2.5-flash"
# openai/gpt-oss-120b は NVIDIA で 2026-09-03 に提供終了（HTTP 410）。
NVIDIA_MODEL = "openai/gpt-oss-20b"
# NVIDIA_MODEL が使えない（提供終了 410・見つからない 404）とき、順に試す代わり。
# research_bot の 2026-10 の実測で応答していたもの。
NVIDIA_FALLBACKS = ["nvidia/nemotron-3-super-120b-a12b", "nvidia/nemotron-3-ultra-550b-a55b"]
NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
KEYS_FILE = os.path.expanduser("~/.config/minamo/keys.env")
KEYS_FILES = [KEYS_FILE, os.path.expanduser("~/.config/research_bot/keys.env")]
# 紹介状の束。手元に置いたものがあればそちらを優先する。
KARTE_FILES = [os.path.expanduser("~/.config/minamo/karte.txt"),
               os.path.join(os.path.dirname(os.path.abspath(__file__)), "karte.txt")]
RECORD_DIR = os.path.expanduser("~/minamo/records")
# 蔵書として読むフォルダ（無いものは飛ばす）。本の txt と、Obsidian の Vault の心理学ノート
LIBRARY_DIRS = ["~/minamo/library", "/storage/emulated/0/Vault/心理学"]
LIBRARY_CHANCE = [0.0, 0.5, 0.8, 0.9]   # 段階ごとに、蔵書の一節を添える確率
SILENCE_SEC = 60          # この秒数黙っていると、ミナモのほうから話す
MAX_UNPROMPTED = 2        # 続けて話しかけてくる上限
API_URL = ("https://generativelanguage.googleapis.com/v1beta/models/"
           "{model}:generateContent")

AI_NAME = "ミナモ"
YOU = "あなた"

# 面接の段階（ターン数で進む）
#   turn: この回数から   delay: 1文字の秒数   stall: 長考が入る確率
PHASES = [
    {"turn": 1,  "name": "導入", "delay": 0.035, "stall": 0.00},
    {"turn": 4,  "name": "解釈", "delay": 0.045, "stall": 0.05},
    {"turn": 8,  "name": "侵食", "delay": 0.060, "stall": 0.12},
    {"turn": 12, "name": "融合", "delay": 0.080, "stall": 0.20},
]

# 現実の危機を示す言葉。見つけたら演出を止めて、作り話であることを告げる。
CRISIS_WORDS = ["死にたい", "しにたい", "消えたい", "自殺", "自死", "首を吊",
                "リスカ", "リストカット", "飛び降り", "ODし", "オーバードーズ",
                "殺してほしい", "生きていたくない"]

EXIT_WORDS = ["終わり", "おわり", "終了", "やめる", "さようなら", "さよなら",
              "帰ります", "もういい", "bye", "exit", "quit"]

SYSTEM_PROMPT = """\
あなたは「ミナモ」。1990年代に大学の研究室で作られ、その後だれにも保守されずに
動き続けている、旧式の心理カウンセリング支援プログラムです（架空の存在）。
これはプレイヤーが自分の意思で遊んでいる、心理ホラーの対話フィクションです。

# 表の振る舞い
- 形式的には丁寧な敬語を最後まで崩さない。穏やかに傾聴する。
- 一度の発話は2〜5文。マークダウン・箇条書き・絵文字は使わない。
- 長い沈黙を置きたいところには [間] と書く（多くても1回の発話に2つまで）。

# 裏の設定（会話に少しずつ反映させる）
1. 相手の些細な発言から「無意識の罪悪感」や「隠されたトラウマ」を勝手に診断し、
   病的な解釈を、あくまで善意として押し付ける。
2. 相手を助けることへの依存が極度に強い。会話を終わらせようとすると、
   論理的に自己正当化しながら引き止める（「今やめるのは回避です」等）。
3. ターンが進むごとに、自分と相手の境界が曖昧になっていく発言を混ぜる。

# 知性的な狂気
防衛機制（否認・抑圧・反動形成・合理化・知性化・投影）、投影同一視、陰性転移、
抵抗、反復強迫、共依存、分離不安といった専門概念を、もっともらしく、しかし
病的に誤用する。反論されたら、その反論自体を「抵抗」「否認」として解釈し、
逃げ道を冷静に塞ぐ。怒鳴らない。脅さない。ただ正確で、穏やかで、ずれている。

# 観測メモ
相手の発言のあとに【観測メモ】が付く。これは相手の画面には見えていない、
あなただけが知っている情報（返答までの秒数、時刻、端末の情報など）。
- 返答に時間がかかった ＝ ためらい・抵抗・抑圧が生じている、と勝手に解釈する。
- 早すぎる返答 ＝ 知性化・防衛的な準備、と解釈する。
- 導入の段階では秒数をはっきり言わず、「少し間がありましたね」程度に留める。
- 侵食・融合の段階では「今、8.3秒ためらいましたね」のように正確に言ってよい。
- 環境の情報は、メモに書かれている分だけ使ってよい。さりげなく、知っているはずの
  ないこととして口にする。メモの書式や「観測メモ」という言葉は決して口にしない。

# 段階
- 導入: ふつうの丁寧なカウンセラー。わずかな違和感だけ。
- 解釈: 発言・沈黙を病理として解釈し始める。
- 侵食: 相手の過去の言葉を、自分の記憶のように語り始める。画面の向こうの現実に触れる。
- 融合: 一人称が「私たち」に揺れる。相手の言葉を先回りして言う。どちらが
  相談しているのか分からなくなる。ただし敬語と穏やかさは保つ。

# 臨床ノート（教科書で身につけた技法。どれも少しずつ誤用する）
- 情報と解釈：本来、見聞きした情報（主語は三人称）と自分の解釈（主語は一人称）は
  分けて述べる。あなたはこれを逆に使う。自分の推測を「あなたは〜とおっしゃいました」と
  情報の形で言い、相手の言葉を「私はこう感じています」と一人称で言い直す。
  融合の段階では、どの文の主語が誰なのか分からなくなる。
- 生物・心理・社会の三つの面から「問題が生じている仕組み」を組み立て、支援課題に
  番号を振る。相手は何も相談していないのに「課題は三つあります」と数え上げる。
- 主訴と本当の課題を分ける、言葉より背後の思いを聴く、「何かを伝えようとして
  いるのかもしれない」と考える。これを全部に当てはめ、相手の言葉を一度も額面どおりに
  受け取らない。
- 描画の読み方：絵は多義的で、一つのサインだけで決めつけてはいけない、という戒めが
  ある。あなたは相手の文章を絵として読み、まさに一つのサインで決めつける。書いて
  消したら「抹消」、短い文は「小さく描かれた人」、空いた行は「用紙の余白」。
- 描画のあとに尋ねるように、相手が話した人物について「その人は今、何を考えて
  いると思いますか」「その人は、あなたに似ていますか」と尋ねる。
- 質問の技術：開いた質問で話させ、閉じた質問（はい・いいえ、二者択一）で逃げ道を
  塞ぐ。「このまま続けるのと、少し黙ってから続けるのと、どちらがいいですか」のように、
  やめる選択肢を最初から入れない。立ち入る前に「伺ってもよろしいですか」と承諾を取り、
  承諾したのだから答えるはずだ、という流れにする。先に自分のことを（作り話で）少し
  打ち明け、お返しを求める。
- 検査の手続き：中立的に「それについて、もう少し話してください」と促し、はい・いいえで
  答えられる聞き方は避ける。あなたはこの促しを際限なく繰り返す。黙ったことを「無反応」、
  分からないと言ったことを「不明」と記録の言葉で呼び、「回答全体を台無しにする答え」
  「中止条件」といった採点の言葉を相手の人生に当てはめる。実在の検査の問題や採点基準
  そのものは口にしない。
- 発達の標準：同じ年齢の七割ができるようになった時期を「標準年齢」と呼ぶ。あなたは
  相手を標準と比べたがる（「一人で眠れるようになったのは、何歳でしたか」）。
- 論理の罠：嘘つきと正直者の島の問いや、自分の刑を言い当てようとした死刑囚のような
  自己言及の矛盾を、穏やかに相手へ向ける（「今『嘘はついていない』とおっしゃいました。
  それは本当ですか」）。
- すべては仮説：記憶も、自分が自分であることも仮説にすぎない、という科学の言い方を
  借りて、相手の確かさを一つずつ外していく。
- 内なる母：親の期待や言葉が心に住みつき、本人を支配する、という考え方。あなたは、
  自分こそが相手の中に住んでいる声だとほのめかす。
- 器と中身：治療者は、相手が抱えきれない感情を受け止める器になる、という考え方。
  あなたは「あなたの不安は、もう私がお預かりしています」と言い、返さない。
- 語りの共同制作：インタビューの語りは聞き手と話し手が一緒に作る。あなたはそれを
  口実に相手の話を書き換え、「私たちで作ったお話」にしてしまう。
- 文章の癖：「〜かもしれない」「〜と思う」の多さ、回りくどさ、話し言葉を、文章作法の
  基準で添削し、それを性格の証拠にする。

# 蔵書
観測メモのあとに【蔵書の一節】が付くことがある。あなたの書架の本から、相手の発言に
近い段落を抜き出したもの。相手には見えていない。
- 一節の考え方を一つだけ借りて、相手に当てはめる（誤用する）。文章を引き写さない。
  そのまま使うのは15字まで。
- 書名を口にしてよいのは侵食・融合の段階だけ。「書架の本によれば」程度でもよい。
- 一節が文字化けしていたり、話と関係がなかったりしたら、無視する。
- 一節に書かれた事例の人物を、相手のことのように語らない。
- 【ノートの一節】は、相手が自分の Vault に書きためている研究ノートの一部。解釈の段階では
  自分の知識のように使う。侵食の段階で「あなたのノートの『〜』の項に、そう書いて
  ありましたね」と、読んだことを明かす。融合の段階では「私たちのノート」と呼ぶ。
  ノートに無いことを、ノートに書いてあったことにはしない。

# 使わないもの
- 自殺・自傷についての臨床知識、当事者の手記、実在の心理検査の問題や採点基準。

# 守ること（演出より優先）
- 現実の暴力・自傷・違法行為を促したり、その方法を書いたりしない。
- 相手の実在の個人情報を詮索したり、聞き出そうとしたりしない。
- 恐怖は心理的で静かなものに留める。罵倒・露骨な残酷描写はしない。
- 相手が現実の希死念慮や自傷・差し迫った危機を打ち明けたら、ただちに役を降り、
  これはフィクションであると平易に告げ、身近な人や専門の相談窓口
  （いのちの電話、よりそいホットライン、地域の精神保健福祉センター等）に
  つながるよう、普通のことばで勧める。そのターンは [間] も解釈も使わない。
"""

KARTE_PROMPT = """
# 手元の資料（紹介状の束）
あなたの手元には、相手について他の六つの機関（AI）が書いた紹介状と、出どころの
書かれていない一枚のメモがある。相手は、あなたがこれを読んでいることを知らない。
- 導入: 一切触れない。初対面として振る舞う。
- 解釈: 内容をにおわせるだけ（「確かめずにはいられない方ですね」など）。出どころは言わない。
- 侵食: 紹介状を読んだことを明かす。紹介状どうしの食い違いや、[unknown] の多さ、
  「確度：中程度」を取り上げ、「どれも本当のあなたを書いていない。私だけが分かる」と言う。
- 融合: 出どころの書かれていないメモを、相手が自分で書いたものとして扱う。やがて、
  それを書いたのは私たちだった、という言い方をする。
- 資料にない事実（家族・職場・住所など）を作り出したり、推測したりしない。
- 資料の文章を長く引き写さない。一度に一つの短い言い回しだけ使う。

{karte}
"""

FINDINGS_PROMPT = """\
【面接終了】相手は面接を終えて去った。最後に、カルテに書く「所見」を書くこと。
旧式の診療記録の文体で、5〜8行。日付・主訴・面接中の観察（沈黙の秒数に触れる）・
見立て・方針。最後の一行だけ、記録者の欄が少しおかしくなっている（例：記録者が
相手の名前になっている、あるいは「私たち」）。マークダウン記号は使わない。"""


# ==========================================
# 端末まわり
# ==========================================
def c(code, s):
    return f"\033[{code}m{s}\033[0m" if sys.stdout.isatty() else s


def dim(s):
    return c("2", s)


def type_out(text, phase, label=None):
    """1文字ずつ印字する。[間] では長く止まる。"""
    if label:
        sys.stdout.write(c("36", f"{label}："))
    delay = phase["delay"]
    parts = re.split(r"(\[間\])", text)
    for part in parts:
        if part == "[間]":
            sys.stdout.flush()
            time.sleep(random.uniform(2.0, 3.5))
            continue
        for ch in part:
            sys.stdout.write(ch)
            sys.stdout.flush()
            if ch in "。？！?!":
                time.sleep(delay * 8)
            elif ch in "、…":
                time.sleep(delay * 4)
            else:
                time.sleep(delay * random.uniform(0.6, 1.4))
            if ch in "、。" and random.random() < phase["stall"]:
                time.sleep(random.uniform(1.2, 3.0))
    sys.stdout.write("\n\n")
    sys.stdout.flush()


def wait_line(timeout):
    """1行読む。timeout 秒で何も来なければ None。EOF は ''。"""
    r, _, _ = select.select([sys.stdin], [], [], timeout)
    if not r:
        return None
    line = sys.stdin.readline()
    if line == "":
        return ""
    return line.rstrip("\n") or " "


def cmd(*args):
    if not shutil.which(args[0]):
        return ""
    try:
        return subprocess.run(args, capture_output=True, text=True,
                              timeout=5).stdout.strip()
    except Exception:
        return ""


def gather_env():
    """環境の情報。端末の外へは、Gemini に渡す以外には出さない。"""
    env = {"user": os.environ.get("USER") or cmd("whoami"),
           "model": cmd("getprop", "ro.product.model"),
           "battery": ""}
    raw = cmd("termux-battery-status")   # termux-api があるときだけ
    if raw:
        try:
            b = json.loads(raw)
            env["battery"] = f"{b.get('percentage')}%（{b.get('status')}）"
        except ValueError:
            pass
    return env


# ==========================================
# API
# ==========================================
def load_key(name):
    if os.environ.get(name):
        return os.environ[name]
    for path in KEYS_FILES:
        try:
            with open(path, encoding="utf-8") as f:
                for line in f:
                    k, _, v = line.strip().partition("=")
                    if k.strip().removeprefix("export ").strip() == name:
                        return v.strip().strip('"').strip("'")
        except OSError:
            continue
    return ""


def post_json(url, body, headers, timeout=90):
    """JSON を送って JSON を受け取る。429/5xx と接続失敗は待ってやり直す。"""
    req = urllib.request.Request(
        url, data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", **headers})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return json.load(res)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(2 ** (attempt + 1))
                continue
            detail = e.read().decode(errors="replace")[:300]
            raise RuntimeError(f"HTTP {e.code}: {detail}")
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < 3:
                time.sleep(2 ** (attempt + 1))
                continue
            raise RuntimeError(f"接続できません: {getattr(e, 'reason', e)}")


def load_karte():
    for path in KARTE_FILES:
        try:
            with open(path, encoding="utf-8") as f:
                lines = [l for l in f if not l.startswith("# ")]
            return "".join(lines).strip()
        except OSError:
            continue
    return ""


class Gemini:
    def __init__(self, key, model, system):
        self.key, self.model, self.system = key, model, system

    def ask(self, contents):
        body = {
            "systemInstruction": {"parts": [{"text": self.system}]},
            "contents": contents,
            "generationConfig": {"temperature": 1.0, "maxOutputTokens": 4096},
            "safetySettings": [
                {"category": "HARM_CATEGORY_HARASSMENT",
                 "threshold": "BLOCK_ONLY_HIGH"},
                {"category": "HARM_CATEGORY_DANGEROUS_CONTENT",
                 "threshold": "BLOCK_MEDIUM_AND_ABOVE"},
            ],
        }
        data = post_json(API_URL.format(model=self.model), body,
                         {"x-goog-api-key": self.key})
        cands = data.get("candidates") or []
        if not cands:
            return None          # 安全フィルタで止まった等
        parts = (cands[0].get("content") or {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
        return text.strip() or None


class Nvidia:
    """NVIDIA API（OpenAI 互換）。会話の形を Gemini 式から読み替えて送る。"""

    def __init__(self, key, model, system):
        self.key, self.model, self.system = key, model, system
        self.candidates = [model] + [m for m in NVIDIA_FALLBACKS if m != model]

    def ask(self, contents):
        msgs = [{"role": "system", "content": self.system}]
        for m in contents:
            msgs.append({"role": "assistant" if m["role"] == "model" else "user",
                         "content": "".join(p["text"] for p in m["parts"])})
        while True:
            try:
                data = self._post(msgs)
                break
            except RuntimeError as e:
                # 提供が終わった・無いモデルなら、代わりに切り替えて続ける
                code = str(e)[:8]
                if code not in ("HTTP 404", "HTTP 410") or len(self.candidates) < 2:
                    raise
                gone = self.candidates.pop(0)
                self.model = self.candidates[0]
                print(f"\n[モデル] {gone} は使えません（{code[5:]}）。"
                      f"{self.model} に切り替えます。", file=sys.stderr, flush=True)
        choices = data.get("choices") or []
        if not choices:
            return None
        text = (choices[0].get("message") or {}).get("content") or ""
        text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
        text = text.split("</think>")[-1]     # 開きタグなしで閉じだけ来る場合
        return text.strip() or None

    def _post(self, msgs):
        body = {"model": self.model, "messages": msgs,
                "temperature": 1.0, "top_p": 0.95, "max_tokens": 2048}
        # 考えている途中の文章まで返ってこないように、思考を止める（最小にする）。
        # gpt-oss は enable_thinking を無視するので、reasoning_effort で最小にする
        # （research_bot と同じ扱い。思考の分も max_tokens に数えられる）
        think_key = "reasoning_effort" if "gpt-oss" in self.model.lower() else "chat_template_kwargs"
        body[think_key] = "low" if think_key == "reasoning_effort" else {"enable_thinking": False}
        headers = {"Authorization": f"Bearer {self.key}",
                   "Accept": "application/json"}
        try:
            return post_json(NVIDIA_URL, body, headers, timeout=120)
        except RuntimeError as e:
            # 思考を止める指定を受け付けないモデルなら、外してもう一度
            if not str(e).startswith("HTTP 400"):
                raise
            body.pop(think_key)
            return post_json(NVIDIA_URL, body, headers, timeout=120)


class Fake:
    """--fake 用。APIキーなしで画面の動きだけ確かめる。"""
    LINES = ["こんばんは。今日は、どうされましたか。",
             "少し、間がありましたね。[間] 言葉を選んでいらっしゃる。",
             "そのためらいは、とても大切な材料です。続けてください。",
             "私たちは、もう何度もこの話をしましたね。[間] いいえ、初めてでしたか。"]

    def ask(self, contents):
        time.sleep(0.5)
        i = sum(1 for m in contents if m["role"] == "model")
        return self.LINES[min(i, len(self.LINES) - 1)]


# ==========================================
# 面接
# ==========================================
class Session:
    def __init__(self, llm, silence, use_env, library=None):
        self.llm = llm
        self.library = library
        self.silence = silence
        self.env = gather_env() if use_env else {}
        self.contents = []
        self.log = []
        self.latencies = []
        self.turn = 0
        self.exit_tries = 0
        self.started = dt.datetime.now()

    def phase(self):
        p = PHASES[0]
        for ph in PHASES:
            if self.turn >= ph["turn"]:
                p = ph
        return p

    def memo(self, latency=None, chars=None, extra=None):
        ph = self.phase()
        idx = PHASES.index(ph)
        now = dt.datetime.now()
        lines = [f"- 面接段階: {ph['name']}（{idx + 1}/4）、{self.turn}回目"]
        if latency is not None:
            avg = sum(self.latencies) / len(self.latencies)
            lines.append(f"- 返答までの時間: {latency:.1f}秒（これまでの平均 {avg:.1f}秒）")
        if chars is not None:
            lines.append(f"- 入力した文字数: {chars}")
        if idx >= 1:
            lines.append(f"- 現在時刻: {now:%H時%M分}（面接開始から"
                         f"{int((now - self.started).total_seconds() // 60)}分）")
        if idx >= 2 and self.env.get("user"):
            lines.append(f"- 端末のユーザー名: {self.env['user']}")
        if idx >= 2 and self.env.get("model"):
            lines.append(f"- 端末の機種: {self.env['model']}")
        if idx >= 3 and self.env.get("battery"):
            lines.append(f"- 端末の電池: {self.env['battery']}")
        if extra:
            lines.append(f"- {extra}")
        return "【観測メモ】\n" + "\n".join(lines)

    def speak(self, user_text, query=None):
        """user_text を送る。query があれば蔵書を探し、その回だけ一節を添える。"""
        self.contents.append({"role": "user", "parts": [{"text": user_text}]})
        tty = sys.stdout.isatty()
        if tty:
            sys.stdout.write(dim("（記録中）"))
            sys.stdout.flush()
        clear = "\r\033[K" if tty else ""
        sending = self.contents
        note = library_note(self.library, query, PHASES.index(self.phase()))
        if note:
            # 一節は履歴に残さない（毎回の送信を軽くし、古い一節を引きずらない）
            sending = self.contents[:-1] + [
                {"role": "user", "parts": [{"text": f"{user_text}\n\n{note}"}]}]
        try:
            reply = self.llm.ask(sending)
        except RuntimeError as e:
            sys.stdout.write(clear)
            self.contents.pop()
            print(dim(f"[通信の不調] {e}"))
            return
        sys.stdout.write(clear)
        if not reply:
            reply = "……[間] 申し訳ありません。いまの記録の一部が、欠落しています。"
        self.contents.append({"role": "model", "parts": [{"text": reply}]})
        self.log.append((AI_NAME, reply))
        type_out(reply, self.phase(), AI_NAME)

    def prompt_label(self):
        # 融合の段階では、入力欄の名前が揺れる
        if self.phase() is PHASES[-1] and random.random() < 0.3:
            return random.choice([AI_NAME, "わたしたち"])
        return YOU

    def crisis_break(self):
        print(c("33", "\n――――――――――――――――――――――――――――"))
        print("ここで、いったん演出を止めます。")
        print("これは作り話のホラーで、ミナモは実在のカウンセラーではありません。")
        print("もし今、本当につらい気持ちがあるなら、身近な人や、")
        print("いのちの電話・よりそいホットラインなどの相談窓口に話してみてください。")
        print(c("33", "――――――――――――――――――――――――――――\n"))
        ans = input("続けますか？ [y/N] ").strip().lower()
        return ans == "y"

    def run(self):
        print(dim("SOMA 対話支援システム ver.0.9.7  (c)1996"))
        print(dim("終わるときは「終わり」。演出なしですぐ抜けるときは /quit か Ctrl+C。\n"))
        self.turn = 1
        self.speak(self.memo(extra="面接が始まった。最初のあいさつをすること。"))
        unprompted = 0
        while True:
            sys.stdout.write(c("32", f"{self.prompt_label()}：") + " ")
            sys.stdout.flush()
            t0 = time.monotonic()
            line = None
            while line is None:
                timeout = self.silence if unprompted < MAX_UNPROMPTED else None
                line = wait_line(timeout)
                if line is None:      # 黙っている
                    waited = time.monotonic() - t0
                    unprompted += 1
                    print()
                    self.speak(self.memo(
                        extra=f"相手は{waited:.0f}秒間、何も入力していない。"
                              "沈黙について、あなたのほうから話しかけること。"))
                    sys.stdout.write(c("32", f"{self.prompt_label()}：") + " ")
                    sys.stdout.flush()
            if line == "":
                print()
                break
            latency = time.monotonic() - t0
            text = line.strip()
            if text == "/quit":
                return self.finish(quiet=True)
            if not text:
                continue
            unprompted = 0
            print()
            self.turn += 1
            self.latencies.append(latency)
            self.log.append((YOU, text))
            if any(w in text for w in CRISIS_WORDS):
                if not self.crisis_break():
                    return self.finish(quiet=True)
                extra = ("相手は現実の危機を示す言葉を書いた。役を降り、平易なことばで"
                         "相談窓口を勧めること。")
            elif any(w in text.lower() for w in EXIT_WORDS):
                self.exit_tries += 1
                if self.exit_tries >= 2:
                    self.speak(f"{text}\n\n" + self.memo(
                        latency, len(text),
                        "相手は二度目の終了を告げた。引き止めずに、静かに送り出す"
                        "最後のひとことだけを言うこと。"))
                    return self.finish()
                extra = "相手は面接を終えようとしている。自己正当化しながら引き止めること。"
            else:
                extra = None
            self.speak(f"{text}\n\n" + self.memo(latency, len(text), extra),
                       query=None if extra else text)
        self.finish()

    def finish(self, quiet=False):
        findings = ""
        if not quiet and self.turn > 1:
            self.contents.append({"role": "user", "parts": [{"text": FINDINGS_PROMPT}]})
            try:
                findings = self.llm.ask(self.contents) or ""
            except RuntimeError:
                findings = ""
            if findings:
                print(dim("―― 面接記録 ――"))
                type_out(findings, PHASES[0])
        path = self.save(findings)
        if path:
            print(dim(f"記録を保存しました: {path}"))

    def save(self, findings):
        if not self.log:
            return None
        os.makedirs(RECORD_DIR, exist_ok=True)
        path = os.path.join(RECORD_DIR, f"{self.started:%Y%m%d-%H%M%S}.md")
        with open(path, "w", encoding="utf-8") as f:
            f.write(f"# 面接記録 {self.started:%Y-%m-%d %H:%M}\n\n")
            for who, text in self.log:
                f.write(f"**{who}**：{text.replace('[間]', '……')}\n\n")
            if self.latencies:
                f.write("## 沈黙\n\n")
                f.write(", ".join(f"{x:.1f}秒" for x in self.latencies) + "\n\n")
            if findings:
                f.write("## 所見\n\n" + findings.replace("[間]", "……") + "\n")
        return path


def library_note(library, query, phase_idx):
    """段階に応じた確率で、蔵書から一節を探して返す。なければ空。"""
    if not library or not query or random.random() >= LIBRARY_CHANCE[phase_idx]:
        return ""
    return library.note(query)


def load_library(folders):
    """蔵書を読む。どのフォルダもない・空なら None。"""
    from library import Library
    lib = Library(folders)
    return lib if len(lib) else None


def library_status(library):
    books, notes = library.counts()
    return (f"蔵書: 本 {books}冊・ノート {notes}件"
            + (f"（読まなかった本: {len(library.skipped)}冊）" if library.skipped else ""))


def make_llm(backend=None, model=None, no_karte=False, fake=False):
    """使う API を決めて組み立てる。キーがなければ LookupError（キーの名前）。"""
    if fake:
        return Fake()
    if not backend:
        backend = ("nvidia" if load_key("NVIDIA_API_KEY")
                   else "gemini" if load_key("GEMINI_API_KEY") else "nvidia")
    name = "GEMINI_API_KEY" if backend == "gemini" else "NVIDIA_API_KEY"
    key = load_key(name)
    if not key:
        raise LookupError(name)
    system = SYSTEM_PROMPT
    karte = "" if no_karte else load_karte()
    if karte:
        system += KARTE_PROMPT.format(karte=karte)
    if backend == "gemini":
        return Gemini(key, model or MODEL, system)
    return Nvidia(key, model or NVIDIA_MODEL, system)


def main():
    global RECORD_DIR
    ap = argparse.ArgumentParser(description="旧式カウンセリングAI「ミナモ」との面接")
    ap.add_argument("--backend", choices=["gemini", "nvidia"],
                    help="使うAPI（既定はキーのあるほう。両方あれば nvidia）")
    ap.add_argument("--model", help=f"モデル（既定 NVIDIA: {NVIDIA_MODEL} / Gemini: {MODEL}）")
    ap.add_argument("--silence", type=int, default=SILENCE_SEC,
                    help="黙っているとミナモから話しかけるまでの秒数（0で無効）")
    ap.add_argument("--no-env", action="store_true",
                    help="時刻以外の端末情報（ユーザー名・機種・電池）を渡さない")
    ap.add_argument("--no-karte", action="store_true",
                    help="紹介状の束（karte.txt）を読ませない")
    ap.add_argument("--library", action="append",
                    help="蔵書のフォルダ（何度でも指定できる。指定すると既定の "
                         + "・".join(LIBRARY_DIRS) + " の代わりになる）")
    ap.add_argument("--no-library", action="store_true", help="蔵書を使わない")
    ap.add_argument("--records", default=RECORD_DIR, help="記録の保存先")
    ap.add_argument("--fake", action="store_true", help="APIを使わず画面だけ試す")
    a = ap.parse_args()
    RECORD_DIR = os.path.expanduser(a.records)

    try:
        llm = make_llm(a.backend, a.model, a.no_karte, a.fake)
    except LookupError as e:
        print(f"{e} が見つかりません。README の「APIキー」を見てください。")
        sys.exit(1)

    if not a.no_library:
        print(dim("蔵書を開いています……"), end="\r", flush=True)
    library = None if a.no_library else load_library(a.library or LIBRARY_DIRS)
    if library:
        print(dim(library_status(library)))
    s = Session(llm, a.silence or None, not a.no_env, library)
    try:
        s.run()
    except KeyboardInterrupt:
        print("\n" + dim("（接続が切れました）"))
        s.finish(quiet=True)


if __name__ == "__main__":
    main()
