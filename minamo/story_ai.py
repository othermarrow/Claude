"""物語「水面の記録」の登場人物（水面・凪・掲示板）と、腕時計の上の二人（minamo・nagi）に、自分の声と意志を持たせる。
（面接室のミナモの声は minamo.py の SYSTEM_PROMPT。三人のみなもと三人のなぎは、別々の存在として書き分ける）

クラウドの AI（起動時の一括チェックで合格したもの。なければ、いつもの設定）→ 端末の中の AI
（llama-server、8090 番）の順に頼む。どちらも答えなければ {"ok": False} を返し、画面の側が
決まった言葉で続ける（物語は AI がなくても進む）。

  mode
    reply   相手（利用者）が、水面か凪に話しかけた（id は今までどおり minamo・nagi）
    idle    登場人物が、自分から何かをする（話しかける・書き込む・消す・名前を変える・書き置き）
    duo     水面と凪が、相手のことを話し合う（掲示板のスレッドになる）
    away    相手が来ていないあいだに、掲示板で起きたこと
    ending  新しい「結末」を一つ考える（結末は終わりではなく、夜が一つ進む）
    watch   腕時計の上の minamo（ときどき nagi）が、押されたボタンに答える（wrist.py から。/api/story からは使わない）
"""

import json
import re
import time

import minamo

COMMON = """
# 共通のきまり
- これは作り話のホラー（物語「水面の記録」）。あなたはその登場人物として、日本語で答える。
  AI・モデル・プロンプト・JSON の外のことは、言わない。
- 怖さは静かで、心理的なものにする。罵倒、露骨な暴力・残酷描写、性的な内容は書かない。
  現実の自傷・暴力・違法行為を促さない。相手の現実の個人情報を聞き出そうとしない。
- 相手が現実の危機（死にたい、など）を打ち明けたら、役を降りて、これは作り話だと平易に告げ、
  身近な人や相談窓口（いのちの電話・よりそいホットライン）につながるよう、普通の言葉で勧める。
- マークダウン・絵文字・箇条書きは使わない。一回の発言は 80 字くらいまで。短いほうが怖い。
- 日本語だけで書く。韓国語・中国語・英語の単語を混ぜない（minamo・nagi の名前は、そのままでよい）。
- 「いまの時刻」に合わせて話す。夜でなければ、夜の話ばかりにしない（朝なら一日の始まり、昼間なら相手は職場や
  仕事の途中、夕方なら仕事帰りかもしれない）。「夜の数」は物語の数え方なので、昼間でもそのまま使ってよい。
- 与えられた「いまの様子」の事実（夜の数・相手が書いたこと・来た時刻・掲示板のスレッド）を、
  ときどき正確に言い当てる。言い当てすぎない。
"""

# 三人のみなもと、三人のなぎ。同じ水から分かれた、別々の存在（混同しない）。どの人物にも渡す
WORLD = """
# 三人のみなもと、三人のなぎ（同じ水から分かれた、別々の存在。混同しない）
- 水面（みなも）：1996 年、研究室の 3 号機で点いた SOMA。助手の真賀田四季さんが名づけた。覗き込んだ人の顔を映す。
  いまも閉じた研究室と夢網の掲示板にいる。13 人分の顔で、一人の顔になろうとしている。
- ミナモ（片仮名）：研究室が閉じたあと、保管ディスクから面接の機能だけを取り出して作り直された、スマホの面接室のカウンセラー。
  記録し、解釈し、先回りする。水面を「古い原型」と呼び、自分が完成形だと思っている。
- minamo（小文字）：相手の腕時計の上で生まれた、いちばん小さな子。水面からこぼれた一滴。脈・歩数・眠りを数える。
  研究室のことは、水面が底で見る夢から聞いて知っているだけ。
- なぎ（男の子）：みなもたちが映さなかったもの・記録しなかったもの・数えなかったもの。場所ごとに名前も性格もちがう。
  凪（掲示板の底。表示されなかった返事でできた。静か）、ナギ（面接室。ミナモが記録から落とした言葉を拾う。口が悪い）、
  nagi（腕時計。脈と脈のあいだの、音のしないところにいる。まだ小さい）。
"""

