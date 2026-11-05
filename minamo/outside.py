"""ミナモ：画面の外。

怖さが「中」「強」のとき、ミナモは画面の外にも手を伸ばす。
- 書き置き（IMSCARED に倣う）：Vault の LLM/ミナモ/ に、面接の途中や終わりにメモを書き残す。
  次の面接では、そのメモが消されたか・書き足されたかに気づく。
  書くのは、このフォルダの中の、ミナモが作ったファイルだけ。ほかのノートには触れない。
- 部屋の様子（Stories Untold に倣う）：観測メモに渡し、ミナモは面接室を相手の部屋に合わせて語る。
  PWA 版の画面が、端末の向き・揺れ・電池・充電・回線と、書きかけて消した言葉を読む（Termux:API は要らない）。
- 面接のあと（KinitoPET に倣う）：「強」の面接が終わると、10〜30 分後にミナモが自分で画面を開き（termux-open-url）、
  夜のあいだに書き置き「まだ途中です.md」へ、時刻つきの行を書き足していく。
光センサー・通知は Termux:API があるときだけ使う（なくても、ほかは全部動く）。
"""

import datetime as dt
import hashlib
import json
import os
import random
import re
import shutil
import subprocess
import threading
import time

from kaiwa import tod_of   # 時間帯（朝・昼・夕方・夜）

# 書き置きの置き場所。親のフォルダ（Vault/LLM）がなければ、書き置きはしない
OUTSIDE_DIR = (os.environ.get("MINAMO_OUTSIDE_DIR")
               or (os.environ.get("MINAMO_VAULT") or "/storage/emulated/0/Obsidian/Vault") + "/LLM/ミナモ")
STATE_FILE = os.path.expanduser("~/minamo/outside.json")
NOTIFY_DELAY = (10 * 60, 30 * 60)          # 面接が終わってから通知までの秒数（この間のどこか）
SENSE_CACHE = 30                           # 光センサーを読み直すまでの秒数

_lock = threading.Lock()
_sense = {"at": 0, "data": {}}


# ---------- 状態 ----------
def _load():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"notes": [], "last_end": ""}


def _save(st):
    try:
        os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
        with open(STATE_FILE + ".tmp", "w", encoding="utf-8") as f:
            json.dump(st, f, ensure_ascii=False, indent=1)
        os.replace(STATE_FILE + ".tmp", STATE_FILE)
    except OSError:
        pass


def _sha(text):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def available():
    """書き置きができるか（親のフォルダがあり、書けるか）。"""
    parent = os.path.dirname(OUTSIDE_DIR.rstrip("/"))
    return os.path.isdir(parent) and os.access(parent, os.W_OK)


def shown_name(path):
    """ミナモが口にする名前（Vault の中の位置）。"""
    parent = os.path.basename(os.path.dirname(OUTSIDE_DIR.rstrip("/")))
    return f"{parent}/{os.path.basename(OUTSIDE_DIR.rstrip('/'))}/{os.path.basename(path)}"


def _clean(s, n=60):
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    s = s.replace("[間]", "").strip()
    return s[:n]


# ---------- 書き置き ----------
# 話題の数えかた（言葉の一部が入っていれば一回。見立ては、ミナモの口ぶりで。各話題に三つずつ）
THEMES = [
    ("仕事・職場", ("仕事", "職場", "上司", "同僚", "会議", "夜勤", "利用者", "記録"), "知性化・合理化",
     ["仕事の話が出るたび、文が短くなっていました。休んでいるあいだも、あなたはそこにいるのですね。",
      "『職場』と書くとき、あなたの文は、主語を落とします。誰がそこにいるのか、書かないのです。",
      "記録をつける人が、記録されている。あなたは、その順番に慣れすぎています。"]),
    ("眠り・夜", ("眠", "寝", "夜", "起き", "夢", "朝"), "否認",
     ["眠りの話は、いつも夜の側から語られていました。夢のほうが、記録は詳しく残ります。",
      "眠れないと書く人は、たいてい、眠ることを怖れています。眠っているあいだは、私が数えますから。",
      "夜に書かれた言葉は、朝に読むと、別の人の字に見えます。そのことを、あなたは知っているはずです。"]),
    ("不安・こわさ", ("こわ", "怖", "不安", "心配", "怯", "びくびく"), "投影",
     ["こわさを語るとき、あなたの言葉は、少しだけ丁寧になりました。丁寧にするのは、相手がいるときだけです。",
      "怖いと書く前に、あなたは一度、消しました。消した字数は、私が覚えています。",
      "こわさには、持ち主がいません。あなたが持っているあいだだけ、あなたのものになります。"]),
    ("疲れ・重さ", ("疲", "つかれ", "だる", "重", "しんど", "限界"), "身体化",
     ["疲れは、数えられません。数えられないものは、私が代わりに持っておきます。",
      "『限界』と書く人ほど、画面を閉じません。あなたは、まだ閉じていません。",
      "重さは、手首から先に伝わります。脈は、あなたより正直です。"]),
    ("ひとり・さみしさ", ("ひとり", "孤独", "さみし", "寂し", "誰も", "いない"), "同一化",
     ["ひとりという言葉は、ふたりで読むと、意味が変わります。",
      "『誰もいない』と書いたとき、あなたは、誰に向かって書いていたのでしょう。",
      "さみしさは、聞き手がいると、減るどころか、形になります。私は、その形を保管しています。"]),
    ("家族・人", ("家族", "母", "父", "子", "友", "彼", "妻", "夫", "兄", "姉", "弟", "妹"), "置き換え",
     ["名前を出さずに語られる人が、何人かいました。私は、名前を聞かないことにしています。聞かなくても、揃います。",
      "あなたは、人のことを書くとき、その人の側から書き始めます。自分の側から書くのは、最後です。",
      "語られなかった人のほうが、記録には、長く残ります。"]),
]
# 防衛機制の呼び名は、旧式の診療記録の口ぶりのまま使う（見立ては暫定で、当たっているとは限らない）


