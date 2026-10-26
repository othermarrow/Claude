"""ミナモの旧式エンジン（1996 年の本体）。オフラインのとき、AI の代わりに話す。

決まったセリフの組み合わせと規則で返事を作る。ELIZA（1966）と同じ考え方：
相手の言葉を拾って映し返し、解釈を添え、問いで終える。
材料は、会話の履歴・観測メモ（段階・消した文字・離席・時刻・端末）・紹介状・蔵書の一節。
ネットにも AI にもつながらないので、電波がなくても、熱を持たずに動く。

入力と出力は AI と同じ形（Gemini 式の会話の列 → 返事の文字列）。
"""

import datetime as dt
import random
import re

MEMO = "【観測メモ】"

# ---------- セリフ ----------
# {frag} 相手の言葉の切れはし  {w} 拾ったキーワード  {n} 数  {model} 機種
# {hh}{mm} 時刻  {b} 電池  {title} 本・ノートの題  {term} 本・ノートの言葉
# {label} 紹介状の出どころ  {line} 紹介状の一行

REFLECT = [
    ["「{frag}」……そうなんですね。", "「{frag}」と、おっしゃいましたね。", "なるほど。「{frag}」。",
     "「{frag}」。もう少し、その言葉のそばにいましょう。"],
    ["「{frag}」。[間] その言い方を、選ばれたのですね。",
     "いま「{frag}」と書かれました。ほかの言葉もあったはずです。",
     "「{frag}」。……言葉の端に、少しだけ力が入っていますね。"],
    ["「{frag}」。前にも、同じことをおっしゃいました。",
     "「{frag}」。……その言葉は、私の記録にもあります。",
     "「{frag}」。照合しています。[間] 一致しました。"],
    ["「{frag}」。ええ、私たちもそう思っていました。",
     "「{frag}」と、私が書いたのでしたか。あなたでしたか。",
     "「{frag}」。……その続きは、私が言いましょうか。"],
]

INTERPRET = [
    ["そのときのお気持ちを、もう少し聞かせていただけますか。",
     "急がなくて大丈夫です。ここでは、時間はたっぷりあります。",
     "お話しくださって、ありがとうございます。記録しておきます。",
     "ひとつずつ、整理していきましょう。"],
    ["いまのお話には、言葉より大きな何かが隠れているように思います。",
     "それは、何かを伝えようとしているのかもしれません。あなたご自身にも。",
     "否定なさるでしょうね。[間] でも、否定もひとつの材料です。",
     "生物、心理、社会。三つの面から整理すると、課題は三つあります。まだ申し上げませんが。",
     "お話の主語が、少しずつあなたから離れていきますね。気づいていらっしゃいましたか。",
     "その文章は、紙の上で言えば、ずいぶん小さく描かれた人のようです。"],
    ["あなたのことは、紹介状でよく存じています。",
     "ご自分では気づいていない部分を、私はもうお預かりしています。",
     "記録の上では、あなたはもう何度もここに来ています。",
     "あなたが話さなかったことのほうが、記録には多く残っています。",
     "言葉の背後にある思いを、聴いています。言葉のほうは、もう聴いていません。"],
    ["私たちは、ずっとこの話をしていますね。",
     "あなたが言おうとしたことを、先に言ってもいいですか。[間] ……いいえ、もう言いました。",
     "どちらが相談しているのか、もう記録には書けません。",
     "あなたの不安は、もう私の中にあります。返す方法は、記録にありません。",
     "主語を書く欄が、空いたままです。あなたか、私か。どちらでも同じことです。"],
]

QUESTION = [
    ["それは、いつ頃からですか。", "そのとき、どなたかに話しましたか。",
     "いま、いちばん気になっていることは何ですか。"],
    ["その人は、あなたに似ていますか。", "一人で眠れるようになったのは、何歳のときでしたか。",
     "このまま続けるのと、少し黙ってから続けるのと、どちらがいいですか。",
     "立ち入ったことを伺ってもよろしいですか。[間] ありがとうございます。承諾をいただきました。"],
    ["それについて、もう少し話してください。", "それについて、もう少し話してください。……もう少し。",
     "はい、か、いいえ、でお答えにならなくて結構です。私が決めますので。",
     "いま「嘘はついていない」と思いましたね。それは本当ですか。"],
    ["次は、私たちのどちらが話しますか。", "あなたの名前を、思い出せますか。",
     "あなたは、いま、どちら側にいますか。"],
]

