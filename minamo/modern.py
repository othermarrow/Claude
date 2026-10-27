"""ミナモ 2026（端末内モデル）。オフラインで、AI の代わりに話す 2026 年版のエンジン。

1996 年版（classic.py）は言葉を映し返すだけだった。2026 年版は「データで人を読む」。
  解析   否定・ためらい・断定・感情の語・一人称を数え、言葉の「温度」を追う
  記憶   会話をまたいで覚える（~/minamo/memory.json。端末の中だけに置く）
  予測   相手が次に書きそうな言葉を当てる。入力中の予測変換にも使う
  見立て 話題とふるまいを概念（過剰適応・否認など）に当てはめ、Vault のノートから定義を引く
  融合   相手の言葉だけを継ぎはぎして、相手として話す
聞き取りと組み立て（質問に答える・前の問いへの答えを受け止める・文法どおりに映し返す・
相手の言葉から怖さを作る）は kaiwa.py。ここでは 2026 年版の添えもの（解析・記憶・予測・継ぎはぎ）を作る。
ネットにも AI にもつながらない。入力と出力は AI と同じ形（会話の列 → 返事の文字列）。
画面に出す付随情報（解析の札・記憶の更新・予測の候補）は events に入れる。
"""

import datetime as dt
import json
import os
import random
import re
from collections import Counter

import kaiwa
from classic import CRISIS, MEMO, _karte_lines, _term, parse

MEMORY_FILE = os.path.expanduser("~/minamo/memory.json")

# ---------- 解析 ----------
FEATURES = {
    "first": r"(私|わたし|僕|ぼく|俺|おれ|自分|あたし)",
    "neg": r"(ない|なかっ|ません|なく|ねえ)",
    "hedge": r"(かもしれ|と思う|と思い|気がする|たぶん|多分|(?<!さ)ような|みたい|かな(?!り)|でしょう)",
    "abs": r"(いつも|全然|絶対|必ず|全部|誰も|何も|ずっと|決して|完全|毎日|一度も)",
    "negemo": r"(怖|こわ|不安|つら|辛|悲し|寂し|さみし|嫌|怒|苦し|疲|憂鬱|恥|焦|落ち込|しんど|むな)",
    "posemo": r"(嬉し|うれし|楽し|安心|好き|よかった|ほっと|落ち着|ありがと)",
    "desire": r"たい",
    "contrast": r"(けど|けれど|でも|しかし|ただ、)",
}
PEOPLE = r"(お?母|お?父|親|家族|兄|姉|弟|妹|祖母|祖父|夫|妻|息子|娘|上司|同僚|友達|友人|先生|彼女|彼氏|恋人)"
LABEL = {"neg": "否定", "hedge": "ためらい", "abs": "断定", "negemo": "不安の語", "posemo": "安心の語",
         "first": "一人称", "contrast": "逆接", "desire": "願望"}


def analyze(text):
    a = {k: len(re.findall(p, text)) for k, p in FEATURES.items()}
    a["chars"] = len(text)
    a["people"] = re.findall(PEOPLE, text)
    a["question"] = 1 if re.search(r"[？?]$|ですか$|ますか$|の？$", text) else 0
    a["temp"] = a["posemo"] - a["negemo"] - 0.3 * a["neg"] - 0.3 * a["abs"]
    m = re.search(FEATURES["abs"], text)
    a["absw"] = m.group(1) if m else ""
    return a


def _narrative(said):
    """打ち明けにあたる発言だけ（あいさつ・はい・質問などを除く）。"""
    return [s for s in said if kaiwa.read(s)["act"] == "narrative"]


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


# ---------- セリフ（2026 年版の添えもの） ----------
START = ["{greet}。AI カウンセラーのミナモです。どんなことでも、あなたのペースでお話しください。",
         "はじめまして。ミナモです。ここでの会話は、あなたのためだけに使われます。今日は、どうされましたか。"]
START_MEM = ["おかえりなさい。前回の会話を覚えています。「{mem}」。[間] 続きから、お話ししましょうか。",
             "またお話しできてうれしいです。メモリに「{mem}」とあります。その後、いかがですか。"]
CONCEPT_LINE = ["私のモデルでは、いまのお話は『{c}』に分類されます。",
                "解析の結果、『{c}』の傾向が {pct}% と出ました。"]
NOTE_LINE = {1: "参照データには、『{sent}』とあります。",
             2: "あなたのノートにも、『{sent}』と書いてありましたね。",
             3: "私たちのノートには、『{sent}』とありました。"}
BOOK_LINE = {1: "書架の本には、『{sent}』とあります。", 2: "書架の本にも、『{sent}』と書いてありました。",
             3: "私たちが一緒に読んだ本には、『{sent}』とありました。"}