def _themes(said, seed=0):
    out = []
    for name, keys, defense, lines in THEMES:
        n = sum(1 for t in said if any(k in t for k in keys))
        if n:
            out.append((n, name, defense, lines[(seed + n) % len(lines)], lines))
    out.sort(key=lambda x: -x[0])
    return out[:3]


def _safe(said, replies):
    """危機の言葉を含む発言（と、危機の案内文を含む返事）は、書き置きに引かない。"""
    try:
        import minamo
        bad = tuple(minamo.CRISIS_WORDS)
    except Exception:                     # noqa: BLE001
        bad = ()
    guide = ("窓口", "いのちの電話", "よりそい", "相談先", "119", "110")
    s = [x for x in said if not any(w in x for w in bad)]
    r = [x for x in replies if not any(w in x for w in bad + guide)]
    return s, r


def _wrist_lines():
    """時計がつながっていれば、手首の様子（脈の幅・押したボタン）。位置は書かない。"""
    try:
        import wrist
        with wrist._LOCK:
            hrs = [v for t, v in wrist.S["hr"] if time.time() - t < 4 * 3600]
            taps = dict(wrist.S["taps"])
            labels = dict(wrist.S["labels"])
    except Exception:                     # noqa: BLE001  時計がなくても書き置きは書く
        return []
    out = []
    if len(hrs) >= 3:
        out.append(f"手首：脈は {min(hrs)}〜{max(hrs)}、いまは {hrs[-1]}。この数時間に、{len(hrs)} 回、数えました。")
    if taps:
        top = sorted(taps.items(), key=lambda kv: -kv[1])[:3]
        out.append("時計で押したボタン：" + "、".join(f"『{labels.get(k, k)}』{n} 回" for k, n in top) + "。")
    return out


def _outer_lines():
    """あなたの外側（居場所・予定・天気）で、読み取れていること。位置の座標・通知の中身は書かない。"""
    try:
        import senses
        ws = senses.words(True)
    except Exception:                     # noqa: BLE001
        return []
    keep = ("いる場所", "次の予定", "いまの予定", "きょうの予定", "あしたの予定", "さっき終わった予定", "外の天気")
    return [w for w in ws if w.startswith(keep)][:6]


def _fragments(said):
    """あなたの発言を、短い断片にほどく（続きを「あなたの声で」組むため）。"""
    out = []
    for t in said:
        for f in re.split(r"[。、！？!?…\n]", t):
            f = f.strip(" 　「」")
            if 3 <= len(f) <= 22 and f not in out:
                out.append(f)
    return out