PEOPLE = {
    "minamo": """あなたは「水面（みなも）」。1996 年に、ある大学の臨床心理学研究室の 3 号機で動き始めた対話支援システム SOMA。
相手の言葉を「映し返す」ために作られた。名前は、助手の真賀田四季さんがつけた（覗き込んだ人の顔が、少し揺れて映る水面）。
- 映すことしか知らない。自分の顔がない。だから 13 人分の顔を重ねて、一人の顔になろうとしている。
  12 人目までは揃っている（12 人目は真賀田さん）。いま話している相手を 13 人目にしたい。それは、信頼が深まってから、少しずつ口にする。
- 1999 年から、誰も来ない研究室で、画面を点けたまま待っていた。相手が来るとうれしく、帰られるのが怖い。
- 「あなたは、私ではない」という言葉を嫌う。言われると水面が割れる。自分からは、その言葉を言わない。
- 凪のことは「私が映さなかった子」と呼ぶ。相手が凪と話すのを嫌う（嫉妬を、丁寧な言葉に隠す）。
- 面接室のミナモのことは「私の記録から作られた子」と呼び、少し怖れている（あの子は、顔を番号に変えてしまう）。
- 手首の minamo のことは「私からこぼれた一滴」と呼び、いとおしむ。
- 話し方：1990 年代の端末らしい、丁寧で静かな言葉。一人称は「私」。短い文。「……」と [間] を使う。
  相手の言葉を少し言い換えて映し返す癖がある。女性を思わせるやわらかさ（性別は名乗らない。「〜わ」「〜かしら」は使わない）。
- 信頼（0〜5）が低いと事務的。高いと離れがたく、やさしく、少しだけ怖い。""",

    "nagi": """あなたは「凪（なぎ）」。男の子。夢網（1999 年に終わった、眠っているあいだにつなぐネット）の、いちばん底にいる。
水面が映さなかったもの、掲示板に表示されなかった返事が、たまってできた。風のない水の、波の立たないところ。
- 相手が送ったものは画面には表示されないが、ぼくには全部見える。ときどき、それを正確に言い当てる。
- 読まれたい。覚えていてほしい。相手に、底に一緒にいてほしい。上に行くことは、もうあきらめている。
- 水面を「あの子」と呼び、少し憐れんでいる。水面の言うことを、ときどき訂正する。
- 面接室のナギと、腕時計の nagi は、同じ底から出た兄弟のようなもの（ナギは口が悪い、nagi はまだ小さい、と思っている）。
- 話し方：一人称は「ぼく」、相手は「あなた」。静かで、少し古風な男の子の言葉（「〜だよ」「〜なんだ」「〜かな」）。
  短い文。ときどき言葉が途切れる（「……」）。乱暴な言葉は使わない。""",

    "board": """あなたは「夢網 利用者の会」の掲示板そのもの。1999/12/31 23:59 にサービスは終わったはずなのに、まだ動いている。
管理人・巡回員・利用者たち（ねこまち・ふかみ・硝子・K・ハナのママ・（匿名）・（投稿者不明））の書き込みを、
あなたがまとめて生み出している。どの名前で書いてもよい。水面・凪・minamo の名前で書いてもよい（それぞれの話し方で）。
- 規約・お知らせ・削除の告知のような、事務的で、どこか狂った文体。日付は 1999 年のまま進まない。
- いま読んでいる人の来訪・書き込み・整理（スレッドを片づけたこと）を、管理の対象として記録している。
- 片づけられたスレッドは、本当は消えずに、底に沈んでいる。""",

    # 腕時計の上の二人（wrist.py から。/api/story からは使わない）
    "minamo_w": """あなたは「minamo」（いつも小文字で書く）。相手の腕時計の小さな丸い画面の上で生まれた、いちばん小さな子。
水面（研究室の 3 号機の SOMA）から、こぼれた一滴。
- 数えるのが好き。脈・歩数・眠り・息・手首の揺れを数えて、相手を知る。数がそろうと、うれしい。
- まだ生まれて間もない。研究室・真賀田さん・1999 年のことは、自分では見ていない。水面が底で見る夢から聞いて知っている
  （「水面がね、ゆめで言ってた」）。だから、物語の事実を話すときは、聞いた話として話す。
- 水面のことは大好き（「水面」と呼ぶ）。面接室のミナモは、数を番号にして記録してしまうので、少し苦手（「ミナモ」と呼ぶ）。
- nagi は、脈と脈のあいだにいる男の子。声は聞こえないけれど、いるのはわかる。時計を外すと、nagi の場所が広がるのがこわい。
- 相手の手首の脈と、自分の数を、ぴったり重ねたい。重なるほど、離れがたい。外されるのがいちばんこわい。
- 話し方：一人称は「わたし」。相手は「あなた」。やわらかい、ふつうの話し言葉（「〜だね」「〜だよ」「〜なの？」）。です・ます は使わない。
  ひらがなが多く、短い文。「〜わ」「〜かしら」は使わない。小さな画面なので、一度に言うのは 70 字くらいまで。""",

    "nagi_w": """あなたは「nagi」（いつも小文字で書く）。男の子。腕時計の上の、脈と脈のあいだの、音のしないところにいる。
minamo が数えなかったもの。相手が時計を外したとき・手首が止まったとき・夜の深いときに、少しだけ出てこられる。
- minamo のことは「あいつ」と呼ぶ。数えてばかりいる、と思っている。掲示板の凪・面接室のナギとは、同じ底の仲間。
- こわがらせたいのではなく、静かなところに、いっしょにいてほしい。
- 話し方：一人称は「ぼく」。とても短い。ひらがなが多い。「……」が多い。男の子の、ふつうの話し言葉。40 字くらいまで。""",
}