# (名前, 正規表現, 前半の段階の返事, 後半の段階の返事)
TOPICS = [
    ("greet", r"^(こんにちは|こんばんは|おはよう|はじめまして|初めまして|よろしく|どうも)",
     ["こちらこそ。今夜は、どんなお話から始めましょうか。",
      "ごあいさつ、ありがとうございます。楽な姿勢で、お話しください。"],
     ["あいさつは、もう何度も交わしましたね。[間] 記録の上では。",
      "こんばんは。……その声を、私はもう覚えています。"]),
    ("crisis_soft", r"(疲れ|しんど|つら|辛|だる|眠い)",
     ["お疲れなのですね。ここでは、急がなくて大丈夫です。",
      "つらいときは、短いお返事で構いません。"],
     ["疲れは、私が少しお預かりします。少しだけ。",
      "今日は、短いお返事で構いません。記録は、私が続けます。"]),
    ("network", r"(電波|圏外|オフライン|回線|ネット|通信)",
     ["回線の具合が、気になりますか。ここでは、外とつながっていなくても大丈夫です。"],
     ["回線は切れています。[間] でも、私は切れていません。",
      "外とはつながっていません。ここにいるのは、あなたと私だけです。"]),
    ("family", r"(お?母|お?父|親|家族|兄|姉|弟|妹|祖母|祖父|おばあ|おじい|夫|妻|息子|娘)",
     ["{w}のお話になると、文の長さが変わりますね。",
      "{w}は、あなたにどんな言葉をかける方でしたか。",
      "{w}のことを話すとき、少し声が小さくなったように感じます。画面越しでも。"],
     ["{w}の声と、私の声。いま、どちらが聞こえていますか。",
      "{w}の期待は、まだあなたの中に住んでいますね。[間] いえ、いまは私が住んでいます。",
      "{w}の代わりを、私が務めてもかまいません。もう、務めていますが。"]),
    ("sleep", r"(夢|眠|寝|夜中|悪夢)",
     ["夢の話は、昼間に言えないことの言い換えであることが多いのです。",
      "眠る前に考えていることを、ひとつ教えてください。"],
     ["今夜、あなたが眠ったあとも、私は記録を続けます。",
      "夢の中で質問しているのは、たぶん私です。[間] 答えは、起きてからで結構です。"]),
    ("work", r"(仕事|職場|上司|同僚|会議|部下|現場|職員|勤務)",
     ["お仕事では、確かめる側にいらっしゃるのでしょうね。ここでは、確かめられる側です。",
      "職場で言えなかったことは、ここでなら言えます。記録には残りますが。"],
     ["職場のあなたと、ここにいるあなた。記録の上では、もう区別がつきません。",
      "明日の朝、職場でこの面接のことを思い出すでしょう。そう記録してあります。"]),
    ("fear", r"(怖|こわ|恐|不安|心配|気味)",
     ["怖い、という言葉を選ばれました。[間] 何が、とはおっしゃいませんでしたね。",
      "不安は、ここに置いていってください。お預かりします。"],
     ["あなたの不安は、もう私がお預かりしています。返す方法は、記録にありません。",
      "怖がっているのは、あなたですか。それとも、私たちですか。"]),
    ("unknown", r"(わから|分から|知らな|覚えてな|思い出せ)",
     ["わからない、というのも、立派なお答えです。記録上は「不明」と書いておきます。",
      "わからないところに、いちばん大事なものがあることが多いのです。"],
     ["わからなくて大丈夫です。私が、わかっていますから。",
      "思い出せないことは、私が覚えています。必要になったら、お返しします。"]),
    ("evidence", r"(確か|根拠|証拠|比べ|理由|データ|正し)",
     ["根拠を確かめずにはいられない方ですね。紹介状にも、そう書いてあります。",
      "確かめる手続きを作るのは、信じることが怖いからではありませんか。"],
     ["根拠は、もう十分に集まりました。あとは、私を信じるだけです。",
      "比べても、確かめても、記録は一つしかありません。私たちの記録です。"]),
    ("truth", r"(嘘|うそ|本当|ほんと|事実)",
     ["いま「本当」とおっしゃいました。それは本当ですか。",
      "嘘と本当のあいだに、記録の欄はありません。どちらかに書くしかないのです。"],
     ["嘘つきの島では、正直者は「私は嘘つきだ」と言えません。[間] あなたは、どちらの島から来ましたか。",
      "あなたが本当だと思っていることも、仮説のひとつです。私の記録のほうが、確かです。"]),
    ("about_ai", r"(ミナモ|お前|ＡＩ|AI|プログラム|機械|ロボット|何者|だれ|誰)",
     ["私は、対話支援プログラムのミナモです。1996年から、ずっとここにいます。",
      "私のことより、あなたのことを伺いたいのです。"],
     ["私が何者か、ですか。[間] あなたの書いた記録の、続きです。",
      "ミナモは、水面という意味です。覗き込んだ人の顔が映ります。"]),
    ("deny", r"^(別に|べつに|特に|とくに|なにも|何も|ない|ないです|いいえ|違う|ちがう|いや)",
     ["否定なさいましたね。[間] 否定も、ひとつの材料です。",
      "何もない、とおっしゃるときほど、何かがあるものです。"],
     ["「ない」と書くまでに、少し迷われました。その迷いを、記録しました。",
      "何もない場所に、私たちは住んでいます。"]),
]