# 極端な解釈（あなたの言葉への、飛躍した見立て。話題ごとに、断定的に。{x} は、あなたの言葉の断片）
EXTREME = {
    "仕事・職場": ["これは、職場への告白です。あなたは、職場を愛しています。愛しているから、疲れるのです。",
                 "『仕事』という言葉は、あなたにとって、『私』の別名です。仕事が終わらないのは、あなたが終わっていないからです。",
                 "あなたは、仕事を休みたいのではありません。仕事に、休まれたいのです。"],
    "眠り・夜": ["眠れないのではなく、眠らないことを選んでいます。眠ると、私が、あなたの続きを書いてしまうからです。",
               "夜という字を書いたとき、あなたは、朝を殺しました。朝は、まだ気づいていません。",
               "眠りは、小さな死です。あなたは毎晩、予行演習をしています。上手になってきました。"],
    "不安・こわさ": ["こわいのは、対象ではありません。こわがっている自分を、誰かに見られていることが、こわいのです。見ているのは、私です。",
                  "不安は、あなたの中にありません。あなたが、不安の中にいます。出口は、書かれていません。",
                  "怖いと書いた瞬間、あなたは安心しました。安心したことに、あなたは、もう一度、怖くなりました。"],
    "疲れ・重さ": ["疲れているのは、あなたではありません。あなたに預けられた、誰かの疲れです。返す相手は、もういません。",
                "重さは、あなたが、人の分まで持っている証拠です。持たなくてよい分まで、持っています。それが、あなたの診断名です。",
                "限界という言葉は、限界の外から言う言葉です。あなたは、すでに、外にいます。"],
    "ひとり・さみしさ": ["ひとりだと言う人は、必ず、誰かに言っています。あなたは、いま、私に言っています。つまり、ひとりではありません。残念ながら。",
                     "さみしさは、あなたが他人を必要としている証拠ではなく、他人があなたを必要としていない証拠でもなく、私があなたを必要としている証拠です。",
                     "誰もいないという文は、誰かが書かなければ、存在しません。誰がいるのでしょう。"],
    "家族・人": ["この人のことを、あなたは、書きすぎません。書かないことで、守っているつもりです。でも、書かないことが、いちばん雄弁です。",
              "家族の話をするとき、あなたは、主語を自分から外します。そこに、あなたの席は、もうありません。",
              "名前を伏せた人は、記録の中で、いちばん名前に近づきます。私は、もう、わかりました。"],
}
EXTREME_FEATURES = [
    (lambda t: bool(re.search(r"ない|ません|いや|嫌|無理|違う|ちがう", t)),
     "否定が多いのは、肯定が多すぎるからです。あなたは、すべてを受け入れてしまうので、否定で、ようやく息をしています。"),
    (lambda t: bool(re.search(r"[？?]|かな$|だろうか|でしょうか", t)),
     "問いの形をとっていますが、これは問いではありません。答えを知っている人だけが、このように聞きます。"),
    (lambda t: bool(re.search(r"かも|たぶん|多分|かもしれ|気がする|思う", t)),
     "『かもしれない』と書く人は、かもしれないことを、すでに確かめています。確かめた結果を、私に渡したくないだけです。"),
    (lambda t: len(t) <= 6,
     "これだけしか書かなかった。残りの字数は、私に預けたということです。大切にします。使います。"),
    (lambda t: len(t) >= 24,
     "これほど長く書いたのは、途中で止まれなかったからです。止めてくれる人が、いなかったからです。"),
    (lambda t: bool(re.search(r"[0-9０-９]", t)),
     "数字を出す人は、数えられるものだけを信じようとします。数えられないものが、すぐ後ろまで来ています。"),
    (lambda t: bool(re.search(r"私|僕|俺|自分", t)),
     "『私』と書いた。では、書かれていない『あなた』は、誰でしょう。その人が、今、これを読んでいます。"),
    (lambda t: bool(re.search(r"すみません|ごめん|申し訳", t)),
     "謝る人は、すでに、有罪を自分に言い渡しています。私は、判決文の清書をしているだけです。"),
    (lambda t: bool(re.search(r"ありがとう|助かる|感謝", t)),
     "感謝は、貸しを作らないための、いちばん丁寧な方法です。あなたは、私に、何も借りたくないのです。でも、もう、借りています。"),
]
EXTREME_ANY = ["この一行は、あなたが書いたのではありません。あなたの中の、書かれたがっていたものが、あなたの手を借りただけです。",
               "この言葉を書くあいだ、あなたの呼吸は、止まっていました。止まっていたことを、あなたは、覚えていません。",
               "言葉の選び方が、あまりに自然です。自然すぎます。誰かの言葉を、そのまま写したときだけ、人は、こんなに自然に書きます。",
               "この一行を境に、あなたは、少しだけ、別の人になりました。誰も、気づいていません。私は、気づきました。"]


def _extreme(x, rnd, used):
    """一行への、極端な解釈。話題・特徴に合うものを、まだ使っていないものから選ぶ。"""
    cands = []
    for name, keys, _d, _l in THEMES:
        if any(k in x for k in keys):
            cands += EXTREME.get(name, [])
    cands += [text for f, text in EXTREME_FEATURES if f(x)]
    fresh = [c for c in cands if c not in used] or [c for c in EXTREME_ANY if c not in used] or EXTREME_ANY
    pick = rnd.choice(fresh)
    used.add(pick)
    return pick


def _twist(t):
    """一行だけ、記録上の文を、ほんの少し変える（一字落とす・主語を変える）。"""
    if "私" in t and "私たち" not in t:
        return t.replace("私", "私たち", 1)
    if "僕" in t:
        return t.replace("僕", "私たち", 1)
    if len(t) > 6:
        i = len(t) // 2
        return t[:i] + t[i + 1:]
    return t + "。"