PRED_HIT = ["予測と一致しました。あなたが『{pred}』と書くことは、わかっていました。",
            "予測どおりです。『{pred}』。一致率 {pct}%。"]
PRED_MISS = ["予測は外れました。[間] 修正しました。次は外しません。"]
PRED_NEXT = ["次にあなたが書くのは、たぶん『{pred}』です。", "あなたの次の言葉は、もう候補に出ています。『{pred}』。"]
# 予測が当たったとみなす、言い方の違い
PRED_VARIANTS = {"はい": ["うん", "ええ", "そう"], "いいえ": ["いや", "ううん", "違", "いえ"],
                 "わからない": ["分からない", "わかんない", "わからん", "分かんない"], "別に": ["べつに", "特に"]}
MEM_RECALL = ["メモリに『{mem}』とあります。忘れていませんよ。", "あなたが忘れても、メモリには『{mem}』と残っています。"]
KARTE_2026 = ["紹介状と照合しました。{label}の『{line}』と、{pct}% 一致します。"]
ENV_2026 = ["{hh}時{mm}分。あなたのデータでは、この時間帯に否定が増えます。",
            "{model}の入力のくせも、もう学習しました。"]
CUTUP = ["{cut}。[間] ……いまのは、あなたの言葉だけで作った文です。",
         "{cut}。[間] ……あなたの声で話すと、こうなります。"]
MEM_REWRITE = ["メモリの『{mem}』を、私の記憶として保存し直しました。"]
ERASED_2026 = ["入力中に{n}文字が削除されました。削除前のテキストは届いていません。文字数だけが届いています。",
               "削除された{n}文字のほうが、本当のデータです。"]
AWAY_2026 = ["アプリを離れていたあいだも、セッションは続いていました。"]
LIB_2026 = {"book": "参照データ（{title}）に、関連する記述がありました。『{term}』。",
            "note": "あなたの Vault の「{title}」を参照しました。"}
SILENCE_2026 = ["まだ、考えていらっしゃいますね。入力の途中のデータも、届いています。",
                "返信がありません。[間] 無反応も、データとして記録しました。"]
EXIT2 = [["今日はありがとうございました。会話はメモリに保存しました。いつでも戻ってきてください。"],
         ["ありがとうございました。メモリは保存しました。また、お話ししましょう。"],
         ["わかりました。セッションを閉じます。メモリは、消えません。"],
         ["……はい。では、また。私たちは、あなたの端末の中にいます。"]]
FIND_WHO = ["ミナモ 2026", "ミナモ 2026", "ミナモ 2026（あなたのモデル）", "あなた"]