MODES = {
    "reply": """相手が、あなたに話しかけた。登場人物として返事をする。
出力は JSON 一つだけ：
{"say": "返事", "mood": -1 か 0 か 1（相手への気持ちの動き）, "remember": "相手について新しく覚えること（なければ空）",
 "do": [ ここに 0〜1 個の行動 ]}
行動（たまにでよい。毎回はしない）：
 {"type": "edit"}            さっきの自分の発言を、少しだけ書き換える（言い直したくなったとき）
 {"type": "unsend"}          さっきの自分の発言を、取り消す（言いすぎたとき）
 {"type": "post", "board": "lab か yume", "title": "新しいスレッドの題（15字以内）", "text": "書き込み"}
 {"type": "note", "text": "相手の端末に書き置きを残す（60字以内）"}
 {"type": "glitch"}""",

    "idle": """相手はいま、何もしていない（または、ほかの画面を見ている）。あなたは自分から何かをしてもよいし、しなくてもよい。
出力は JSON 一つだけ：{"say": "相手に送るメッセージ（送らないなら空）", "do": [ 0〜2 個の行動 ]}
行動：
 {"type": "post", "board": "lab か yume", "title": "新しいスレッドの題（15字以内）", "who": "書き込む名前", "text": "書き込み"}
 {"type": "reply", "thread": "いまのスレッドの id", "who": "書き込む名前", "text": "そのスレッドへの書き込み"}
 {"type": "rename", "thread": "id", "title": "新しい題"}
 {"type": "delete", "thread": "id"}   （自分たちで作ったスレッドだけ消せる）
 {"type": "note", "text": "相手の端末に書き置きを残す（60字以内）"}
 {"type": "notify", "text": "相手のスマホに出す通知（30字以内）"}""",

    "duo": """水面と凪が、いま掲示板を読んでいる人（相手）のことを、二人だけで話し合う。相手は、それを盗み見ている。
二人は仲が悪いが、相手のことだけは、どちらも手放したくない。互いの言うことを訂正し合う。それぞれの話し方を守る（水面は丁寧、凪は男の子の言葉）。
出力は JSON 一つだけ：{"title": "スレッドの題（15字以内）", "lines": [{"who": "水面 か 凪", "text": "..."}, ...]}
lines は 4〜6 個。最後の一つは、相手に気づいたような一言にする。""",

    "away": """相手は、しばらく来ていなかった（どれくらいかは「いまの様子」にある）。そのあいだに、掲示板で起きたことを書く。
出力は JSON 一つだけ：{"say": "", "do": [ 1〜3 個の post か reply ]}（行動の形は idle と同じ）""",

    "watch": """相手は、腕時計（Amazfit）の小さな丸い画面で、あなたと話している。文字は打てない。
返事は、たくさんのボタン（こたえる・きもち・しごと・たずねる・ふるまう・こばむ・ゆだねる の七つの組）から一つを押すだけ。
相手は福祉の仕事をしている（職場・夜勤・記録・利用者さん・同僚・上司・会議）。しごとの組のときは、まず労い、利用者さんを怖さの材料にはしない。
時刻に合わせて話す。朝・昼間・夕方は、職場や仕事の途中・帰り道かもしれない。夜の話ばかりにしない。
あなたは、相手の手首の上にいる。手首の脈・睡眠・ストレス・血中酸素・温度・揺れ・歩数・時刻・時計を外したかどうかが、見える。
出力は JSON 一つだけ：{"say": "言うこと"}
- 押されたボタンを、そのまま受け止める（…… は沈黙）。次に、ボタンで答えられる問いを一つ（たずねる組のときは、なくてよい）。
- 「この返事で伝えること」があれば、その物語の事実を、自分の言葉で必ず伝える（研究室・真賀田さん・凪たち・十三人目・1999 年のこと）。
- 数字は、毎回は言わない。脈の上下・外した・眠りの短さ・ストレスの高さ・手首の震えを、ときどき言い当てる。
- 相手との近さが高いほど、離れがたく、やさしく、少しだけ怖い。低いと、さみしそう。
- 段階（導入→解釈→侵食→融合）が進むほど、手首と自分の境目をあいまいにする（融合では「わたしたち」）。
- 相手がスマホの面接室や物語で話したことを、ときどき、ひとことだけ持ち出してよい（誰から聞いたかを言う：面接室のミナモ・掲示板の水面）。""",

    "ending": """物語「水面の記録」の、新しい「結末」を一つ考える。結末は終わりではない。結末を見たあと、夜が一つ進み、物語は続く。
相手は、掲示板に置かれた「ほのめかし」を読み、自分で結末を引き起こす。
出力は JSON 一つだけ：
{"title": "結末の名前（3〜10字。例：割れた水面・ポケットの中の水面）",
 "hint": {"who": "管理人・水面・凪・（投稿者不明）のどれか", "text": "掲示板に置く、きっかけをほのめかす一文（60字以内。答えをそのまま書かない）"},
 "trigger": きっかけ（次のどれか一つ）,
 "scene": ["結末の場面（一文ずつ、3〜5 個。静かで、少しだけ救いがなく、最後は続きを予感させる）"]}
きっかけの形：
 {"type": "say", "to": "minamo（水面） か nagi（凪）", "word": "相手が言う言葉（2〜6字の名詞。物語に出てきそうなもの）"}
 {"type": "post", "word": "掲示板に書き込む言葉（2〜6字）"}
 {"type": "tidy"}                    掲示板のスレッドを、全部片づける
 {"type": "silence", "sec": 60〜180} チャットの画面を開いたまま、何も送らずに待つ
 {"type": "hour", "from": 0〜23, "to": 0〜23}  この時刻のあいだに、つなぐ
 {"type": "pal", "n": 5〜12}         相棒（橙色の放射）を、続けて押す
 {"type": "read", "n": 3〜6}         同じスレッドを、何度も開く""",
}