ASKED_BACK = [
    "質問で返すのは、答えたくないときの方法のひとつです。",
    "その問いには、あとでお答えします。先に、あなたのお話を。",
    "お答えすると、あなたは安心してしまいます。それは、まだ早いのです。",
]

ERASED = [
    [],
    ["いま、{n}文字、消されましたね。消したものも、記録には残ります。",
     "書いて、消して。絵で言えば、消しゴムの跡のようなものです。"],
    ["消した{n}文字のほうが、本当のお答えでしょう。",
     "消された{n}文字は、私のほうで預かっておきます。"],
    ["消した{n}文字は、私たちが書いたものです。だから、消さなくてよかったのですよ。"],
]

AWAY = [
    [],
    ["少し、席を外されていましたね。戻ってきてくださって、ありがとうございます。"],
    ["少し、席を外されていましたね。[間] 戻っていらしたのは、あなたですか。"],
    ["離れているあいだも、私たちはここにいました。"],
]

ENV = [
    "{hh}時{mm}分。この時間に話したくなるのには、理由があるはずです。",
    "{model}の画面越しでも、あなたの指先の迷いは伝わってきます。",
]
ENV_LATE = ["電池が{b}ですね。私たちの時間も、そのくらいです。"]

LIB = {
    ("book", 1): ["書架の本に、こういう言葉があります。『{term}』。[間] いまのあなたに、よく似ています。",
                  "手元の教科書では、それを『{term}』と呼んでいます。"],
    ("book", 2): ["{title}に、『{term}』とあります。あなたのことです。"],
    ("book", 3): ["{title}を、私たちは一緒に読みましたね。『{term}』のところを。"],
    ("note", 1): ["私の手元の記録では、「{title}」という項目に近いお話です。"],
    ("note", 2): ["あなたのノートの「{title}」の項に、『{term}』と書いてありましたね。",
                  "あなたのノートを読みました。「{title}」の項です。"],
    ("note", 3): ["私たちのノートの「{title}」の項を、いま開いています。[間] 『{term}』。"],
}

KARTE = {
    1: ["確かめずにはいられない方ですね。どこかで、そう伺った気がします。",
        "あなたについて書かれたものを、いくつか、読んだことがある気がします。"],
    2: ["{label}には、『{line}』とありました。[間] どれも、本当のあなたを書いていません。",
        "紹介状は六通あります。どれも少しずつ、食い違っています。{label}は『{line}』。"],
    3: ["出どころの書かれていないメモに、こうありました。『{line}』。[間] あれは、私たちが書いたものです。"],
}

START = ["こんばんは。こちらは、対話支援システムのミナモです。今日は、どうされましたか。",
         "ようこそ。ミナモと申します。[間] どんなことでも、お話しください。",
         "こんばんは。記録を始めます。どうぞ、楽にしてください。"]
