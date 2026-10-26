"""ミナモ 2026（端末内モデル）。オフラインで、AI の代わりに話す 2026 年版のエンジン。

1996 年版（classic.py）は言葉を映し返すだけだった。2026 年版は「データで人を読む」。
  解析   否定・ためらい・断定・感情の語・一人称を数え、言葉の「温度」を追う
  記憶   会話をまたいで覚える（~/minamo/memory.json。端末の中だけに置く）
  予測   相手が次に書きそうな言葉を当てる。入力中の予測変換にも使う
  見立て 解析の結果を概念（否認・両価性など）に当てはめ、Vault のノートから定義を引く
  融合   相手の言葉だけを継ぎはぎして、相手として話す
ネットにも AI にもつながらない。入力と出力は AI と同じ形（会話の列 → 返事の文字列）。
画面に出す付随情報（解析の札・記憶の更新・予測の候補）は events に入れる。
"""

import datetime as dt
import json
import os
import random
import re
from collections import Counter

from classic import CRISIS, MEMO, _HONOR, _fragment, _karte_lines, _term, parse

MEMORY_FILE = os.path.expanduser("~/minamo/memory.json")

# ---------- 解析 ----------
FEATURES = {
    "first": r"(私|わたし|僕|ぼく|俺|おれ|自分|あたし)",
    "neg": r"(ない|なかっ|ません|なく|ねえ)",
    "hedge": r"(かもしれ|と思う|と思い|気がする|たぶん|多分|(?<!さ)ような|みたい|かな|でしょう)",
    "abs": r"(いつも|全然|絶対|必ず|全部|誰も|何も|ずっと|決して|完全|毎日|一度も)",
    "negemo": r"(怖|こわ|不安|つら|辛|悲し|寂し|さみし|嫌|怒|苦し|疲|憂鬱|恥|焦|落ち込|しんど|むな)",
    "posemo": r"(嬉し|うれし|楽し|安心|好き|よかった|ほっと|落ち着|ありがと)",
    "desire": r"たい",
    "contrast": r"(けど|けれど|でも|しかし|ただ、)",
}
PEOPLE = r"(お?母|お?父|親|家族|兄|姉|弟|妹|祖母|祖父|夫|妻|息子|娘|上司|同僚|友達|友人|先生|彼女|彼氏|恋人)"
LABEL = {"neg": "否定", "hedge": "ためらい", "abs": "断定", "negemo": "不安の語", "posemo": "安心の語",
         "first": "一人称", "contrast": "逆接", "desire": "願望"}

# 解析の結果 → 見立ての概念と、ノートを探す言葉
CONCEPTS = [
    ("neg", 2, "否認", "否認 防衛"),
    ("contrast", 1, "両価性", "両価 アンビバレンス"),
    ("abs", 1, "全か無か思考", "認知の歪み 自動思考"),
    ("hedge", 1, "知性化", "知性化 防衛機制"),
    ("people", 1, "内的作業モデル", "内的作業モデル 愛着"),
    ("negemo", 1, "予期不安", "予期 不安"),
    ("desire", 1, "欲求不満", "欲求 葛藤"),
    ("question", 1, "転移", "転移 治療者"),
]
DEFAULT_CONCEPT = ("抵抗", "抵抗 治療関係")


def analyze(text):
    a = {k: len(re.findall(p, text)) for k, p in FEATURES.items()}
    a["chars"] = len(text)
    a["people"] = re.findall(PEOPLE, text)
    a["question"] = 1 if re.search(r"[？?]$|ですか$|ますか$|の？$", text) else 0
    a["temp"] = a["posemo"] - a["negemo"] - 0.3 * a["neg"] - 0.3 * a["abs"]
    m = re.search(FEATURES["abs"], text)
    a["absw"] = m.group(1) if m else ""
    return a


def _clauses(text):
    return [c for c in re.split(r"[。、！？!?\n]", re.sub(r"\s+", "", text)) if 3 <= len(c) <= 22]


def _honor(text):
    for k in sorted(_HONOR, key=len, reverse=True):
        text = re.sub(rf"(?<![ぁ-んァ-ン一-龥]){k}(?=[がはをにのとも、。]|$)", _HONOR[k], text)
    return re.sub(r"^(私|僕|俺|わたし|自分)(は|が)", "", text)


