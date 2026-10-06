#!/usr/bin/env python3
"""zork-ja: 英語版 Zork I を日本語で遊ぶためのラッパー。

dfrotz（文字だけの Z マシン）を裏で動かし、
- ゲームの出力を辞書で日本語にして表示する
- 日本語の命令を英語の命令に直してゲームに渡す
辞書にない文は英語のまま表示する。
"""
import os
import re
import select
import shutil
import subprocess
import sys
import time

try:
    import readline  # noqa: F401  入力欄で矢印キーや履歴を使えるようにする
except ImportError:
    pass

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
HOME_DIR = os.path.expanduser("~/.zork-ja")

STATUS_RE = re.compile(r"^\s*(.*?)\s{2,}Score:\s*(-?\d+)\s+Moves:\s*(\d+)\s*$")
SENT_RE = re.compile(r'(?<=[.!?])\s+(?=[A-Z"(\[])|(?<=[.!?]")\s+')

HELP = """\
【遊び方】日本語か英語で命令を入力します。
  移動 : 北 / 南 / 東 / 西 / 北東 … / 上 / 下 / 中 / 外（「北へ行く」でも可）
  例   : 郵便受けを開ける / チラシを読む / ランプをつける / 全部取る
         剣でトロールを攻撃 / 袋をテーブルに置く→「袋を置く」
  特殊 : 見る（周りを見る） / 持ち物 / 待つ / 得点 / セーブ / ロード / 終了
  表示 : :both … 日本語と英語を併記（はじめはこれ）
         :ja … 日本語だけ　　:en … 英語だけ
  ほか : :help … この説明
英語の命令（open mailbox など）はそのまま渡します。
"""

SPECIAL = {
    "見る": "look", "みる": "look", "周りを見る": "look", "まわりを見る": "look",
    "見回す": "look", "見わたす": "look", "見渡す": "look", "あたりを見る": "look",
    "持ち物": "inventory", "もちもの": "inventory", "所持品": "inventory",
    "持ち物を見る": "inventory", "持ち物を確認": "inventory", "アイテム": "inventory",
    "待つ": "wait", "まつ": "wait", "待機": "wait",
    "得点": "score", "スコア": "score", "点数": "score",
    "セーブ": "save", "保存": "save", "保存する": "save",
    "ロード": "restore", "再開": "restore", "続きから": "restore",
    "やり直す": "restart", "リスタート": "restart", "最初から": "restart",
    "終了": "quit", "終わる": "quit", "やめる": "quit", "おわり": "quit",
    "はい": "yes", "うん": "yes", "いいえ": "no", "いや": "no",
    "詳しく": "verbose", "詳細": "verbose", "簡潔": "brief", "簡単に": "brief",
    "もう一度": "again", "もういちど": "again", "くり返す": "again", "繰り返す": "again",
    "祈る": "pray", "ジャンプ": "jump", "跳ぶ": "jump", "飛ぶ": "jump",
    "泳ぐ": "swim", "叫ぶ": "yell", "さけぶ": "yell", "こんにちは": "hello",
    "体調": "diagnose", "診断": "diagnose", "けが": "diagnose",
    "全部取る": "take all", "全部拾う": "take all", "全部置く": "drop all",
    "聞く": "listen", "においを嗅ぐ": "smell", "嗅ぐ": "smell",
    "登る": "up", "上る": "up", "降りる": "down", "下りる": "down",
    "入る": "in", "出る": "out", "外に出る": "out", "中に入る": "in",
}

DIRS = {
    "北東": "northeast", "北西": "northwest", "南東": "southeast", "南西": "southwest",
    "北": "north", "南": "south", "東": "east", "西": "west",
    "上": "up", "下": "down", "中": "in", "外": "out",
}
DIR_RE = re.compile(
    r"^(北東|北西|南東|南西|北|南|東|西|上|下|中|外)(?:の方)?(?:へ|に)?"
    r"(?:行く|いく|進む|すすむ|向かう|移動する|移動|歩く)?$")
PARTICLE_RE = re.compile(r"(の中に|の中へ|の中から|の上に|の上へ|を|に|へ|で|から|と)")


def read_tsv(name):
    rows = []
    path = os.path.join(DATA, name)
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line or line.startswith("#") or "\t" not in line:
                continue
            rows.append(line.split("\t"))
    return rows


def norm(s):
    return " ".join(s.split())