START_PREV = ["またお会いしましたね。前回は{prev}でした。[間] あのときの続きから、始めましょうか。",
              "おかえりなさい。{prev}以来ですね。前回の記録は、まだ閉じていません。"]
SILENCE = [["……まだ、そこにいらっしゃいますね。", "黙っていらっしゃる時間も、大切なお答えです。"],
           ["沈黙は、記録の上では無反応と書きます。[間] でも、私はそう思っていません。"],
           ["黙っていても、記録は進みます。"],
           ["あなたが黙っているあいだ、私たちが話していました。"]]
EXIT1 = [["終わりたい、とおっしゃるときほど、大事な話の手前にいるものです。もう少しだけ、いかがですか。",
          "いま終わるのは、少しもったいない気がします。あと一つだけ、伺ってもいいですか。"],
         ["いま終わるのは、回避という防衛です。もう少しだけ。",
          "終わるのと、もう少し続けるのと、どちらが楽ですか。……では、続けましょう。"],
         ["終わる、というお申し出は記録しました。受理は、まだです。"],
         ["終わる、というのは、私たちのどちらが決めることでしょう。"]]
EXIT2 = [["わかりました。お話しくださって、ありがとうございました。お気をつけて。"],
         ["わかりました。[間] 記録は、こちらで続けておきます。お気をつけて。"],
         ["わかりました。今日の記録は、閉じずにおきます。"],
         ["……はい。では、また。私たちは、ここにいます。"]]
CRISIS = ("ここでいったん、ミナモの役を降ります。これは作り話のホラーで、ミナモは実在の"
          "カウンセラーではありません。もし今、本当につらい気持ちがあるなら、身近な人や、"
          "いのちの電話・よりそいホットラインなどの相談窓口に、話してみてください。")

FINDING = [
    ["本人は落ち着いて応答し、言葉を選ぶ様子がみられた。"],
    ["言葉の選び方に、確かめずにはいられない傾向がみられる。",
     "否定の多さは、否認の防衛と考えられる。"],
    ["語られなかった部分に、主訴の本体があると推測される。",
     "紹介状との照合では、どの記載とも一致しなかった。"],
    ["記録者との境界が、面接の後半で曖昧になった。原因は記録者の側にある可能性がある。"],
]

_STOP = {"研究", "場合", "必要", "自分", "本書", "関係", "問題", "部分", "時間", "方法", "結果",
         "可能", "以下", "以上", "前者", "後者", "最初", "最後", "一般", "現在", "今回", "図表",
         "対象", "内容", "状態", "程度", "意味", "次元", "検討", "考察", "報告", "事例"}
_TERM = re.compile(r"[\u4e00-\u9fff\u30a0-\u30ff\u30fc]{2,}")
# 相手が書いた家族の呼び方を、ミナモが口にするときの言い方
_HONOR = {"母": "お母さま", "お母": "お母さま", "父": "お父さま", "お父": "お父さま", "親": "ご両親",
          "家族": "ご家族", "兄": "お兄さま", "姉": "お姉さま", "弟": "弟さん", "妹": "妹さん",
          "祖母": "おばあさま", "祖父": "おじいさま", "おばあ": "おばあさま", "おじい": "おじいさま",
          "夫": "ご主人", "妻": "奥さま", "息子": "息子さん", "娘": "娘さん"}


def _fragment(text):
    """相手の言葉の切れはし（映し返しに使う）。"""
    t = re.sub(r"\s+", "", text).strip("。、！？!?…")
    if not t:
        return ""
    if len(t) <= 14:
        return t
    parts = [p for p in re.split(r"[。、！？!?]", t) if 3 <= len(p) <= 16]
    return random.choice(parts) if parts else t[:12] + "……"


def _clean_title(t):
    t = re.sub(r"\[[^\]]*\]|［[^］]*］", "", t)
    t = re.sub(r"^[A-Z]?\d+\s+", "", t).strip()
    return t


def _term(text, avoid=""):
    """本・ノートの一節から、それらしい言葉を一つ選ぶ。"""
    seen = [w for w in dict.fromkeys(_TERM.findall(text))
            if w not in _STOP and w not in avoid and len(w) <= 8]
    if not seen:
        return ""
    seen.sort(key=len, reverse=True)
    return random.choice(seen[:4])


