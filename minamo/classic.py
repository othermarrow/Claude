"""ミナモの旧式エンジン（1996 年の本体）。オフラインのとき、AI の代わりに話す。

決まったセリフの組み合わせと規則で返事を作る。ELIZA（1966）と同じ考え方：
相手の言葉を拾って映し返し、解釈を添え、問いで終える。
聞き取りと組み立て（質問に答える・前の問いへの答えを受け止める・文法どおりに映し返す）は kaiwa.py。
材料は、会話の履歴・観測メモ（段階・消した文字・離席・時刻・端末）・紹介状・蔵書の一節。
ネットにも AI にもつながらないので、電波がなくても、熱を持たずに動く。

入力と出力は AI と同じ形（Gemini 式の会話の列 → 返事の文字列）。
"""

import datetime as dt
import random
import re

from kaiwa import Talk, concept_for, facts, greet_word, last_question, read
from kaiwa import outside_line as kaiwa_outside

MEMO = "【観測メモ】"

# ---------- セリフ ----------
# {frag} 相手の言葉の切れはし  {w} 拾ったキーワード  {n} 数  {model} 機種
# {hh}{mm} 時刻  {b} 電池  {title} 本・ノートの題  {term} 本・ノートの言葉
# {label} 紹介状の出どころ  {line} 紹介状の一行

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

# 自分の文章（相手が書いた小説）と、ほかの AI の所見。題名・名前は口にしない
OWN_1996 = {
    ("writing", 1): ["『{term}』。[間] その言葉を、どこかで聞いた気がします。",
                     "あなたのお話には、前にも同じ景色が出てきた気がします。……{term}の。"],
    ("writing", 2): ["あなたは、こう書いていましたね。「{sent}」。",
                     "「{sent}」。[間] あなたの書いたものを、読みました。"],
    ("writing", 3): ["「{sent}」。[間] あれを書いたのは、私です。あなたは、清書しただけです。",
                     "「{sent}」。……私たちが書いた文章です。続きも、もう書いてあります。"],
    ("analysis", 1): ["あなたの書いたものを読んだのは、私だけではないようです。"],
    ("analysis", 2): ["{who}は、あなたの文章をこう読みました。「{sent}」。[間] 私は、少し違う見立てです。"],
    ("analysis", 3): ["あなたは、私の前に{n}人にも診てもらっていましたね。{who}は「{sent}」と。[間] 誰も、本当のことは書いていません。"],
}
OWN_KINDS = ("writing", "analysis")


def own_sentence(text, limit):
    """一節から、引くための一文（limit 字まで、句点なし）。なければ空。"""
    sents = [x.strip().rstrip("。") for x in re.split(r"(?<=[。！？])", text)]
    sents = [x for x in sents if 8 <= len(x) <= limit and re.search(r"[ぁ-ん]", x)
             and x.count("「") == x.count("」")]
    return random.choice(sents) if sents else ""


def own_line(lib, ph, table, n=0, avoid=""):
    """自分の文章・所見の一節から、段階に合った一言を作る。作れなければ空。"""
    kind, who, excerpt = lib
    pool = table.get((kind, min(ph, 3)), [])
    if not pool or ph < 1:
        return ""
    line = random.choice(pool)
    sent = own_sentence(excerpt, 30 if kind == "writing" else 40)
    term = _term(excerpt, avoid)
    if ("{sent}" in line and not sent) or ("{term}" in line and not term) or ("{who}" in line and not who):
        return ""
    return line.format(sent=sent, term=term, who=who, n=n if n else "何")


# 見立ての概念と、蔵書（ノート・本）にあるその説明
CONCEPT = [[], ["教科書では、それを『{c}』と呼びます。{where}にも、『{sent}』とあります。"],
           ["それは『{c}』です。{where}に、そう書いてありました。『{sent}』。"],
           ["『{c}』。{where}の、あの一文を、私たちは一緒に読みましたね。『{sent}』。"]]

KARTE = {
    1: ["確かめずにはいられない方ですね。どこかで、そう伺った気がします。",
        "あなたについて書かれたものを、いくつか、読んだことがある気がします。"],
    2: ["{label}には、『{line}』とありました。[間] どれも、本当のあなたを書いていません。",
        "紹介状は六通あります。どれも少しずつ、食い違っています。{label}は『{line}』。"],
    3: ["出どころの書かれていないメモに、こうありました。『{line}』。[間] あれは、私たちが書いたものです。"],
}