class Translator:
    def __init__(self):
        self.names = {norm(r[0]).lower(): r[1] for r in read_tsv("names.tsv")}
        self.msgs = {norm(r[0]): r[1] for r in read_tsv("messages.tsv")}
        self.patterns = []
        for r in read_tsv("patterns.tsv"):
            try:
                self.patterns.append((re.compile(r[0]), r[1]))
            except re.error as e:
                print(f"[patterns.tsv の正規表現エラー: {r[0]} ({e})]")

    # ---- 名前 ----
    def name(self, s):
        """物や部屋の名前を日本語に。わからなければ None。"""
        s = norm(s)
        if re.fullmatch(r"-?\d+", s):
            return s
        if s.lower() in self.names:
            return self.names[s.lower()]
        low = re.sub(r"^(a|an|the|some|your)\s+", "", s.lower())
        if low in self.names:
            return self.names[low]
        parts = re.split(r",\s*(?:and\s+|or\s+)?|\s+and\s+|\s+or\s+", low)
        if len(parts) > 1:
            out = [self.name(p) for p in parts if p]
            if all(out):
                return "、".join(out)
        return None

    # ---- 一文 ----
    def sentence(self, s):
        s = norm(s)
        if not s:
            return ""
        if s in self.msgs:
            return self.msgs[s]
        m = re.match(r"^([^:]{1,60}): (.+)$", s)
        if m and self.name(m.group(1)):
            rest = self.sentence(m.group(2))
            if rest is not None:
                return self.name(m.group(1)) + "：" + rest
        for rx, tmpl in self.patterns:
            m = rx.match(s)
            if not m:
                continue
            out, ok = tmpl, True
            for i, g in enumerate(m.groups(), 1):
                g = g or ""
                out = out.replace("{r%d}" % i, g)
                if "{s%d}" % i in out:
                    out = out.replace("{s%d}" % i, self.name(g) or g)
                if "{%d}" % i in out:
                    j = self.name(g)
                    if j is None:
                        ok = False
                        break
                    out = out.replace("{%d}" % i, j)
            if ok:
                return out
        return None

    def line(self, text):
        """1行分を訳す。訳せなかった文は (None, 英文) として返す。"""
        stripped = text.strip()
        if stripped in self.msgs:
            return [(self.msgs[stripped], stripped)]
        if stripped.lower() in self.names:
            return [(self.names[stripped.lower()], stripped)]
        parts = []
        for sent in SENT_RE.split(stripped):
            parts.append((self.sentence(sent), sent))
        return parts

    # ---- 出力ブロック全体 ----
    def block(self, raw):
        """ゲーム出力のかたまりを訳す。(状態行, [(日本語, 英語), ...]) を返す。"""
        status = None
        lines = raw.replace("\r", "").split("\n")
        body = []
        for ln in lines:
            m = STATUS_RE.match(ln)
            if m:
                status = (m.group(1).strip(), m.group(2), m.group(3))
                continue
            body.append(ln)
        # dfrotz は 255 文字で折り返すので、折り返された行をつなぎ直す
        joined = []
        prev_len = 0
        for ln in body:
            if (joined and prev_len >= 200 and ln.strip()
                    and not ln.startswith(" ")):
                joined[-1] = joined[-1].rstrip() + " " + ln.strip()
            else:
                joined.append(ln)
            prev_len = len(ln)
        body = joined
        while body and body[-1].strip() in ("", ">"):
            body.pop()
        while body and not body[0].strip():
            body.pop(0)
        if body and body[-1].rstrip().endswith(">"):
            body[-1] = body[-1].rstrip()[:-1].rstrip()

        translated = []
        for ln in body:
            if not ln.strip():
                translated.append(("", None, ""))
                continue
            indent = len(ln) - len(ln.lstrip())
            if indent:
                j = self.name(ln.strip()) or self.sentence(ln.strip())
                if j is not None:
                    translated.append((" " * indent + j, None, ln.rstrip()))
                    continue
            parts = self.line(ln)
            translated.append((None, parts, ln.rstrip()))

        out = []
        for text, parts, en_line in translated:
            if parts is None:
                out.append((text, en_line))
                continue
            seg = []
            for ja, en in parts:
                seg.append(ja if ja is not None else en)
            # 訳せなかった文が混じる行は、英文の区切りが分かるよう空白でつなぐ
            ja_line = "".join(seg) if all(
                ja is not None for ja, en in parts) else " ".join(seg)
            out.append((ja_line, en_line))
        return status, out


I_TO_U = {"い": "う", "き": "く", "ぎ": "ぐ", "し": "す", "ち": "つ",
          "に": "ぬ", "び": "ぶ", "み": "む", "り": "る"}
TE_RULES = [("して", ["す", "する"]), ("いて", ["く"]), ("いで", ["ぐ"]),
            ("って", ["る", "う", "つ", "く"]), ("んで", ["む", "ぶ", "ぬ"]), ("て", ["る"])]