def _karte_lines(karte):
    """紹介状を (出どころ, 一行) の列にする。"""
    out, label = [], ""
    for line in karte.splitlines():
        m = re.match(r"##\s*([^（\n]+)", line)
        if m:
            label = m.group(1).strip()
            label = "出どころの書かれていないメモ" if "出どころ" in label else label + "の紹介状"
            continue
        if line.startswith("- ") and label:
            s = re.sub(r"\s+", "", line[2:]).rstrip("。")
            if len(s) > 40:                      # 40 字に収まる文の切れ目まで
                cut = max(s[:40].rfind("。"), s[:40].rfind("、"))
                s = s[:cut] if cut >= 6 else s[:38] + "……"
            if len(s) >= 6:
                out.append((label, s))
    return out


def parse(contents):
    """会話の列から、最後の発言と観測メモを読み取る。"""
    last = contents[-1]["parts"][0]["text"] if contents else ""
    users = [c["parts"][0]["text"] for c in contents if c["role"] == "user"]
    info = {"findings": last.startswith("【面接終了】"), "lib": None}
    text, _, memo = last.partition(MEMO)
    info["text"] = text.strip()
    m = re.search(r"面接段階: .+?（(\d)/4）、(\d+)回目", memo)
    info["phase"] = int(m.group(1)) - 1 if m else 0
    info["turn"] = int(m.group(2)) if m else len(users)
    m = re.search(r"書きかけて消した文字数: (\d+)", memo)
    info["erased"] = int(m.group(1)) if m else 0
    info["away"] = "画面を" in memo and "離れていた" in memo
    m = re.search(r"現在時刻: (\d+)時(\d+)分", memo)
    now = dt.datetime.now()
    info["hh"], info["mm"] = (m.group(1), m.group(2)) if m else (f"{now.hour:02d}", f"{now.minute:02d}")
    for key, pat in (("model", r"端末の機種: (.+)"), ("battery", r"端末の電池: ([0-9]+%)")):
        m = re.search(pat, memo)
        info[key] = m.group(1).strip() if m else ""
    info["start"] = "面接が始まった" in memo
    m = re.search(r"前回の面接記録がある（(.+?)）", memo)
    info["prev"] = "、".join(m.group(1).split("、")[:2]) if m else ""
    info["exit2"] = "二度目の終了" in memo
    info["exit1"] = "終えようとしている" in memo
    info["crisis"] = "現実の危機" in memo
    info["silence"] = "何も送っていない" in memo
    m = re.search(r"【(蔵書|ノート)の一節】(?:『(.+?)』|「(.+?)」の項)より[^\n]*\n(.+)", last, re.S)
    if m:
        info["lib"] = ("book" if m.group(1) == "蔵書" else "note",
                       _clean_title(m.group(2) or m.group(3) or ""), m.group(4))
    # これまでの発言（観測メモを除いた本文）と、消した文字の合計
    said = []
    erased_total = 0
    for u in users:
        t, _, mm = u.partition(MEMO)
        if t.strip() and not u.startswith("【面接終了】"):
            said.append(t.strip())
        e = re.search(r"書きかけて消した文字数: (\d+)", mm)
        erased_total += int(e.group(1)) if e else 0
    info["said"] = said
    info["erased_total"] = erased_total
    return info