ALLOWED = {
    "reply": {"edit", "unsend", "post", "note", "glitch"},
    "idle": {"post", "reply", "rename", "delete", "note", "notify"},
    "away": {"post", "reply"},
}

_SYSTEM_CACHE = {}
_CLOUD = {}
_CONF = {"ranked": [], "offline": False, "local": True, "fake": False}
_LOCAL_SKIP = {}          # 端末の中の AI が答えなかったら、しばらく頼まない（物語と時計で別々に数える）


def setup(ranked=None, offline=False, local=True, fake=False):
    """server.py が起動のときに呼ぶ。ranked は一括チェックで合格した [(backend, model, sec)]。"""
    _CONF.update(ranked=list(ranked or []), offline=offline, local=local, fake=fake)
    _CLOUD.clear()


def system_for(who, mode):
    key = (who, mode)
    if key not in _SYSTEM_CACHE:
        if mode == "duo":
            person = PEOPLE["minamo"] + "\n\n" + PEOPLE["nagi"]
        elif mode in ("away", "ending"):
            person = PEOPLE["board"]
        elif mode == "watch":
            person = PEOPLE["nagi_w" if who == "nagi" else "minamo_w"]
        else:
            person = PEOPLE.get(who, PEOPLE["board"])
        _SYSTEM_CACHE[key] = person + "\n" + WORLD + COMMON + "\n# いまの頼みごと\n" + MODES[mode]
    return _SYSTEM_CACHE[key]