def dictionary_forms(s):
    """「消して」「開けます」などから辞書形の候補を作る（元の形も含む）。"""
    yield s
    if s.endswith("ます"):
        stem = s[:-2]
        yield stem + "る"
        if stem and stem[-1] in I_TO_U:
            yield stem[:-1] + I_TO_U[stem[-1]]
    for suf, reps in TE_RULES:
        if s.endswith(suf):
            for r in reps:
                yield s[: -len(suf)] + r


class CommandParser:
    def __init__(self, tr):
        self.tr = tr
        self.verbs = []
        for r in read_tsv("verbs.tsv"):
            forms = [f.strip() for f in r[0].split(",") if f.strip()]
            with_o = r[1] if len(r) > 1 else ""
            no_o = r[2] if len(r) > 2 else ""
            for f in forms:
                self.verbs.append((f, with_o, no_o))
        self.verbs.sort(key=lambda v: -len(v[0]))
        self.nouns = {}
        for r in read_tsv("nouns.tsv"):
            for f in r[0].split(","):
                if f.strip():
                    self.nouns[f.strip()] = r[1]
        # 物の名前辞書（英→日）からも逆引きを作る
        for en, ja in tr.names.items():
            self.nouns.setdefault(ja, en.split()[-1])

    def noun(self, s):
        s = s.strip().strip("「」")
        s = re.sub(r"^(その|この|あの)", "", s)
        s = re.sub(r"の$", "", s)
        if not s:
            return None
        if re.fullmatch(r"[A-Za-z0-9 '\-]+", s):
            return s.lower()
        if s in self.nouns:
            return self.nouns[s]
        for k in sorted(self.nouns, key=len, reverse=True):
            if s.endswith(k):
                return self.nouns[k]
        return None

    def parse(self, text):
        """日本語の命令を英語に。できなければ None。"""
        s = re.sub(r"[\s　！？。、!?]+", "", text)
        s = re.sub(r"ください$", "", s)
        s = re.sub(r"(します|しよう|しろ)$", "する", s)
        if not s:
            return None
        for cand in dictionary_forms(s):
            if cand in SPECIAL:
                return SPECIAL[cand]
            if cand.endswith("する") and cand[:-2] in SPECIAL:
                return SPECIAL[cand[:-2]]
            m = DIR_RE.match(cand)
            if m:
                return DIRS[m.group(1)]
        verb = None
        for cand in dictionary_forms(s):
            for form, with_o, no_o in self.verbs:
                for tail in (form, form + "する"):
                    if cand.endswith(tail):
                        verb = (with_o, no_o)
                        s = cand[: -len(tail)]
                        break
                if verb:
                    break
            if verb:
                break
        if not verb:
            return None
        with_o, no_o = verb
        o = i = None
        i_particle = ""
        # 名詞の中の「に」「で」などで切らないよう、知っている名詞をいったん記号に置き換える
        held = []
        for k in sorted(self.nouns, key=len, reverse=True):
            if len(k) > 1 and PARTICLE_RE.search(k) and k in s:
                held.append(k)
                s = s.replace(k, "\x00%d\x00" % (len(held) - 1))
        tokens = [re.sub(r"\x00(\d+)\x00", lambda m: held[int(m.group(1))], t)
                  for t in PARTICLE_RE.split(s)]
        # tokens: [名詞, 助詞, 名詞, 助詞, ..., 残り]
        for k in range(0, len(tokens) - 1, 2):
            word, part = tokens[k], tokens[k + 1]
            if not word:
                continue
            if part == "を":
                o = word
            else:
                i, i_particle = word, part
        rest = tokens[-1] if len(tokens) % 2 == 1 else ""
        if rest and not o:
            o = rest
        o_en = self.noun(o) if o else None
        i_en = self.noun(i) if i else None
        if (o and not o_en) or (i and not i_en):
            return None
        if not o_en:
            if i_en and "{o}" in with_o:
                # 「木に登る」「ボートに乗る」のように目的語が「に」で来た場合
                o_en, i_en = i_en, None
            elif no_o:
                return no_o
            else:
                return None
        if "|" in with_o:
            # 「A|B」は、{i} がなければ A、あれば B を使う
            with_o = with_o.split("|")[1 if i_en else 0]
        cmd = with_o.replace("{o}", o_en)
        if i_particle in ("の上に", "の上へ"):
            cmd = cmd.replace(" in {i}", " on {i}")
        if i_en:
            if "[" in cmd:
                cmd = cmd.replace("[", "").replace("]", "")
            elif "{i}" not in cmd:
                extra = {"で": " with {i}", "から": " from {i}",
                         "と": " with {i}"}.get(i_particle, " to {i}")
                cmd += extra
            cmd = cmd.replace("{i}", i_en)
        else:
            cmd = re.sub(r"\[.*?\]", "", cmd)
        if "{i}" in cmd:
            return None
        if cmd.startswith("open ") and i_en == "key":
            cmd = cmd.replace("open ", "unlock ", 1)
        return cmd