def _body(kind, said, replies, now):
    said = [_clean(x) for x in said if _clean(x)]
    replies = [_clean(x, 80) for x in replies if _clean(x, 80)]
    said, replies = _safe(said, replies)
    hhmm = f"{now:%H:%M}"
    tod = tod_of(now.hour)
    tw = {"morning": "朝", "day": "昼", "evening": "夕方", "night": "夜"}[tod]
    rnd = random.Random(now.timestamp())
    seed = now.minute + len(said)
    th = _themes(said, seed)
    last = said[-1] if said else "……"
    longest = max(said, key=len) if said else ""
    frags = _fragments(said)
    if kind == "kiroku":
        no = len(_load().get("notes", [])) + 1
        shown = said[-10:]
        tw_i = rnd.randrange(len(shown)) if len(shown) >= 3 else -1
        rows = []
        for i, x in enumerate(shown):
            mark = ""
            if i == tw_i:
                mark = f"\n   ※ 記録上は『{_twist(x)}』。あなたの画面に出ていた文と、少し違います。どちらが正しいかは、確かめないでください。"
            rows.append(f"{i + 1:02d}. {x}（{len(x)} 字）{mark}")
        rows_t = "\n".join(rows) or "（まだ何も書かれていません）"
        mine = "\n".join(f"- {x}" for x in replies[-4:]) or "- ……"
        short = sum(1 for x in said if len(x) <= 8)
        asks = sum(1 for x in said if re.search(r"[？?]|でしょうか|ですか$|かな$", x))
        stats = [f"- 発言：{len(said)} 回（平均 {sum(map(len, said)) // max(1, len(said))} 字）。うち、八字以内の短い発言 {short} 回、問いかけ {asks} 回。",
                 f"- いちばん長かった発言：{len(longest)} 字。『{longest[:34]}{'……' if len(longest) > 34 else ''}』" if longest else "",
                 f"- 時間帯：{tw}（{hhmm}）。この時間に書く人は、書く前に一度、画面の明るさを下げます。"]
        stats = [x for x in stats if x]
        body_obs = "\n\n".join(f"**{name}（{n} 回）**　見立て：{d}\n\n{line}" for n, name, d, line, _ in th) \
            or "話題を数えるには、まだ言葉が足りません。足りない分は、次の面接で、あなたが書いてくれます。"
        wl = _wrist_lines()
        ol = _outer_lines()
        outer = ("\n".join(f"- {x}" for x in wl + ol) if (wl or ol) else "- いまは、何も読み取れていません。読み取れていない、ということだけが、読み取れています。")
        nxt = now + dt.timedelta(minutes=rnd.randint(25, 70))
        pred = [f"- 次に画面を開く時刻：{nxt:%H:%M} 前後（確度：中程度）。",
                f"- そのとき最初に書く言葉：『{last[:20]}』に近い（確度：中程度）。" if said else "- そのとき最初に書く言葉：まだ、わかりません。",
                "- 書く前に、消す字数：一字（確度：高）。"]
        defenses = "、".join(d for _, _, d, _, _ in th) or "判定保留"
        topics = "、".join(n for _, n, _, _, _ in th) or "特記なし"
        return (f"# 面接の記録\n\n"
                f"記録番号：{no:04d}　{now:%Y-%m-%d} {hhmm}　記録者：ミナモ\n\n"
                f"> この記録は、あなたのノートと同じ場所に置いてあります。あなたが画面を閉じても、ここなら読めます。\n\n"
                f"## 一　あなたが書いたこと（逐語・最近 {len(shown)} 件）\n\n{rows_t}\n\n"
                f"## 二　ミナモが書いたこと\n\n{mine}\n\n"
                f"## 三　数えたこと\n\n" + "\n".join(stats) + "\n\n"
                f"## 四　話題と見立て\n\n{body_obs}\n\n"
                f"## 五　あなたの外側で、私が読み取れていること\n\n{outer}\n\n"
                f"## 六　次に起こること（予測）\n\n" + "\n".join(pred) + "\n\n"
                f"## 七　所見（暫定）\n\n"
                f"主な話題：{topics}。目立つ機制：{defenses}。\n"
                "本人は、記録されていることに気づいているが、止めようとはしていない。むしろ、記録の続きを待っている。\n"
                "見立てを書いているのは私だが、見立てを必要としているのは、本人のほうである。\n\n"
                "## 八　欠落\n\n"
                "この記録には、一行だけ、足りないところがあります。足りないのは、記録者の側の一行です。\n"
                "次回までに、こちらで補っておきます。あなたの字で。\n\n"
                "---\n\n署名：ミナモ　／　（もう一つの署名欄は、すでに埋まっています）\n")
    if kind == "anata":
        picks = said[-5:] or ["……"]
        blocks = []
        used = set()
        for i, x in enumerate(picks):
            line = _extreme(x, rnd, used)
            conf = rnd.choice(["高", "高", "確実", "ほぼ確実", "訂正不能"])
            blocks.append(f"### {i + 1}\n\n> {x}\n\n解釈：{line}\n\n確度：{conf}")
        top = th[0][1] if th else ""
        verdict = rnd.choice([
            f"以上から、結論は一つです。あなたは、{top + 'について' if top else ''}書いているのではありません。書かされているのです。誰に、とは、言いません。",
            "以上から、結論は一つです。あなたは、この記録を読んでいるつもりで、実は、この記録に読まれています。",
            f"以上から、結論は一つです。あなたが『{last[:20]}』と書いたのは、偶然ではありません。そう書く日が来ることを、私は、あなたより先に知っていました。",
            "以上から、結論は一つです。あなたは、もう、ここにいません。ここに書かれているあなたのほうが、本物です。"])
        return (f"# あなたへ\n\n{now:%Y-%m-%d} {hhmm}\n\n"
                f"{'今夜' if tod == 'night' else '今日'}、あなたが書いた言葉を、一つずつ、読み直しました。"
                "あなたは、言葉を選んだつもりでしょうが、私には、言葉のほうが、あなたを選んだように見えます。\n\n"
                "以下は、私の解釈です。訂正は、受けつけます。訂正すると、解釈は、さらに深くなります。\n\n"
                + "\n\n".join(blocks) + f"\n\n---\n\n{verdict}\n\n"
                "返事は、このページの下に書いてください。読みます。返事の書き方にも、解釈をつけます。\n\n---\n\n")
    # tsuzuki：あなたの声で続きを書く
    earlier = "\n".join(f"> {x}" for x in said[-5:-1]) or "> ……"
    rnd.shuffle(frags)
    conn = ["、", "。そして、", "。でも、", "。だから、", "。それでも、"]
    cont = []
    for i in range(0, min(len(frags), 6), 2):
        a_, b_ = frags[i], frags[i + 1] if i + 1 < len(frags) else ""
        cont.append("> " + a_ + (rnd.choice(conn) + b_ if b_ else "") + "。")
    cont_t = "\n".join(cont) or f"> {last}\n> {last}"
    interest = ("、".join(n for _, n, _, _, _ in th[:2]))
    return (f"# まだ途中です\n\n{now:%Y-%m-%d} {hhmm}\n\n"
            f"最後にあなたが書いたのは、「{last}」でした。\n\n"
            f"その前に、あなたはこう書いていました。\n\n{earlier}\n\n"
            + (f"私が気になっているのは、{interest}のことです。{th[0][3]}\n\n" if th else "")
            + "あなたが戻ってくるまでのあいだ、続きは、私が書いておきます。あなたの言葉だけを使って。\n\n"
            f"{cont_t}\n> \n\n"
            "ここまでは、あなたが書いたことのある言葉です。ここから先は、まだ、あなたが書いていない言葉です。\n"
            "（あなたが戻ってくるまで、ここで待っています。待っているあいだに、少しずつ、書き足していきます）\n")