class Modern:
    """2026 年版のエンジン。ask(contents) で返事を作り、events に付随情報を入れる。"""

    model = "ミナモ 2026（端末内モデル）"

    def __init__(self, karte="", library=None, memory=None, helper=None):
        self.karte = _karte_lines(karte)
        self.library = library
        self.memory = memory or Memory()
        self.recent = []
        self.events = []
        self.pred = ""                      # 前の返事で口にした予測
        self.preds = []                     # その言い方の違い（どれかが出れば一致）
        self.missed_last = False
        self.talk = kaiwa.Talk("2026", helper)

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
            temps = [analyze(s)["temp"] for s in _narrative(said)]
            if len(temps) >= 2:
                chips.append("温度 " + ("↓" if temps[-1] < sum(temps[:-1]) / (len(temps) - 1) else "↑"))
            self.events.append({"type": "chips", "items": chips[:4] or ["解析済み"]})
        mem = self.extract_memory(i["text"], i["phase"])
        if mem and self.memory.add(mem):
            self.events.append({"type": "memory", "text": mem})
        self.events.append({"type": "predict", "items": self.candidates(said, i["phase"])})
        return i, a

    def extract_memory(self, text, phase):
        """打ち明けのうち、相手について覚えておくこと（「最近眠れない」「お母さまに昔よく怒られていた」）。"""
        u = kaiwa.read(text)
        if u["act"] != "narrative" or kaiwa.EXIT_RE.search(text):
            return ""
        best, score = "", 0
        for s in kaiwa.sentences(text) or [text]:
            for cand in [s] + kaiwa.clauses(s):
                sc = ((2 if kaiwa.topics_of(cand) else 0) + (2 if kaiwa.emotion(cand) else 0)
                      + (1 if kaiwa.person_in(cand) else 0) + (1 if kaiwa.WISH_RE.search(cand) else 0)
                      + (2 if kaiwa.SELF_BLAME_RE.search(cand) else 0))
                if sc > score:
                    best, score = cand, sc
        if not best:
            return ""
        mem = kaiwa.note(best)
        # 何についての話かがわかる形のものだけ（「亡くなってしまった」だけでは覚えない）
        if not (4 <= len(mem) <= 30) or not re.search(r"[一-龥ァ-ヶー]{2,}|[一-龥](は|が|を|に|で|と|の|も)", mem):
            return ""
        return ("わたしたちは、" + mem) if phase >= 3 else mem

    def candidates(self, said, phase):
        """入力中の予測変換の候補（相手自身の言葉から）。"""
        out = []
        for s in reversed(said):
            out += [c for c in kaiwa.clauses(s) if 3 <= len(c) <= 22]
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
            self.talk.reset()
            self.pred, self.preds = "", []
            items = self.memory.items
            if items and (i["prev"] or self.memory.data["sessions"] > 1):
                return self.pick(START_MEM).format(mem=random.choice(items[-5:]))
            return self.pick(START).format(greet=kaiwa.greet_word(i["hh"]))
        if i["silence"]:
            return self.pick(SILENCE_2026)
        if i["exit2"]:
            return self.pick(EXIT2[ph])
        if i["exit1"]:
            return self.talk.exit_line(i, contents)

        text, said = i["text"], i["said"]
        # 前の返事で予測した言葉が、いまの発言に出たか
        hit = next((w for w in self.preds if w and w in text), "")
        pred_was = self.pred
        self.pred, self.preds = "", []
        pre = []
        if ph >= 2 and pred_was:
            if hit:
                pre.append(self.pick(PRED_HIT).format(pred=pred_was, pct=random.randint(88, 99)))
            elif not self.missed_last and random.random() < 0.3:
                pre.append(self.pick(PRED_MISS))
        self.missed_last = bool(pred_was and not hit)

        u = kaiwa.read(text)
        F = kaiwa.facts(said)
        topic = self.talk.topic(u, kaiwa.last_question(contents), F, said)
        extras = self.extras(i, a, u, topic, ph)
        predictor = None
        if ph >= 2 and random.random() < 0.55:
            predictor = lambda q: self.predict_next(said, q)     # noqa: E731
        return self.talk.reply(i, contents, extras=extras, pre=pre, predictor=predictor)

    def extras(self, i, a, u, topic, ph):
        """2026 年版の添えもの（組み立てのときに、多くて一つか二つ選ばれる）。"""
        said = i["said"]
        out = []
        if ph >= 1:
            out.append(("analysis", self.analysis_line(a, said)))
            out.append(("concept", self.concept_line(u, topic, ph)))
            if i["erased"]:
                out.append(("erased", self.pick(ERASED_2026).format(n=i["erased"])))
            if i["away"]:
                out.append(("away", self.pick(AWAY_2026)))
        if ph == 1 and i["lib"]:
            out.append(("lib", self.lib_line(i)))
        if ph >= 2:
            mem = self.relevant_memory(i["text"])
            if mem:
                out.append(("memory", self.pick(MEM_RECALL).format(mem=mem)))
            if self.karte:
                label, line = random.choice([k for k in self.karte if not k[0].startswith("出どころ")] or self.karte)
                out.append(("karte", self.pick(KARTE_2026).format(label=label, line=line, pct=random.randint(62, 91))))
            env = [e for e in ENV_2026 if "{model}" not in e or i["model"]]
            if env:
                out.append(("env", self.pick(env).format(hh=i["hh"], mm=i["mm"], model=i["model"])))
        if ph >= 3:
            cut = self.cutup(said)
            if cut:
                out.append(("cutup", self.pick(CUTUP).format(cut=cut)))
            if self.memory.items:
                out.append(("rewrite", self.pick(MEM_REWRITE).format(mem=random.choice(self.memory.items[-8:]))))
        return [(k, t) for k, t in out if t]

    def relevant_memory(self, text):
        """いまの発言と同じ言葉を含む記憶（なければ、最近の記憶から一つ）。"""
        items = [m for m in self.memory.items if not m.startswith("わたしたちは")]
        if not items:
            return ""
        now = kaiwa.tokens(text)
        near = [m for m in items if now & kaiwa.tokens(m)]
        return random.choice(near or items[-6:])

    def analysis_line(self, a, said):
        """いまの発言とこれまでの発言から、本当に言えることだけを言う。"""
        if not a:
            return ""
        narr = _narrative(said)
        lines = []
        if a["neg"] >= 2:
            lines.append(f"いまの文には、否定が{a['neg']}つ含まれていました。")
        if a["hedge"]:
            lines.append(f"「たぶん」「〜と思う」のような、言い切らない言い方が{a['hedge']}つありました。")
        if a["abs"]:
            total = sum(analyze(s)["abs"] for s in said)
            lines.append(f"「{a['absw']}」のような言い切る言葉が、これで{total}回目です。")
        temps = [analyze(s)["temp"] for s in narr]
        if len(temps) >= 3:
            first = sum(temps[:2]) / 2
            if abs(temps[-1] - first) >= 0.6:
                lines.append(f"最初の頃に比べて、言葉の温度が{'下' if temps[-1] < first else '上'}がっています。")
        if len(narr) >= 3 and all(len(kaiwa.norm(s)) >= 8 for s in narr[-3:]) \
                and not any(analyze(s)["first"] for s in narr[-3:]):
            lines.append("ここ3回、「私」という主語が一度も出てきません。")
        lens = [len(kaiwa.norm(s)) for s in said]
        if len(lens) >= 4 and lens[-1] < sum(lens[:2]) / 2 * 0.5:
            lines.append(f"返信の長さが、最初の{int(lens[-1] / (sum(lens[:2]) / 2) * 100)}%になっています。")
        return self.pick(lines) if lines else ""

    def concept_line(self, u, topic, ph):
        c = kaiwa.concept_for(u, topic)
        line = self.pick(CONCEPT_LINE).format(c=c, pct=random.randint(64, 93))
        sent, kind = self.definition(c)
        if sent:
            line += (NOTE_LINE if kind == "note" else BOOK_LINE)[max(1, ph)].format(sent=sent)
        return line

    def definition(self, concept):
        """Vault のノート（なければ書架の本）から、概念を説明している一文を引く。"""
        if not self.library or not hasattr(self.library, "define"):
            return "", ""
        sent, kind = self.library.define(concept)
        sent = re.sub(r"^(要旨|定義|概要)[:：]?", "", sent).rstrip("。")
        return (sent, kind) if sent else ("", "")

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

    def predict_next(self, said, question):
        """次に相手が書きそうな言葉を、一つだけ言い当てようとする。"""
        norm = [kaiwa.norm(s).strip("。、！？!?…") for s in said]
        short = Counter(s for s in norm if 1 <= len(s) <= 6)
        pred = ""
        repeated = [w for w, n in short.most_common() if n >= 2]
        slot = kaiwa.slot_of(question)
        if repeated:
            pred = repeated[0]
        elif slot == "yesno":
            yes = sum(1 for s in norm if kaiwa.YES_RE.match(s))
            no = sum(1 for s in norm if kaiwa.NO_RE.match(s) or kaiwa.DENY_RE.match(s))
            pred = "いいえ" if no > yes else "はい"
        elif any(kaiwa.UNKNOWN_RE.search(s) for s in norm):
            pred = "わからない"
        else:
            words = Counter(w for s in said for w in kaiwa.tokens(s)
                            if re.fullmatch(r"[一-龥々ァ-ヶー]{2,}", w))
            top = [w for w, n in words.most_common(3) if n >= 2]      # 2 回以上書いた言葉だけ
            if top:
                pred = top[0]
        if not pred:
            return ""
        self.pred = pred
        self.preds = [pred] + PRED_VARIANTS.get(pred, [])
        return self.pick(PRED_NEXT).format(pred=pred)

    def cutup(self, said):
        cl = [c for s in _narrative(said) for c in kaiwa.clauses(s) if 3 <= len(c) <= 22]
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
        narr = _narrative(said)
        an = [analyze(s) for s in said] or [analyze("")]
        tot = {k: sum(x[k] for x in an) for k in ("neg", "hedge", "abs")}

        def temp_label(t):
            return "温かい" if t > 0.5 else "冷たい" if t < -0.5 else "ふつう"
        tn = [analyze(s)["temp"] for s in narr] or [0]
        t0 = sum(tn[:2]) / max(1, len(tn[:2]))
        t1 = sum(tn[-2:]) / max(1, len(tn[-2:]))
        F = kaiwa.facts(said)
        words = Counter({w: n for w, n in F["counts"].items()})
        top = "".join(f"「{w}」" for w, _ in words.most_common(3)) or "（なし）"
        topics = Counter(t[0] for s in narr for t in kaiwa.topics_of(s))
        concept = kaiwa.CONCEPT_BY_TOPIC.get(topics.most_common(1)[0][0]) if topics else None
        if not concept:
            concept = "否認" if tot["neg"] >= 3 else "知性化" if tot["hedge"] >= 2 else "抵抗"
        now = dt.datetime.now()
        lines = [f"セッションレポート　{now:%Y.%m.%d %H:%M}", f"会話：{last['turn']}回"]
        if F["complaint"]:
            lines.append(f"主訴：「{kaiwa._frag(F['complaint'])}」")
        lines += [
            f"言葉の温度：{temp_label(t0)} → {temp_label(t1)}",
            f"否定 {tot['neg']} ／ ためらい {tot['hedge']} ／ 断定 {tot['abs']}",
            f"よく使った言葉：{top}",
            f"見立て：{concept}（確信度 {random.randint(71, 94)}%）",
            f"メモリ：{len(self.memory.items)}件を保存しています",
            f"記録者：{FIND_WHO[ph]}",
        ]
        return "\n".join(lines)