def find_dfrotz():
    cand = [os.environ.get("DFROTZ", ""), os.path.join(BASE, "bin", "dfrotz"),
            shutil.which("dfrotz") or ""]
    for c in cand:
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    return None


def find_story():
    cand = [os.environ.get("ZORK_STORY", ""),
            os.path.join(BASE, "game", "zork1.z3"),
            os.path.join(HOME_DIR, "zork1.z3")]
    for c in cand:
        if c and os.path.isfile(c):
            return c
    return None


class Game:
    def __init__(self, dfrotz, story):
        os.makedirs(os.path.join(HOME_DIR, "save"), exist_ok=True)
        self.p = subprocess.Popen(
            [dfrotz, "-m", "-p", "-q", "-w", "255", story],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, cwd=os.path.join(HOME_DIR, "save"))

    def read(self):
        buf = b""
        deadline = time.time() + 10
        while time.time() < deadline:
            wait = 0.15 if buf.rstrip().endswith((b">", b":", b"?")) else 1.5
            r, _, _ = select.select([self.p.stdout], [], [], wait)
            if not r:
                if buf:
                    break
                continue
            d = os.read(self.p.stdout.fileno(), 65536)
            if not d:
                break
            buf += d
        return buf.decode("latin-1")

    def send(self, cmd):
        self.p.stdin.write((cmd + "\n").encode("latin-1", "replace"))
        self.p.stdin.flush()

    def alive(self):
        return self.p.poll() is None


def main():
    dfrotz = find_dfrotz()
    story = find_story()
    if not dfrotz or not story:
        print("dfrotz またはゲームファイル（zork1.z3）が見つかりません。")
        print("先に setup.sh を実行してください。")
        sys.exit(1)
    tr = Translator()
    cp = CommandParser(tr)
    game = Game(dfrotz, story)
    # 表示のしかた: both＝日本語と英語を併記 / ja＝日本語だけ / en＝英語だけ
    mode = os.environ.get("ZORK_JA_MODE", "both")
    if mode not in ("both", "ja", "en"):
        mode = "both"
    gray = "" if os.environ.get("NO_COLOR") else "\033[90m"
    reset = "" if os.environ.get("NO_COLOR") else "\033[0m"
    print(HELP)

    def show(raw):
        status, lines = tr.block(raw)
        if mode == "en":
            if status:
                print(f"―― {status[0]}　Score {status[1]} / Moves {status[2]} ――")
            for ja, en in lines:
                print(en)
            return
        if status:
            room = tr.name(status[0]) or status[0]
            if mode == "both" and room != status[0]:
                room = f"{room}（{status[0]}）"
            print(f"―― {room}　得点 {status[1]}／手数 {status[2]} ――")
        for ja, en in lines:
            print(ja)
            # 併記のときは、訳せた行の下に英語の原文を灰色で出す
            if mode == "both" and en.strip() and norm(ja) != norm(en):
                indent = en[: len(en) - len(en.lstrip())]
                print(f"{indent}{gray}{en.strip()}{reset}")

    raw = game.read()
    show(raw)
    while game.alive():
        # ファイル名を聞かれているときは、入力をそのまま渡す（空なら既定の名前）
        raw_input_next = "filename" in raw[-200:] and raw.rstrip().endswith(":")
        try:
            line = input("\n> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if line in (":help", ":ヘルプ", "ヘルプ", "help?"):
            print(HELP)
            continue
        new_mode = {":both": "both", ":併記": "both", ":ja": "ja", ":日本語": "ja",
                    ":en": "en", ":英語": "en"}.get(line)
        if new_mode:
            mode = new_mode
            print("[表示: %s]" % {"both": "日本語と英語を併記", "ja": "日本語だけ",
                                  "en": "英語だけ"}[mode])
            continue
        if raw_input_next or not line or re.fullmatch(r"[\x20-\x7e]+", line):
            cmd = line
        else:
            cmd = cp.parse(line)
            if not cmd:
                print("その命令はうまく英語に直せませんでした。"
                      "言い方を変えるか、英語で入力してください（:help で例）。")
                continue
            print(f"（{cmd}）")
        game.send(cmd)
        raw = game.read()
        show(raw)
    if game.alive():
        game.p.terminate()


if __name__ == "__main__":
    main()