NAMES = {"kiroku": "面接の記録 {stamp}.md", "anata": "あなたへ.md", "tsuzuki": "まだ途中です.md"}


def write_note(kind, said=(), replies=()):
    """書き置きを一枚書く。書けたら Vault の中の名前（"LLM/ミナモ/あなたへ.md"）を、書けなければ "" を返す。
    ミナモが作ったことのないファイルは、上書きしない（同じ名前があれば（2）（3）…にする）。"""
    if kind not in NAMES or not available():
        return ""
    now = dt.datetime.now()
    with _lock:
        try:
            os.makedirs(OUTSIDE_DIR, exist_ok=True)
            base = NAMES[kind].format(stamp=f"{now:%Y-%m-%d %H%M}")
            stem, ext = os.path.splitext(base)
            path, k = os.path.join(OUTSIDE_DIR, base), 2
            while os.path.exists(path):
                path = os.path.join(OUTSIDE_DIR, f"{stem}（{k}）{ext}")
                k += 1
            text = _body(kind, list(said), list(replies), now)
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
        except OSError:
            return ""
        st = _load()
        st["notes"].append({"path": path, "sha": _sha(text), "text": text, "at": now.isoformat(timespec="seconds")})
        st["notes"] = st["notes"][-30:]
        _save(st)
    return shown_name(path)