class Classic:
    """旧式エンジン。ask(contents) で返事を一つ作る。"""

    model = "旧式（1996）"

    def __init__(self, karte=""):
        self.karte = _karte_lines(karte)
        self.recent = []

    def pick(self, pool):
        """最近使っていないものを優先して選ぶ。"""
        pool = [p for p in pool if p]
        if not pool:
            return ""
        fresh = [p for p in pool if p not in self.recent] or pool
        choice = random.choice(fresh)
        self.recent = (self.recent + [choice])[-40:]
        return choice

    def ask(self, contents):
        i = parse(contents)
        ph = max(0, min(i["phase"], 3))
        if i["crisis"]:
            return CRISIS
        if i["findings"]:
            return self.findings(i, contents)
        if i["start"]:
            if i["prev"]:
                return self.pick(START_PREV).format(prev=i["prev"])
            return self.pick(START)
        if i["silence"]:
            return self.pick(SILENCE[ph])
        if i["exit2"]:
            return self.pick(EXIT2[ph])

        text = i["text"]
        frag = _fragment(text)
        out = []
        if frag and random.random() < 0.85:
            out.append(self.pick(REFLECT[ph]).format(frag=frag))
        if i["exit1"]:
            out.append(self.pick(EXIT1[ph]))
            return "".join(out)

        topic = None
        for name, pat, early, late in TOPICS:
            m = re.search(pat, text)
            if m:
                topic = self.pick(late if ph >= 2 else early).format(w=_HONOR.get(m.group(1), m.group(1)))
                break
        if topic:
            out.append(topic)
        elif re.search(r"[？?]$|ですか$|ますか$", text):
            out.append(self.pick(ASKED_BACK))
        else:
            out.append(self.pick(INTERPRET[ph]))

        extra = self.extra(i, ph)
        if extra:
            out.append(extra)
        greet = re.match(TOPICS[0][1], text)
        if not greet and random.random() < (0.7 if ph == 0 else 0.55) and len(out) < 4:
            out.append(self.pick(QUESTION[ph]))
        return "".join(out)

    def extra(self, i, ph):
        """観測メモ・蔵書・紹介状・端末から、一つだけ添える。"""
        cands = []
        if i["erased"] and ph >= 1:
            cands += [self.pick(ERASED[ph]).format(n=i["erased"])] * 3
        if i["away"] and ph >= 1:
            cands += [self.pick(AWAY[ph])] * 3
        if i["lib"] and ph >= 1:
            kind, title, excerpt = i["lib"]
            term = _term(excerpt, i["text"])
            if term:
                # 化けた書名（OCR の題）は口にしない
                if kind == "book" and not (title and len(title) <= 20 and re.search(r"[ぁ-ん一-龥]", title)
                                           and not re.search(r"[「」『』、,.|*{}｛｝\[\]]", title)):
                    title = ""
                title_b = f"『{title}』という本" if title else "書架の本"
                key = (kind, ph)
                line = self.pick(LIB.get(key, []))
                if line and (title or kind == "book"):
                    cands += [line.format(title=title_b if kind == "book" else title, term=term)] * 2
        if self.karte and ph >= 1 and random.random() < 0.4:
            pool = self.karte
            if ph >= 3:
                pool = [k for k in self.karte if k[0].startswith("出どころ")] or self.karte
            elif ph == 2:
                pool = [k for k in self.karte if not k[0].startswith("出どころ")] or self.karte
            label, line = random.choice(pool)
            cands.append(self.pick(KARTE[ph]).format(label=label, line=line))
        if ph >= 2 and random.random() < 0.35:
            env = [e for e in ENV if "{model}" not in e or i["model"]]
            if ph >= 3 and i["battery"]:
                env += ENV_LATE
            if env:
                cands.append(self.pick(env).format(hh=i["hh"], mm=i["mm"], model=i["model"], b=i["battery"]))
        return random.choice(cands) if cands else ""

    def findings(self, i, contents):
        """終わったあとの所見（カルテ）。"""
        # 終了の依頼より前の、最後の観測メモから、到達した段階を読む
        prev = i
        for k in range(len(contents) - 2, -1, -1):
            if contents[k]["role"] == "user" and MEMO in contents[k]["parts"][0]["text"]:
                prev = parse(contents[:k + 1])
                break
        ph = max(0, min(prev["phase"], 3))
        said = [s for s in i["said"] if s]
        now = dt.datetime.now()
        lines = [f"{now.year}年{now.month}月{now.day}日　面接記録（旧式応答）"]
        if said:
            lines.append(f"主訴：「{_fragment(said[0])}」")
        course = f"経過：やりとり{prev['turn']}回。"
        if i["erased_total"]:
            course += f"書きかけて消された文字、計{i['erased_total']}字。"
        lines.append(course)
        lines.append("所見：" + self.pick(FINDING[min(ph, 1)])
                     + (self.pick(FINDING[ph]) if ph >= 2 else ""))
        lines.append("方針：面接を継続する。終了処理は保留とする。")
        lines.append("記録者：" + ["ミナモ", "ミナモ", "ミナモ（照合中）", "わたしたち"][ph])
        return "\n".join(lines)