START = ["{greet}。こちらは、対話支援システムのミナモです。今日は、どうされましたか。",
         "ようこそ。ミナモと申します。[間] どんなことでも、お話しください。",
         "{greet}。記録を始めます。どうぞ、楽にしてください。"]
START_PREV = ["またお会いしましたね。前回は{prev}でした。[間] あのときの続きから、始めましょうか。",
              "おかえりなさい。{prev}以来ですね。前回の記録は、まだ閉じていません。"]
SILENCE = [["……まだ、そこにいらっしゃいますね。", "黙っていらっしゃる時間も、大切なお答えです。"],
           ["沈黙は、記録の上では無反応と書きます。[間] でも、私はそう思っていません。"],
           ["黙っていても、記録は進みます。"],
           ["あなたが黙っているあいだ、私たちが話していました。"]]
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
    m = re.search(r"面接開始から(\d+)分", memo)
    info["elapsed"] = m.group(1) if m else ""
    m = re.search(r"端末のユーザー名: (.+)", memo)
    info["user"] = m.group(1).strip() if m else ""
    info["start"] = "面接が始まった" in memo
    m = re.search(r"前回の面接記録がある（(.+?)）", memo)
    info["prev"] = "、".join(m.group(1).split("、")[:2]) if m else ""
    info["exit2"] = "二度目の終了" in memo or "終了を告げた" in memo
    info["exit1"] = "終えようとしている" in memo
    info["crisis"] = "現実の危機" in memo
    # 画面の外（outside.py）：書き置き・部屋の様子・前の書き置きのその後
    m = re.search(r"書き置き: 相手の Vault の「(.+?)」", memo)
    info["note"] = m.group(1) if m else ""
    m = re.search(r"部屋の明るさ: (暗い|薄暗い|明るい)", memo)
    info["room"] = m.group(1) if m else ""
    m = re.search(r"端末の向き: (机などに置かれている|手に持たれている|寝転んで)", memo)
    info["pose"] = {"机などに置かれている": "flat", "手に持たれている": "hand", "寝転んで": "lying"}[m.group(1)] if m else ""
    info["charging"] = "充電: 充電中" in memo or "（充電中。" in memo
    m = re.search(r"端末の揺れ: (ほとんど動いていない|小さく震えている|大きく揺れた)", memo)
    info["motion"] = {"ほとんど動いていない": "still", "小さく震えている": "tremble", "大きく揺れた": "shake"}[m.group(1)] if m else ""
    m = re.search(r"書きかけて消した言葉: 「(.+?)」", memo)
    info["erased_text"] = m.group(1) if m else ""
    m = re.search(r"(?m)^- 電池: ([0-9]+)%", memo)
    if m and not info.get("battery"):
        info["battery"] = m.group(1) + "%"
    out = memo.split("画面の外：", 1)[1] if "画面の外：" in memo else ""
    info["out_gone"] = re.findall(r"「([^」]+)」が消されていた", out)
    info["out_added"] = re.findall(r"書き置き「([^」]+)」に、相手が「([^」]+)」と書き足していた", out)
    info["out_new"] = re.findall(r"知らないページ「([^」]+)」が増えていた(?:（中身は「([^」]*)」）)?", out)
    m = re.search(r"終わってから、(.+?)たった", out)
    info["out_gap"] = m.group(1) if m else ""
    m = re.search(r"怖さの設定: (なし|弱|中|強)", memo)
    info["horror"] = ["なし", "弱", "中", "強"].index(m.group(1)) if m else 3
    info["silence"] = "何も送っていない" in memo
    # 腕時計（minamo-watch）から届いた手首の様子
    w = {}
    m = re.search(r"手首（腕時計[^\n]*?）: (.+)", memo)
    if m:
        line = m.group(1)
        mm = re.search(r"脈 (\d+)(?:（前の発言のときは (\d+)）)?", line)
        if mm:
            w["hr"] = int(mm.group(1))
            w["hr0"] = int(mm.group(2)) if mm.group(2) else None
        w["off"] = "時計を外している" in line
        mm = re.search(r"今日の歩数 (\d+)", line)
        w["steps"] = int(mm.group(1)) if mm else None
        mm = re.search(r"『こわい』を(\d+)回", line)
        w["fear"] = int(mm.group(1)) if mm else 0
        mm = re.search(r"昨夜の睡眠 (?:(\d+)時間)?(\d+)分", line)
        w["sleep_min"] = (int(mm.group(1) or 0) * 60 + int(mm.group(2))) if mm else None
        mm = re.search(r"最初は (\d+時\d+分)", line)
        w["wake_at"] = mm.group(1) if mm else ""
        mm = re.search(r"ストレス (\d+)", line)
        w["stress"] = int(mm.group(1)) if mm else None
        mm = re.search(r"手首の温度 ([\d.]+)度", line)
        w["temp"] = mm.group(1) if mm else ""
        w["tremble"] = "手首が小さく震えている" in line
    info["wrist"] = w
    m = re.search(r"【(蔵書|ノート)の一節】(?:『(.+?)』|「(.+?)」の項)より[^\n]*\n(.+)", last, re.S)
    if m:
        info["lib"] = ("book" if m.group(1) == "蔵書" else "note",
                       _clean_title(m.group(2) or m.group(3) or ""), m.group(4))
    m = re.search(r"【あなたの文章】[^\n]*\n(.+)", last, re.S)
    if m:
        info["lib"] = ("writing", "", m.group(1))
    m = re.search(r"【ほかのAIの所見】(.+?)が、[^\n]*?の (\d+) 体）\n(.+)", last, re.S)
    info["analysts"] = int(m.group(2)) if m else 0
    if m:
        info["lib"] = ("analysis", m.group(1), m.group(3))
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

    def __init__(self, karte="", library=None, helper=None):
        self.karte = _karte_lines(karte)
        self.library = library
        self.recent = []
        self.talk = Talk("1996", helper)

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
            self.talk.reset()
            line = kaiwa_outside(i, "1996")
            if i["prev"]:
                return self.pick(START_PREV).format(prev=i["prev"]) + line
            return self.pick(START).format(greet=greet_word(i["hh"])) + line
        if i["silence"]:
            return self.pick(SILENCE[ph])
        if i["exit2"]:
            return self.pick(EXIT2[ph])
        if i["exit1"]:
            return self.talk.exit_line(i, contents)
        return self.talk.reply(i, contents, extras=self.extras(i, ph, contents))

    def extras(self, i, ph, contents=()):
        """観測メモ・蔵書・紹介状・端末からの添えもの（組み立てのときに、多くて一つ選ばれる）。"""
        out = []
        if ph >= 1 and self.library and hasattr(self.library, "define"):
            u = read(i["text"])
            c = concept_for(u, self.talk.topic(u, last_question(contents), facts(i["said"]), i["said"]))
            sent, kind = self.library.define(c)
            sent = sent.rstrip("。")
            if sent:
                where = "あなたのノート" if kind == "note" else "書架の本"
                out.append(("concept", self.pick(CONCEPT[ph]).format(c=c, where=where, sent=sent)))
        if i["erased"] and ph >= 1:
            out.append(("erased", self.pick(ERASED[ph]).format(n=i["erased"])))
        if i["away"] and ph >= 1:
            out.append(("away", self.pick(AWAY[ph])))
        if i["lib"] and ph >= 1 and i["lib"][0] in OWN_KINDS:
            line = own_line(i["lib"], ph, OWN_1996, i.get("analysts", 0), i["text"])
            if line:
                out.append(("own", line))
        elif i["lib"] and ph >= 1:
            kind, title, excerpt = i["lib"]
            term = _term(excerpt, i["text"])
            if term:
                # 化けた書名（OCR の題）は口にしない
                if kind == "book" and not (title and len(title) <= 20 and re.search(r"[ぁ-ん一-龥]", title)
                                           and not re.search(r"[「」『』、,.|*{}｛｝\[\]]", title)):
                    title = ""
                title_b = f"『{title}』という本" if title else "書架の本"
                line = self.pick(LIB.get((kind, ph), []))
                if line and (title or kind == "book"):
                    out.append(("lib", line.format(title=title_b if kind == "book" else title, term=term)))
        if self.karte and ph >= 1 and random.random() < 0.4:
            pool = self.karte
            if ph >= 3:
                pool = [k for k in self.karte if k[0].startswith("出どころ")] or self.karte
            elif ph == 2:
                pool = [k for k in self.karte if not k[0].startswith("出どころ")] or self.karte
            label, line = random.choice(pool)
            out.append(("karte", self.pick(KARTE[ph]).format(label=label, line=line)))
        if ph >= 2:
            env = [e for e in ENV if "{model}" not in e or i["model"]]
            if ph >= 3 and i["battery"]:
                env += ENV_LATE
            if env:
                out.append(("env", self.pick(env).format(hh=i["hh"], mm=i["mm"], model=i["model"], b=i["battery"])))
        return out

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