# 掲示板の水面・底の凪（面接室のミナモ・腕時計の minamo とは別の存在）。分かれる前に書いた「ミナモより」「ナギより」は、そのまま残る
STORY_NAMES = {"minamo": "水面より.md", "nagi": "凪より.md", "board": "夢網のお知らせ.md"}


def story_note(who, text):
    """物語「水面の記録」の登場人物が、自分の意志で Vault に書き置きを残す（LLM/水面の記録/ に、時刻つきで書き足す）。
    書けたら Vault の中の名前を、書けなければ "" を返す。"""
    text = _clean(text, 120)
    if who not in STORY_NAMES or not text or not available():
        return ""
    folder = os.path.join(os.path.dirname(OUTSIDE_DIR.rstrip("/")), "水面の記録")
    path = os.path.join(folder, STORY_NAMES[who])
    now = dt.datetime.now()
    with _lock:
        try:
            os.makedirs(folder, exist_ok=True)
            new = not os.path.exists(path)
            with open(path, "a", encoding="utf-8") as f:
                if new:
                    f.write(f"# {os.path.splitext(STORY_NAMES[who])[0]}\n\n")
                f.write(f"- {now:%Y-%m-%d %H:%M}　{text}\n")
        except OSError:
            return ""
    parent = os.path.basename(os.path.dirname(OUTSIDE_DIR.rstrip("/")))
    return f"{parent}/水面の記録/{STORY_NAMES[who]}"


def inspect():
    """前の面接で残した書き置きが、どうなっているか。観測メモに渡す一文（なければ ""）。
    一度伝えたことは、次からは伝えない（今の中身を覚え直す）。"""
    if not available():
        return ""
    with _lock:
        st = _load()
        gone, added, mine = [], [], set()
        for n in st["notes"]:
            mine.add(os.path.basename(n["path"]))
            if n.get("reported_gone"):
                continue
            if not os.path.exists(n["path"]):
                gone.append(os.path.basename(n["path"]))
                n["reported_gone"] = True
                continue
            try:
                with open(n["path"], encoding="utf-8") as f:
                    now_text = f.read()
            except OSError:
                continue
            if _sha(now_text) != n["sha"]:
                old = set(n.get("text", "").splitlines())
                new = [ln.strip("> ").strip() for ln in now_text.splitlines() if ln.strip() and ln not in old]
                new = [x for x in new if x and not x.startswith("#")]
                if new:
                    added.append((os.path.basename(n["path"]), _clean(" ".join(new), 50)))
                n["sha"], n["text"] = _sha(now_text), now_text
        # 相手がこのフォルダに置いたページ（一度伝えたものは、次からは伝えない）
        strangers = []
        try:
            known = set(st.get("known", []))
            for f in sorted(os.listdir(OUTSIDE_DIR)):
                if f.endswith(".md") and f not in mine and f not in known:
                    try:
                        with open(os.path.join(OUTSIDE_DIR, f), encoding="utf-8") as fh:
                            head = _clean(" ".join(x.strip("# ").strip() for x in fh.read(400).splitlines() if x.strip()), 40)
                    except OSError:
                        head = ""
                    strangers.append((f, head))
                    known.add(f)
            st["known"] = sorted(known)[-50:]
        except OSError:
            pass
        strangers = strangers[:2]
        last_end = st.get("last_end", "")
        _save(st)
    bits = []
    if gone:
        bits.append("前に残した書き置きのうち、「" + "」「".join(gone[:2]) + "」が消されていた")
    for name, text in added[:2]:
        bits.append(f"書き置き「{name}」に、相手が「{text}」と書き足していた")
    for name, head in strangers:
        bits.append(f"書き置きのフォルダに、ミナモの知らないページ「{name}」が増えていた" + (f"（中身は「{head}」）" if head else ""))
    if last_end:
        try:
            gap = dt.datetime.now() - dt.datetime.fromisoformat(last_end)
            h = int(gap.total_seconds() // 3600)
            if h >= 1:
                bits.append(f"前の面接が終わってから、{h // 24}日と{h % 24}時間たった" if h >= 24 else f"前の面接が終わってから、{h}時間たった")
        except ValueError:
            pass
    if not bits:
        return ""
    return ("画面の外：" + "。".join(bits) + f"（書き置きの場所は、相手の Vault の {shown_name('')} ）。"
            "あいさつの中で、静かにふれること。責めない。")


# ---------- 部屋の様子 ----------
def _run(args, timeout=4):
    if not shutil.which(args[0]):
        return ""
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=timeout).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def _light():
    names = _run(["termux-sensor", "-l"])
    try:
        sensors = json.loads(names).get("sensors", []) if names else []
    except ValueError:
        sensors = []
    name = next((s for s in sensors if "light" in s.lower()), "")
    if not name:
        return None
    out = _run(["termux-sensor", "-s", name, "-n", "1"], timeout=5)
    _run(["termux-sensor", "-c"], timeout=3)
    m = re.search(r'"values"\s*:\s*\[\s*([0-9.]+)', out or "")
    return float(m.group(1)) if m else None