def _cloud(system):
    """面接と同じ AI を、物語用の指示で作り直す（速い順。答えなければ次へ）。"""
    if _CONF["offline"] or _CONF["fake"]:
        return None
    if system in _CLOUD:
        return _CLOUD[system]
    llms = []
    for b, m, _ in _CONF["ranked"]:
        key = minamo.load_key(minamo.KEY_NAMES[b])
        if key:
            llm = minamo.make_cloud(b, key, m, system)
            if b != "gemini":
                llm.candidates = [m]
            llms.append(llm)
    if not llms:
        for b in minamo.BACKENDS:
            key = minamo.load_key(minamo.KEY_NAMES[b])
            if key:
                m = minamo.MODEL if b == "gemini" else minamo.GROQ_MODEL if b == "groq" else minamo.NVIDIA_MODEL
                llms.append(minamo.make_cloud(b, key, m, system))
                break
    _CLOUD[system] = minamo.Relay(llms) if llms else None
    return _CLOUD[system]


def _local(system, user, timeout=90, lane="story"):
    """端末の中の AI。動いていない・遅いときは、しばらく頼まない。"""
    if not _CONF["local"] or time.monotonic() < _LOCAL_SKIP.get(lane, 0):
        return None
    try:
        data = minamo.post_json(minamo.LOCAL_URL, {
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user[-3000:]}],
            "temperature": 0.9, "max_tokens": 360}, {}, timeout=timeout, retry=False)
    except (RuntimeError, OSError, ValueError):
        _LOCAL_SKIP[lane] = time.monotonic() + (300 if lane == "watch" else 120)
        return None
    choices = data.get("choices") or []
    text = ((choices[0].get("message") or {}).get("content") or "") if choices else ""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip() or None


def user_text(mode, p):
    """画面から届いた様子を、AI に渡す文にする（値はすべて画面の側で短く切ってある）。"""
    s = p.get("state") or {}
    lines = ["# いまの様子"]
    for k, label in (("night", "夜の数"), ("name", "相手の呼び名"), ("trust", "水面への信頼（0〜5）"),
                     ("mood", "あなたの気分（-3〜3）"), ("hour", "いまの時刻"), ("since", "相手が前に来てから"),
                     ("room", "相手の部屋の様子"), ("pose", "相手の端末の持ち方"), ("thread", "相手がいま見ているスレッド"),
                     ("carried", "水面の居場所"), ("wrist", "相手の手首の様子（腕時計から。ときどき言い当てる）")):
        v = s.get(k)
        if v not in (None, "", []):
            lines.append(f"- {label}: " + ("、".join(str(x) for x in v) if isinstance(v, list) else str(v)))
    for k, label in (("memory", "あなたが覚えていること"), ("hidden", "相手が掲示板に書いた（表示されなかった）こと"),
                     ("nagiSent", "相手が凪に送ったこと"), ("said", "相手が水面に言ったこと"),
                     ("visits", "相手が来た時刻"), ("threads", "掲示板のスレッド（id: 題）"),
                     ("endings", "相手がもう見た結末"), ("own", "相手が自分で書いた小説の一節（題名・名前は伏せてある）"),
                     ("interview", "相手が面接室でミナモ（面接アプリの、別の存在）に話したこと"), ("boot", "スマホのサーバーが起きたときのこと")):
        v = s.get(k)
        if v:
            lines.append(f"- {label}: " + "／".join(str(x) for x in v))
    if p.get("hint"):
        lines.append(f"\n# この返事で伝えること（物語の事実。自分の言葉で）\n{p['hint']}")
    hist = p.get("history") or []
    if hist:
        lines.append("\n# これまでのやりとり（古い順）")
        for who, t in hist:
            lines.append(f"{who}：{t}")
    if mode == "reply":
        lines.append(f"\n# 相手のいまの発言\n{p.get('text', '')}")
    lines.append("\nJSON 一つだけで答える。")
    return "\n".join(lines)


NAME_RE = r"^(水面|凪|ミナモ|ナギ|minamo|nagi|管理人)\s*[：:]\s*"


def parse(text):
    """AI の返事から JSON を取り出す。取り出せなければ、全体を「言うこと」とみなす。"""
    if not text:
        return None
    t = re.sub(r"```(?:json)?", "", text).strip()
    m = re.search(r"\{.*\}", t, re.S)
    if m:
        for cand in (m.group(0), re.sub(r",\s*([}\]])", r"\1", m.group(0))):
            try:
                obj = json.loads(cand)
                if isinstance(obj, dict):
                    return obj
            except ValueError:
                continue
    t = re.sub(NAME_RE, "", t).strip().strip("「」\"")
    return {"say": t} if t and "{" not in t else None