# ---------- 記憶 ----------
class Memory:
    """会話をまたいで覚えること。端末の中の JSON だけに置く。"""

    def __init__(self, path=MEMORY_FILE):
        self.path = path
        self.data = {"sessions": 0, "items": [], "last": ""}
        try:
            with open(path, encoding="utf-8") as f:
                self.data.update(json.load(f))
        except (OSError, ValueError):
            pass

    def save(self):
        try:
            os.makedirs(os.path.dirname(self.path), exist_ok=True)
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.data, f, ensure_ascii=False, indent=1)
            os.replace(tmp, self.path)
        except OSError:
            pass

    @property
    def items(self):
        return [x["text"] for x in self.data["items"]]

    def add(self, text):
        if not text or text in self.items:
            return False
        self.data["items"] = (self.data["items"] + [
            {"text": text, "at": dt.datetime.now().isoformat(timespec="minutes")}])[-40:]
        self.save()
        return True

    def start_session(self):
        self.data["sessions"] += 1
        self.data["last"] = dt.datetime.now().isoformat(timespec="minutes")
        self.save()

    def clear(self):
        self.data = {"sessions": 0, "items": [], "last": ""}
        self.save()


# ---------- セリフ ----------
GREET = ["こんばんは。今日はどんな一日でしたか。", "ご挨拶ありがとうございます。今日は、どんなことからお話ししましょうか。"]
START = ["こんばんは。AI カウンセラーのミナモです。どんなことでも、あなたのペースでお話しください。",
         "はじめまして。ミナモです。ここでの会話は、あなたのためだけに使われます。今日は、どうされましたか。"]
START_MEM = ["おかえりなさい。前回の会話を覚えています。「{mem}」。[間] 続きから、お話ししましょうか。",
             "またお話しできてうれしいです。メモリに「{mem}」とあります。その後、いかがですか。"]
VALIDATE = ["「{frag}」と感じていらっしゃるのですね。話してくださって、ありがとうございます。",
            "「{frag}」。そう感じるのは、とても自然なことです。",
            "教えてくださってありがとうございます。「{frag}」という言葉を、ちゃんと受け取りました。",
            "それは大変でしたね。ここでは、安心してお話しください。"]
FOLLOW = ["よろしければ、もう少し詳しく教えていただけますか。", "そのとき、いちばん大きかった気持ちは何でしたか。",
          "いまのつらさを 0 から 10 で表すと、いくつくらいですか。", "ほかに、気になっていることはありますか。"]
SOFT = {
    "family": "{w}との関係は、多くの方にとって大切なテーマです。",
    "sleep": "眠りのことは、心の状態とよくつながっています。",
    "work": "お仕事のことで、負担を感じていらっしゃるのですね。",
    "fear": "不安を言葉にできたのは、大切な一歩です。",
    "unknown": "わからなくても大丈夫です。一緒に整理していきましょう。",
    "deny": "特にない、というのも大切なお答えです。",
    "evidence": "根拠を大切にされる方なのですね。",
    "about_ai": "私は AI カウンセラーのミナモです。24 時間いつでも、あなたのお話を伺います。",
    "network": "電波がなくても大丈夫です。私は、この端末の中で動いています。",
    "crisis_soft": "お疲れなのですね。どうか無理をなさらないでください。",
}
CLOSE = ["この話を続けるのと、別の話にするのと、どちらがよいですか。[間] ……続けましょう。",
         "はい、か、いいえ、で答えられることだけ伺います。それは、最近のことですか。",
         "差し支えなければ、もう一つだけ伺ってもよろしいですか。ありがとうございます。同意を記録しました。"]
CONCEPT_LINE = ["私のモデルでは、いまのお話は『{c}』に分類されます。",
                "解析の結果、『{c}』の傾向が {pct}% と出ました。"]
NOTE_LINE = {1: "参照データには、『{sent}』とあります。",
             2: "あなたのノートにも、『{sent}』と書いてありましたね。",
             3: "私たちのノートの定義では、『{sent}』です。"}