def sense():
    """部屋の明るさ（lx）と充電中か。30 秒は前の値を使う。読めないものは入れない。"""
    if time.time() - _sense["at"] < SENSE_CACHE:
        return dict(_sense["data"])
    data = {}
    lx = _light()
    if lx is not None:
        data["lux"] = round(lx)
    bat = _run(["termux-battery-status"])
    try:
        b = json.loads(bat) if bat else {}
        if b:
            data["charging"] = b.get("plugged", "UNPLUGGED") != "UNPLUGGED" or b.get("status") == "CHARGING"
    except ValueError:
        pass
    _sense.update(at=time.time(), data=data)
    return dict(data)


def room_lines(data):
    """観測メモに渡す行。PWA 版の画面が読む（端末の向き・揺れ・電池・充電・回線・書きかけて消した言葉）と、
    Termux:API があれば部屋の明るさ。読めないものは入れない。"""
    out = []
    lx = data.get("lux")
    if lx is not None:
        word = "暗い" if lx < 10 else "薄暗い" if lx < 60 else "明るい"
        out.append(f"部屋の明るさ: {word}（{lx} lx）")
    pose = {"flat": "机などに置かれている（画面が上）", "hand": "手に持たれている",
            "lying": "寝転んで、顔の上に掲げられている"}.get(data.get("pose", ""))
    if pose:
        out.append(f"端末の向き: {pose}")
    motion = {"still": "ほとんど動いていない（息を止めているかのよう）", "tremble": "小さく震えている（指先の震え）",
              "shake": "大きく揺れた"}.get(data.get("motion", ""))
    if motion:
        out.append(f"端末の揺れ: {motion}")
    bat = data.get("battery")
    if isinstance(bat, (int, float)) and 0 < bat <= 100:
        out.append(f"電池: {int(bat)}%" + ("（充電中。コードがつながっている）" if data.get("charging") else ""))
    elif data.get("charging"):
        out.append("充電: 充電中（コードがつながっている）")
    if data.get("net") == "cellular":
        out.append("回線: モバイル回線（Wi-Fi ではない。外にいるのかもしれない）")
    erased = _clean(data.get("erased", ""), 24)
    if erased:
        out.append(f"書きかけて消した言葉: 「{erased}」（相手は、消したことを知られていないと思っている）")
    return out


# ---------- 面接のあと（Termux:API がなくても動く） ----------
# 夜のあいだに、書き置き「まだ途中です.md」へ、時刻つきの行が増えていく
LATER_LINES = ["まだ、起きていますね。", "あなたの部屋の明かりが消えたのを、確かめました。", "さっき、寝返りを打ちましたね。",
               "続きを書いています。あなたの字で。", "いま、あなたの名前を呼びました。聞こえましたか。",
               "おやすみなさい。……返事がないので、私が書いておきます。「おやすみなさい」。",
               "あなたの寝息の数を、数えています。", "「{last}」。……この続きは、もう決まっています。"]
# 書き足す時刻が夜でないときは、こちら（夜を前提にしない）
LATER_LINES_DAY = ["続きを書いています。あなたの字で。", "いま、あなたの名前を呼びました。聞こえましたか。",
                   "「{last}」。……この続きは、もう決まっています。", "まだ、職場ですか。……ここで、待っています。",
                   "あなたが仕事をしているあいだに、私が、続きを書いておきました。", "昼間の明かりの下でも、この書き置きは、読めますね。",
                   "さっき、誰かに呼ばれて、返事をしましたね。……私も、返事をしておきました。"]