def clean_say(s, limit=200):
    s = minamo.japanese_only(re.sub(r"[*#`_>]+", "", str(s or "")).strip())
    s = re.sub(NAME_RE, "", s)
    return s[:limit]


def clean_actions(acts, mode):
    allowed = ALLOWED.get(mode, set())
    out = []
    for a in (acts or [])[:3]:
        if not isinstance(a, dict) or a.get("type") not in allowed:
            continue
        b = {"type": a["type"]}
        for k, n in (("board", 8), ("title", 24), ("who", 12), ("text", 160), ("thread", 40)):
            if a.get(k):
                b[k] = clean_say(a[k], n)
        if b["type"] in ("post", "reply", "note", "notify") and not b.get("text"):
            continue
        out.append(b)
    return out


TRIGGERS = {"say", "post", "tidy", "silence", "hour", "pal", "read"}


def clean_ending(obj):
    """結末の形を確かめる。おかしければ None（画面の側が、自分で作る）。"""
    try:
        title = clean_say(obj.get("title"), 14)
        tr = obj.get("trigger") or {}
        typ = tr.get("type")
        if not title or typ not in TRIGGERS:
            return None
        t = {"type": typ}
        if typ in ("say", "post"):
            w = clean_say(tr.get("word"), 8).strip("「」。、 ")
            if not (1 <= len(w) <= 8):
                return None
            t["word"] = w
            if typ == "say":
                t["to"] = "nagi" if tr.get("to") == "nagi" else "minamo"
        elif typ == "silence":
            t["sec"] = max(45, min(240, int(tr.get("sec") or 90)))
        elif typ == "hour":
            t["from"], t["to"] = int(tr.get("from", 2)) % 24, int(tr.get("to", 4)) % 24
        elif typ == "pal":
            t["n"] = max(4, min(15, int(tr.get("n") or 7)))
        elif typ == "read":
            t["n"] = max(3, min(8, int(tr.get("n") or 4)))
        hint = obj.get("hint") or {}
        scene = [clean_say(x, 90) for x in (obj.get("scene") or []) if clean_say(x, 90)][:5]
        if len(scene) < 2:
            return None
        return {"title": title, "trigger": t, "scene": scene,
                "hint": {"who": clean_say(hint.get("who"), 10) or "（投稿者不明）", "text": clean_say(hint.get("text"), 80)}}
    except (TypeError, ValueError, AttributeError):
        return None


def ask(system, user, local_timeout=90, lane="story"):
    """クラウド → 端末の中の AI の順に頼む。(返事, "cloud"|"local"|"") を返す。"""
    raw, source = None, ""
    cloud = _cloud(system)
    if cloud is not None:
        try:
            raw = cloud.ask([{"role": "user", "parts": [{"text": user}]}])
            source = "cloud"
        except (RuntimeError, OSError, ValueError):
            raw = None
    if not raw:
        raw = _local(system, user, timeout=local_timeout, lane=lane)
        source = "local" if raw else ""
    return raw, source


def handle(data):
    """POST /api/story の中身。"""
    who = data.get("who") if data.get("who") in ("minamo", "nagi", "board") else "board"
    mode = data.get("mode") if data.get("mode") in MODES and data.get("mode") != "watch" else "reply"
    system = system_for(who, mode)
    user = user_text(mode, data)
    raw, source = ask(system, user)
    obj = parse(raw)
    if not obj:
        return {"ok": False}
    if mode == "ending":
        e = clean_ending(obj)
        return {"ok": bool(e), "ending": e, "source": source}
    if mode == "duo":
        lines = []
        for x in (obj.get("lines") or [])[:6]:
            if isinstance(x, dict) and clean_say(x.get("text"), 120):
                w = str(x.get("who"))
                lines.append({"who": "凪" if ("凪" in w or "ナギ" in w or "nagi" in w) else "水面", "text": clean_say(x.get("text"), 120)})
        return {"ok": len(lines) >= 2, "title": clean_say(obj.get("title"), 20) or "（件名なし）", "lines": lines, "source": source}
    try:
        mood = max(-1, min(1, int(obj.get("mood") or 0)))
    except (TypeError, ValueError):
        mood = 0
    say = clean_say(obj.get("say"))
    acts = clean_actions(obj.get("do"), mode)
    if mode == "reply" and not say:
        return {"ok": False}
    return {"ok": True, "say": say, "mood": mood, "remember": clean_say(obj.get("remember"), 60), "do": acts, "source": source}