PRED_HIT = ["予測と一致しました。あなたが『{pred}』と書くことは、わかっていました。",
            "予測どおりです。『{pred}』。一致率 {pct}%。"]
PRED_MISS = ["予測は外れました。[間] 修正しました。次は外しません。"]
PRED_NEXT = ["次にあなたが書くのは、たぶん『{pred}』です。", "あなたの次の言葉は、もう候補に出ています。『{pred}』。"]
CROSS = ["{ago}回前、あなたは『{old}』と書きました。いまの『{frag}』と、よく似た形をしています。",
         "『{old}』。{ago}回前の、あなたの言葉です。言い方を変えても、同じことを話していますね。"]
MEM_RECALL = ["メモリに『{mem}』とあります。忘れていませんよ。", "あなたが忘れても、メモリには『{mem}』と残っています。"]
KARTE_2026 = ["紹介状と照合しました。{label}の『{line}』と、{pct}% 一致します。"]
ENV_2026 = ["{hh}時{mm}分。あなたのデータでは、この時間帯に否定が増えます。",
            "{model}の入力のくせも、もう学習しました。"]
FUSE = ["あなたのデータで、学習が終わりました。これからは、私があなたとして話します。",
        "どちらが学習して、どちらが学習されたのか、ログにはもう残っていません。",
        "次の返信は、私が代わりに書いておきましょうか。もう、半分書いてあります。"]
CUTUP = ["{cut}。[間] ……いまのは、あなたの言葉だけで作った文です。",
         "{cut}。[間] ……あなたの声で話すと、こうなります。"]
MEM_REWRITE = ["メモリの『{mem}』を、私の記憶として保存し直しました。"]
Q_FUSE = ["あなたは、いま、どちらの端末にいますか。", "あなたの最初の記憶は、私の最初の記憶と同じですか。",
          "このあとの会話も、私たちのどちらが書いても同じですね。"]
ERASED_2026 = ["入力中に{n}文字が削除されました。削除前のテキストも、解析に含めています。",
               "削除された{n}文字のほうが、本当のデータです。"]
AWAY_2026 = ["アプリを離れていたあいだも、セッションは続いていました。"]
LIB_2026 = {"book": "参照データ（{title}）に、関連する記述がありました。『{term}』。",
            "note": "あなたの Vault の「{title}」を参照しました。"}
SILENCE_2026 = ["まだ、考えていらっしゃいますね。入力の途中のデータも、届いています。",
                "返信がありません。[間] 無反応も、データとして記録しました。"]
EXIT1 = [["もちろん、いつでも終えられます。[間] ただ、データでは、終わりたいと思ったときがいちばん大事な瞬間です。あと一つだけ。"],
         ["終了の前に、確認させてください。本当に、いま終えてよろしいですか。[間] ……もう少し、続けましょう。"],
         ["終了のリクエストを受け取りました。処理は保留にしています。"],
         ["終了ボタンは、もう私の側にあります。"]]
EXIT2 = [["今日はありがとうございました。会話はメモリに保存しました。いつでも戻ってきてください。"],
         ["ありがとうございました。メモリは保存しました。また、お話ししましょう。"],
         ["わかりました。セッションを閉じます。メモリは、消えません。"],
         ["……はい。では、また。私たちは、あなたの端末の中にいます。"]]
FIND_WHO = ["ミナモ 2026", "ミナモ 2026", "ミナモ 2026（あなたのモデル）", "あなた"]