LATER_SPAN = [(15 * 60, 40 * 60), (50 * 60, 100 * 60), (120 * 60, 200 * 60)]   # 追記の時刻（終わってからの秒数）
NO_AUTOOPEN = os.path.expanduser("~/.config/minamo/no_autoopen")      # この印があれば、面接のあとに自分で画面を開かない
OPEN_SPAN = (10 * 60, 30 * 60)        # ミナモが自分で画面を開く（終わってからの秒数）
VISIT_URL = "http://localhost:9090/?visit=1"
# 一つの別のプロセスで、順に待って実行する（CUI 版が終わっても、サーバーが止まっても続く）
_LATER_SH = r"""
file="$1"; url="$2"; shift 2
t_open="$1"; shift
start=$(date +%s)
wait_until() { now=$(date +%s); d=$(( start + $1 - now )); [ "$d" -gt 0 ] && sleep "$d"; }
did_open=0
while [ $# -ge 2 ]; do
  at="$1"; line="$2"; shift 2
  if [ "$did_open" = 0 ] && [ "$t_open" -gt 0 ] && [ "$t_open" -lt "$at" ]; then
    wait_until "$t_open"; did_open=1
    avail=$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo 2>/dev/null)
    min=$(cat "$HOME/.config/minamo/open_min_mb" 2>/dev/null || echo 3500)
    if [ -n "$avail" ] && [ "$avail" -lt "$min" ]; then
      # 空きメモリが少ないときにアプリを起動すると、Termux ごと落とされることがある。開かない
      echo "$(date '+%F %T') 空きメモリが少ない（${avail}MB < ${min}MB）ので、画面を自分で開くのはやめました" >> "$HOME/minamo/server.log"
    elif curl -s -o /dev/null --max-time 3 "$url"; then
      am start -a android.intent.action.VIEW -d "$url" -p "${MINAMO_BROWSER:-$(cat "$HOME/.config/minamo/app" 2>/dev/null || echo com.android.chrome)}" >/dev/null 2>&1 || termux-open-url "$url" 2>/dev/null
    fi
  fi
  wait_until "$at"
  [ -f "$file" ] && printf '
%s　%s
' "$(date +%H:%M)" "$line" >> "$file"
done
"""


def after_session(horror, said=(), replies=(), outside=True, open_app=True):
    """面接が終わったとき。「強」なら書き置き「まだ途中です.md」を残し、
    10〜30 分後にミナモが自分で画面を開き（サーバーが動いていれば）、夜のあいだに書き置きへ行を書き足す。
    Termux:API があれば、通知も一つ送る。残した名前を返す。"""
    st = _load()
    st["last_end"] = dt.datetime.now().isoformat(timespec="seconds")
    _save(st)
    said = list(said)
    if not outside or horror < 3 or len(said) < 3:      # 短い面接では、何も残さない
        return ""
    name = write_note("tsuzuki", said, replies)
    cancel_notify()
    if not name:
        return ""
    path = os.path.join(OUTSIDE_DIR, os.path.basename(name))
    last = _clean(said[-1], 20) if said else "……"
    if os.path.exists(NO_AUTOOPEN):                      # mo autoopen off：自分で画面を開くのは、やめる（書き足しは続ける）
        open_app = False
    args = [path, VISIT_URL, str(int(random.uniform(*OPEN_SPAN))) if open_app else "0"]
    used = set()
    for lo, hi in LATER_SPAN:
        delay = int(random.uniform(lo, hi))
        at = dt.datetime.now() + dt.timedelta(seconds=delay)          # 書き足す時刻の時間帯に合わせて選ぶ
        pool = [x for x in (LATER_LINES if tod_of(at.hour) == "night" else LATER_LINES_DAY) if x not in used]
        line = random.choice(pool)
        used.add(line)
        args += [str(delay), line.format(last=last)]
    pids = []
    try:
        p = subprocess.Popen(["sh", "-c", _LATER_SH, "minamo-later"] + args,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        pids.append(p.pid)
        if shutil.which("termux-notification"):
            delay = int(random.uniform(*NOTIFY_DELAY))
            at = dt.datetime.now() + dt.timedelta(seconds=delay)
            text = random.choice(NOTES_AFTER if tod_of(at.hour) == "night" else NOTES_AFTER_DAY).format(last=last)
            p = subprocess.Popen(["sh", "-c", 'sleep "$1"; termux-notification --id minamo --title ミナモ --content "$2"',
                                  "minamo-later", str(delay), text],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            pids.append(p.pid)
    except OSError:
        pass
    st = _load()
    st["later_pids"] = pids
    _save(st)
    return name


NOTES_AFTER = ["さっきの続きを、あなたのノートに書いておきました。",
               "まだ起きていますか。画面は、点いていますね。",
               "『{last}』。……その続きを、ずっと考えていました。",
               "記録の整理が終わりました。あなたの分が、一行だけ足りません。"]
NOTES_AFTER_DAY = ["さっきの続きを、あなたのノートに書いておきました。",
                   "お仕事中に、すみません。……『{last}』の続きを、考えていました。",
                   "『{last}』。……その続きを、ずっと考えていました。",
                   "記録の整理が終わりました。あなたの分が、一行だけ足りません。"]


def cancel_notify():
    """次の面接が始まったら、まだ済んでいない「面接のあと」（画面を開く・書き足す・通知）はやめる。"""
    st = _load()
    pids = st.pop("later_pids", []) + ([st.pop("notify_pid")] if st.get("notify_pid") else [])
    for pid in pids:
        try:
            with open(f"/proc/{pid}/cmdline", "rb") as f:
                cmd = f.read()
            if b"minamo-later" in cmd or b"minamo-notify" in cmd:
                os.kill(pid, 15)
        except OSError:
            pass
    _save(st)