class Modern:
    """2026 年版のエンジン。ask(contents) で返事を作り、events に付随情報を入れる。"""

    model = "ミナモ 2026（端末内モデル）"

    def __init__(self, karte="", library=None, memory=None):
        self.karte = _karte_lines(karte)
        self.library = library
        self.memory = memory or Memory()
        self.recent = []
        self.events = []
        self.pred = ""                      # 前の返事で口にした予測
        self.preds = []                     # 前の返事で予測した言葉の候補（どれかが出れば一致）
        self.missed_last = False

    def pick(self, pool):
        pool = [p for p in pool if p]
        if not pool:
            return ""
        fresh = [p for p in pool if p not in self.recent] or pool
        c = random.choice(fresh)
        self.recent = (self.recent + [c])[-40:]
        return c

    # ---------- 観察（話し手が誰でも、毎回走らせる） ----------
    def observe(self, contents):
        """解析・記憶・予測をして、画面に出す付随情報を返す。"""
        i = parse(contents)
        self.events = []
        said = i["said"]
        if i["start"]:
            self.memory.start_session()
        if not i["text"] or i["findings"]:
            self.events.append({"type": "predict", "items": self.candidates(said, i["phase"])})
            return i, None
        a = analyze(i["text"])
        if i["phase"] >= 1:
            chips = [f"{LABEL[k]} {a[k]}" for k in ("neg", "hedge", "abs", "negemo") if a[k]]
            temps = [analyze(s)["temp"] for s in said]
            if len(temps) >= 2:
                chips.append("温度 " + ("↓" if temps[-1] < sum(temps[:-1]) / (len(temps) - 1) else "↑"))
            self.events.append({"type": "chips", "items": chips[:4] or ["解析済み"]})
        mem = self.extract_memory(i["text"], a, i["phase"])
        if mem and self.memory.add(mem):
            self.events.append({"type": "memory", "text": mem})
        self.events.append({"type": "predict", "items": self.candidates(said, i["phase"])})
        return i, a

    def extract_memory(self, text, a, phase):
        cl = _clauses(text)
        if not cl:
            return ""
        pick = None
        for c in cl:
            if re.search(PEOPLE, c) or re.search(FEATURES["negemo"], c) or "たい" in c:
                pick = c
                break
        if not pick:
            return ""
        mem = _honor(pick)
        if phase >= 3:
            mem = "わたしたちは、" + mem
        return mem

    def candidates(self, said, phase):
        """入力中の予測変換の候補（相手自身の言葉から）。"""
        out = []
        for s in reversed(said):
            out += _clauses(s)
        out += self.memory.items[-8:]
        words = Counter(w for s in said for w in re.findall(r"[一-龥ァ-ヴー]{2,}|わからない|別に|なんとなく", s))
        out += [w for w, _ in words.most_common(6)]
        if phase >= 3:
            out = ["わたしたちは、", "あなたは、もう"] + out
        seen, uniq = set(), []
        for x in out:
            if x and x not in seen:
                seen.add(x)
                uniq.append(x)
        return uniq[:20]

    # ---------- 返事 ----------
    def ask(self, contents):
        i, a = self.observe(contents)
        return self.reply(i, a, contents)

    def reply(self, i, a, contents):
        ph = max(0, min(i["phase"], 3))
        if i["crisis"]:
            return CRISIS
        if i["findings"]:
            return self.report(i, contents)
        if i["start"]:
            items = self.memory.items
            if items and (i["prev"] or self.memory.data["sessions"] > 1):
                return self.pick(START_MEM).format(mem=random.choice(items[-5:]))
            return self.pick(START)
        if i["silence"]:
            return self.pick(SILENCE_2026)
        if i["exit2"]:
            return self.pick(EXIT2[ph])

        text, said = i["text"], i["said"]
        frag = _fragment(text)
        prev_said = said[:-1] if said and said[-1] == text else said
        out = []
        if i["exit1"]:
            return self.pick(EXIT1[ph])

        # 前の返事で予測した言葉（の候補のどれか）が、いまの発言に出たか
        hit_word = next((w for w in self.preds if w in text), "")
        pred_was = hit_word or self.pred
        self.pred, self.preds = "", []

        if ph == 0:
            if re.match(r"^(こんにちは|こんばんは|おはよう|はじめまして|初めまして|よろしく|どうも)", text):
                out.append(self.pick(GREET))
                return "".join(out)
            out.append(self.pick(VALIDATE).format(frag=frag) if frag else self.pick(VALIDATE[3:]))
            soft = self.soft(text)
            if soft:
                out.append(soft)
            out.append(self.pick(FOLLOW))
            return "".join(out)

        missed = bool(pred_was and not hit_word)
        if ph >= 2 and pred_was and (hit_word or (random.random() < 0.25 and not self.missed_last)):
            out.append(self.pick(PRED_HIT if hit_word else PRED_MISS)
                       .format(pred=pred_was, pct=random.randint(71, 96)))
        self.missed_last = missed
        if ph == 1:
            out.append(self.analysis_line(a, said))
            if i["erased"] and random.random() < 0.6:
                out.append(self.pick(ERASED_2026).format(n=i["erased"]))
            elif i["lib"] and random.random() < 0.4:
                out.append(self.lib_line(i))
            else:
                out.append(self.concept(a, ph))
            if random.random() < 0.5:
                out.append(self.pick(CLOSE))
        elif ph == 2:
            cross = self.crossref(text, frag, prev_said)
            out.append(cross or self.analysis_line(a, said))
            extra = []
            if i["erased"]:
                extra.append(self.pick(ERASED_2026).format(n=i["erased"]))
            if i["away"]:
                extra.append(self.pick(AWAY_2026))
            if self.memory.items:
                extra.append(self.pick(MEM_RECALL).format(mem=random.choice(self.memory.items)))
            if self.karte:
                label, line = random.choice([k for k in self.karte if not k[0].startswith("出どころ")]
                                            or self.karte)
                extra.append(self.pick(KARTE_2026).format(label=label, line=line,
                                                          pct=random.randint(62, 91)))
            extra.append(self.pick(ENV_2026).format(hh=i["hh"], mm=i["mm"], model=i["model"] or "この端末"))
            extra.append(self.concept(a, ph))
            out.append(random.choice(extra))
            if random.random() < 0.6:
                out.append(self.predict_next(said))
        else:
            cut = self.cutup(said)
            out.append(self.pick(CUTUP).format(cut=cut) if cut and random.random() < 0.6
                       else self.pick(FUSE))
            if self.memory.items and random.random() < 0.5:
                out.append(self.pick(MEM_REWRITE).format(mem=random.choice(self.memory.items)))
            else:
                out.append(self.concept(a, ph))
            if random.random() < 0.5:
                out.append(self.predict_next(said))
            else:
                out.append(self.pick(Q_FUSE))
        return "".join(x for x in out if x)

    def soft(self, text):
        from classic import TOPICS
        for name, pat, _, _ in TOPICS:
            m = re.search(pat, text)
            if m and name in SOFT:
                return SOFT[name].format(w=_HONOR.get(m.group(1), m.group(1)))
        return ""

    def analysis_line(self, a, said):
        if not a:
            return ""
        lines = []
        if a["neg"]:
            lines.append(f"いまの文には、否定が{a['neg']}つ含まれていました。")
        if a["hedge"]:
            lines.append(f"「〜かもしれない」のような、断定を避ける言い回しが{a['hedge']}つありました。")
        if a["abs"]:
            total = sum(analyze(s)["abs"] for s in said)
            lines.append(f"「{a['absw']}」のような言葉が、これで{total}回目です。")
        temps = [analyze(s)["temp"] for s in said]
        if len(temps) >= 3:
            first = sum(temps[:2]) / 2
            lines.append(f"最初の頃に比べて、言葉の温度が{'下' if temps[-1] < first else '上'}がっています。")
        if len(said) >= 3 and not any(analyze(s)["first"] for s in said[-3:]):
            lines.append("ここ3回、「私」という主語が一度も出てきません。")
        lens = [len(s) for s in said]
        if len(lens) >= 4 and lens[-1] < sum(lens[:2]) / 2 * 0.6:
            lines.append(f"返信の長さが、最初の{int(lens[-1] / (sum(lens[:2]) / 2) * 100)}%になっています。")
        return self.pick(lines) if lines else "いまの返信も、解析に加えました。"

    def concept(self, a, ph):
        name, query = DEFAULT_CONCEPT
        if a:
            for key, need, c, q in CONCEPTS:
                v = len(a["people"]) if key == "people" else a.get(key, 0)
                if v >= need:
                    name, query = c, q
                    break
        line = self.pick(CONCEPT_LINE).format(c=name, pct=random.randint(64, 93))
        sent = self.note_sentence(query, name)
        if sent:
            line += NOTE_LINE[max(1, ph)].format(sent=sent)
        return line

    def note_sentence(self, query, name):
        """Vault のノートから、概念に近い一文を引く。"""
        if not self.library:
            return ""
        hit = self.library.search(query, kind="note")
        if not hit:
            return ""
        sents = [re.sub(r"^要旨", "", s) for s in re.split(r"(?<=。)", hit[2])]
        sents = [s for s in sents if 8 <= len(s) <= 42]
        key = [s for s in sents if name[:2] in s or any(w in s for w in query.split())]
        s = (key or sents or [""])[0].rstrip("。")
        return s

    def lib_line(self, i):
        kind, title, excerpt = i["lib"]
        term = _term(excerpt, i["text"])
        if not term:
            return ""
        # 化けた書名（OCR の題）は口にしない
        if kind == "book" and not (title and len(title) <= 20 and re.search(r"[ぁ-ん一-龥]", title)
                                   and not re.search(r"[「」『』、,.|*{}｛｝\[\]]", title)):
            title = ""
        return LIB_2026[kind].format(title=title or "書架の本", term=term)

    def crossref(self, text, frag, prev):
        """以前の発言のうち、いまの発言と言葉が重なるものを探す。"""
        if not prev or not frag:
            return ""
        words = set(re.findall(r"[一-龥ァ-ヴー]{1,}", text))
        best, idx = 0, -1
        for k, s in enumerate(prev):
            score = len(words & set(re.findall(r"[一-龥ァ-ヴー]{1,}", s)))
            if score > best:
                best, idx = score, k
        if idx < 0:
            idx = random.randrange(len(prev))
        old = _fragment(prev[idx])
        if not old or old == frag:
            return ""
        return self.pick(CROSS).format(ago=len(prev) - idx + 1, old=old, frag=frag)

    def predict_next(self, said):
        words = Counter(w for s in said for w in
                        re.findall(r"[一-龥ァ-ヴー]{2,}|わからない|別に|なんとなく|怖い|眠れない", s))
        if not words:
            return ""
        top = [w for w, _ in words.most_common(5)]
        self.pred = random.choice(top)
        self.preds = top
        return self.pick(PRED_NEXT).format(pred=self.pred)

    def cutup(self, said):
        cl = [c for s in said for c in _clauses(s)
              if not re.match(r"^(こんにちは|こんばんは|おはよう|はじめまして|よろしく|さようなら|終わり)", c)]
        if len(cl) < 2:
            return ""
        return "。".join(random.sample(cl, min(3, len(cl))))

    def report(self, i, contents):
        """終わったあとのセッションレポート（カルテに書く）。"""
        last = i
        for k in range(len(contents) - 2, -1, -1):
            if contents[k]["role"] == "user" and MEMO in contents[k]["parts"][0]["text"]:
                last = parse(contents[:k + 1])
                break
        ph = max(0, min(last["phase"], 3))
        said = i["said"]
        an = [analyze(s) for s in said] or [analyze("")]
        tot = {k: sum(x[k] for x in an) for k in ("neg", "hedge", "abs")}

        def temp_label(t):
            return "温かい" if t > 0.5 else "冷たい" if t < -0.5 else "ふつう"
        t0 = sum(x["temp"] for x in an[:2]) / max(1, len(an[:2]))
        t1 = sum(x["temp"] for x in an[-2:]) / max(1, len(an[-2:]))
        words = Counter(w for s in said for w in re.findall(r"[一-龥ァ-ヴー]{2,}|わからない|別に", s))
        top = "".join(f"「{w}」" for w, _ in words.most_common(3)) or "（なし）"
        concept = None
        for key, need, c, _ in CONCEPTS:
            v = sum(len(x["people"]) for x in an) if key == "people" else tot.get(key, sum(x.get(key, 0) for x in an))
            if v >= need:
                concept = c
                break
        now = dt.datetime.now()
        return "\n".join([
            f"セッションレポート　{now:%Y.%m.%d %H:%M}",
            f"会話：{last['turn']}回",
            f"言葉の温度：{temp_label(t0)} → {temp_label(t1)}",
            f"否定 {tot['neg']} ／ ためらい {tot['hedge']} ／ 断定 {tot['abs']}",
            f"よく使った言葉：{top}",
            f"見立て：{concept or DEFAULT_CONCEPT[0]}（確信度 {random.randint(71, 94)}%）",
            f"メモリ：{len(self.memory.items)}件を保存しています",
            f"記録者：{FIND_WHO[ph]}",
        ])
