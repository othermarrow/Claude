"""ミナモの蔵書：端末の中の本（txt）と Obsidian のノート（md）から、相手の発言に近い一節を探す。

本やノートの文章はリポジトリにも画面にも置かない。Termux から見えるフォルダを読み、
整えた結果を ~/.cache/minamo/ に取っておくだけ。見つけた一節は、その回だけ
観測メモに添えて API に送る（会話の履歴には残さない）。

  .txt  本（OCR したもの）。文字間の空白を詰め、行をつなぐ
  .md   Obsidian のノート。前書き（---）・見出し・囲み・リンク・出典番号・表を除く

探し方（標準ライブラリだけ・索引なし）
  1. 相手の発言から、漢字・カタカナの続きを拾ってキーワードにする
  2. 各キーワードを含む段落の数を数え、珍しい言葉ほど重く見る
  3. 点の高い段落の中から一つ選ぶ（同じ段落は続けて使わない）

自分の文章（OWN_DIRS の下。Vault の zork）
  利用者が自分で書いた小説（writing）と、それをほかの AI が分析したもの（analysis：名前に「による分析」）。
  ユーザー名・サイト名・題名は口にさせないので、それらがまざりうる文は、文ごと使わない：
  題名（ファイル名から）・URL・@・4 桁以上の数字・英字の語・サイトや投稿の言葉（SITE_WORDS）、
  所見では「〜さん」「〜氏」も。ほかに伏せたい言葉は ~/.config/minamo/hide.txt に一行ずつ書く。

入れないもの
  - 心理検査の手引き（WAIS・WISC・発達診断など）：検査の問題や採点基準は外に出さない
  - 自殺を主題にした本・当事者の手記：ホラーの材料にしない
  - 職場の資料・索引・管理用のフォルダ（SKIP_DIRS）
  段落単位でも、自殺・自傷や性に触れるものは使わない。
"""

import hashlib
import json
import math
import os
import random
import re

CACHE = os.path.expanduser("~/.cache/minamo/library.json")
CHUNK_MIN, CHUNK_MAX = 140, 420
OWN_FIRST = 0.5      # 自分の文章を使えるとき、先にそちらを探す確率
EXCERPT = 260

# ファイル名か書名のあたり（空白を除いた最初の 400 字）にこれがある本は読まない。
# 目次に出てくるだけの本まで外さないように、冒頭だけを見る。
EXCLUDE_MARKERS = [
    "WAIS", "WISC", "成人知能検査", "知能検査法", "精神発達診断法", "発達診断",
    "発達と診断", "K式", "自殺学", "自殺したのか", "自閉症です",
]
# 名前にこれを含むフォルダは読まない（「.」で始まるフォルダも読まない）。
# Vault 全体を指したときに、職場の資料やコード、索引が混ざらないようにする。
SKIP_DIRS = ["仕事用", "Abstract", "Terminal", "LLM",
             "索引", "管理", "出典", "Templates", "テンプレート"]
# 利用者が自分で書いた文章を置くフォルダ（この名前のフォルダの下は、本でもノートでもなく「自分の文章」）
OWN_DIRS = ["zork"]
# 自分の文章・所見で、この言葉を含む文は使わない（ユーザー名・サイト名・題名を口にさせないため）
SITE_WORDS = ["pixiv", "ピクシブ", "カクヨム", "小説家になろう", "エブリスタ", "ハーメルン", "アルファポリス",
              "星空文庫", "ノベルアップ", "ノベルデイズ", "魔法のiらんど", "ツイッター", "ポイピク", "ぷらいべったー",
              "ブログ", "サイト", "投稿", "ユーザー", "ペンネーム", "筆名", "作者名", "アカウント", "フォロワー",
              "ブックマーク", "いいね", "閲覧", "タイトル", "題名", "表題", "作品名", "初出", "掲載", "転載"]
HIDE_FILE = os.path.expanduser("~/.config/minamo/hide.txt")
# 所見のファイル名の AI の名前を、口にする形に
AI_NAMES = {"chatgpt": "ChatGPT", "claude": "Claude", "gemini": "Gemini", "perplexity": "Perplexity",
            "manus": "Manus", "copilot": "Copilot", "grok": "Grok", "deepseek": "DeepSeek"}
_NUMBERED = re.compile(r"^(\d+[_\-\s])+")
# URL・@・ハッシュタグ・長い数字（作品の番号など）・英字の語・「作者：」のようなコロン
_UNSAFE = re.compile(r"https?:|www\.|[@＠#＃:：]|[0-9０-９]{4,}|[A-Za-zＡ-Ｚａ-ｚ]{2,}")
_BRACKETS = "「」『』《》【】〈〉\"\""

# この言葉を含む段落は使わない
BLOCK_WORDS = ["自殺", "自死", "希死", "自傷", "リストカット", "縊", "飛び降り",
               "過量服薬", "死にたい", "遺書",
               # 症例記録にある性の話も、ホラーの材料にしない
               "性器", "性交", "挿入", "揷入", "ペニス", "陰茎", "膣", "性的虐待",
               "強姦", "レイプ", "近親姦"]

_CJK = r"぀-ヿ㐀-鿿！-｠　-〿"
_SPACES = re.compile(rf"(?<=[{_CJK}])[ \t　]+(?=[{_CJK}])")
# 漢字・カタカナの続き。一字の漢字（「母」「夢」）も拾うが、ありふれていれば弱く数える
_KEYWORD = re.compile(r"[一-鿿゠-ヿ々ー]+")
_HIRA = re.compile(r"[぀-ゟ]")
_GOOD = re.compile(rf"[{_CJK}]")
_UUID_PREFIX = re.compile(r"^[0-9a-f]{8}-")
_PERIOD = re.compile(rf"(?<=[{_CJK}])[.．](?![0-9])")
_COMMA = re.compile(rf"(?<=[{_CJK}])[,，](?![0-9])")
_KANJI_KANA = re.compile(r"[一-鿿゠-ヿ]")

# Markdown（Obsidian）の飾り
_FRONT = re.compile(r"\A﻿?---\n.*?\n---[ \t]*\n", re.S)
_WIKILINK = re.compile(r"!?\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]")
_MDLINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
_CITE = re.compile(r"\[\^?\d+(?:[,\-–]\s*\d+)*\]|\[cite[^\]]*\]")
_CALLOUT = re.compile(r"^>\s*\[![^\]]*\][+-]?\s*")
_REFS_HEAD = re.compile(r"^#+\s*(出典|参考文献|引用文献|文献|References|Sources|関連|リンク)")


def _title(path, text=""):
    """ファイル名を題にする。名前に日本語がほとんどなければ、本文の最初の行から取る。"""
    stem = os.path.splitext(os.path.basename(path))[0]
    stem = re.sub(r"[_\s]+", " ", _UUID_PREFIX.sub("", stem)).strip()
    if len(_KANJI_KANA.findall(stem)) >= 2 or path.lower().endswith(".md"):
        return stem or "無題"
    for line in text.splitlines()[:40]:
        line = _SPACES.sub("", line.strip())
        if 4 <= len(_KANJI_KANA.findall(line)) and len(line) <= 30:
            return line
    return stem or "無題"


def _excluded(path, head):
    name = os.path.basename(path)
    flat = re.sub(r"\s+", "", head)[:400]
    return any(m in name or m in flat for m in EXCLUDE_MARKERS)


def _clean(text):
    """OCR の文字間の空白を詰め、行をつないで段落の列にする。"""
    paras, buf = [], []
    for line in text.splitlines():
        line = _SPACES.sub("", line.strip())
        line = _COMMA.sub("、", _PERIOD.sub("。", line))
        if not line:
            if buf:
                paras.append("".join(buf))
                buf = []
            continue
        buf.append(line)
    if buf:
        paras.append("".join(buf))
    return "".join(paras)


def _clean_md(text):
    """Obsidian のノートから、地の文だけを取り出す。"""
    text = text.replace("\r\n", "\n").lstrip("﻿")
    while True:                               # 前書きが二重のノートもある
        m = _FRONT.match(text.lstrip("﻿\n"))
        if not m:
            break
        text = text.lstrip("﻿\n")[m.end():]
    out, in_code, in_refs = [], False, False
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue
        if s.startswith("#"):
            in_refs = bool(_REFS_HEAD.match(s))  # 出典の節は丸ごと飛ばす
            out.append("")
            continue
        if in_refs or s.startswith("|") or s.startswith("http"):
            continue
        if _CALLOUT.match(s):
            s = _CALLOUT.sub("", s)
            if len(s) <= 10 and "。" not in s:      # 囲みの見出しだけの行
                out.append("")
                continue
        s = s.lstrip(">").strip()
        s = re.sub(r"^([-*+]|\d+[.)])\s+", "", s)       # 箇条書きの印
        s = _WIKILINK.sub(lambda m: m.group(2) or m.group(1), s)
        s = _MDLINK.sub(r"\1", s)
        s = _CITE.sub("", s)
        s = re.sub(r"[*_`~=]{1,3}", "", s)
        s = re.sub(r"\s+(?=[。、])", "", s)
        out.append(s)
    return _clean("\n".join(out))


def own_kind(path):
    """自分の文章のフォルダの下なら "writing" か "analysis"、そうでなければ ""。"""
    parts = path.split(os.sep)[:-1]
    if not any(p in OWN_DIRS for p in parts):
        return ""
    return "analysis" if "による分析" in os.path.basename(path) else "writing"


def own_title(path):
    """自分の文章のファイル名から、題名（伏せるためだけに使う）を取り出す。"""
    stem = os.path.splitext(os.path.basename(path))[0]
    return _NUMBERED.sub("", stem).strip().strip(_BRACKETS).strip()


def analyst(path):
    """所見のファイル名から、分析した AI の名前を取り出す（「Geminiによる分析.md」→ Gemini）。"""
    who = os.path.basename(path).split("による分析")[0].strip(" _-")
    return AI_NAMES.get(who.lower(), who)


def _hide_words():
    try:
        with open(HIDE_FILE, encoding="utf-8") as f:
            return [w.strip() for w in f if w.strip() and not w.startswith("#")]
    except OSError:
        return []


def scrub(text, kind, titles, hide=()):
    """自分の文章・所見から、名前・サイト名・題名がまざりうる文を、文ごと除く。"""
    keep = []
    for sent in re.split(r"(?<=[。！？])", text):
        if not sent.strip():
            continue
        if _UNSAFE.search(sent) or any(w in sent for w in SITE_WORDS) or any(w in sent for w in hide):
            continue
        if any(t in sent for t in titles if len(t) >= 3):
            continue
        if any(f"{a}{t}{b}" in sent for t in titles if t for a, b in ("「」", "『』", "《》", "【】")):
            continue
        if kind == "analysis" and re.search(r"[一-鿿ぁ-んァ-ヶー]+(さん|氏|様)", sent):
            continue
        keep.append(sent)
    return "".join(keep)


def _chunks(text, lenient=False):
    """文の切れ目で CHUNK_MIN〜CHUNK_MAX 字に分け、読める文だけ残す。
    lenient：小説（自分の文章）は「……」「――」や会話が多いので、少しゆるく見る。"""
    out, cur = [], ""
    for sent in re.split(r"(?<=[。！？])", text):
        cur += sent
        if len(cur) >= CHUNK_MIN:
            out.append(cur[:CHUNK_MAX])
            cur = ""
    if len(cur) >= CHUNK_MIN // 2:              # 短いノートの最後の段落も拾う
        out.append(cur)
    keep = []
    for c in out:
        n = len(c)
        good = len(_GOOD.findall(c)) + (c.count("…") + c.count("―") + c.count("─") if lenient else 0)
        if (len(_HIRA.findall(c)) / n >= 0.25 and good / n >= (0.8 if lenient else 0.85)
                and c.count("。") >= (1 if lenient else 2)):
            keep.append(c)
    return keep


class Library:
    """folders：読むフォルダの列。見つからないフォルダは黙って飛ばす。"""

    def __init__(self, folders):
        if isinstance(folders, str):
            folders = [folders]
        self.folders = [os.path.expanduser(f) for f in folders]
        self.books = []          # [{"title":, "kind": "book"|"note"|"writing"|"analysis", "chunks": [...]}]
        self.skipped = []        # 読まなかった本の題
        self.recent = []         # 最近使った (本, 段落)
        self._defs = {}          # 概念 → それを説明している文（define の覚え）
        self._load()

    # ---------- 読み込み ----------
    def _files(self):
        out = []
        for folder in self.folders:
            if not os.path.isdir(folder):
                continue
            for root, dirs, names in os.walk(folder):
                dirs[:] = sorted(d for d in dirs if not d.startswith(".")
                                 and not any(w in d for w in SKIP_DIRS))
                for n in sorted(names):
                    if n.lower().endswith((".txt", ".md")):
                        p = os.path.join(root, n)
                        try:
                            st = os.stat(p)
                        except OSError:
                            continue
                        out.append((p, st.st_size, int(st.st_mtime)))
        return out

    def _load(self):
        files = self._files()
        if not files:
            return
        hide = _hide_words()
        sig = hashlib.sha1(json.dumps(
            [files, EXCLUDE_MARKERS, SKIP_DIRS, CHUNK_MAX, OWN_DIRS, SITE_WORDS, hide, 4]).encode()).hexdigest()
        try:
            with open(CACHE, encoding="utf-8") as f:
                cached = json.load(f)
            if cached.get("sig") == sig:
                self.books, self.skipped = cached["books"], cached["skipped"]
                return
        except (OSError, ValueError, KeyError):
            pass
        # 自分の文章の題名（所見の中にも出てくるので、全部まとめて伏せる）
        titles = sorted({own_title(p) for p, _, _ in files if own_kind(p) == "writing"} - {""}, key=len, reverse=True)
        for path, _, _ in files:
            try:
                with open(path, encoding="utf-8", errors="replace") as f:
                    text = f.read()
            except OSError:
                continue
            is_md = path.lower().endswith(".md")
            own = own_kind(path)
            if own:
                # 題名だけの行（本文の頭など）は、先に落とす
                text = "\n".join(l for l in text.splitlines()
                                 if l.strip().lstrip("#").strip().strip(_BRACKETS).strip() not in titles)
                body = scrub(_clean_md(text) if is_md else _clean(text), own, titles, hide)
                chunks = _chunks(body, lenient=True)
                if chunks:
                    # 題名は持たない（口にさせない）。所見は、分析した AI の名前だけ
                    self.books.append({"title": analyst(path) if own == "analysis" else "",
                                       "kind": own, "chunks": chunks})
                continue
            if _excluded(path, text[:3000]):
                self.skipped.append(_title(path, text))
                continue
            chunks = _chunks(_clean_md(text) if is_md else _clean(text))
            if chunks:
                self.books.append({"title": _title(path, text),
                                   "kind": "note" if is_md else "book",
                                   "chunks": chunks})
        try:
            os.makedirs(os.path.dirname(CACHE), exist_ok=True)
            with open(CACHE, "w", encoding="utf-8") as f:
                json.dump({"sig": sig, "books": self.books, "skipped": self.skipped},
                          f, ensure_ascii=False)
        except OSError:
            pass

    def __len__(self):
        return len(self.books)

    def counts(self):
        """(本の数, ノートの数)。自分の文章と所見は数えない（own_counts）"""
        kinds = [b.get("kind", "book") for b in self.books]
        return kinds.count("book"), kinds.count("note")

    def own_counts(self):
        """(自分の文章の数, ほかの AI の所見の数)"""
        kinds = [b.get("kind", "book") for b in self.books]
        return kinds.count("writing"), kinds.count("analysis")

    def analysts(self):
        return [b["title"] for b in self.books if b.get("kind") == "analysis" and b.get("title")]

    # ---------- 探す ----------
    def search(self, query, kind=None):
        """(題, 種類, 一節) を返す。見つからなければ None。
        kind で絞れる（一つの種類か、種類の集まり）。"""
        words = [w for w in dict.fromkeys(_KEYWORD.findall(query or "")) if w != "ー"][:12]
        if not words or not self.books:
            return None
        total = sum(len(b["chunks"]) for b in self.books)
        df = {w: 0 for w in words}
        hits = []                           # (bi, ci, [words])
        for bi, b in enumerate(self.books):
            k = b.get("kind", "book")
            if kind and (k not in kind if isinstance(kind, (set, frozenset, tuple, list)) else k != kind):
                continue
            for ci, c in enumerate(b["chunks"]):
                found = [w for w in words if w in c]
                if found:
                    for w in found:
                        df[w] += 1
                    hits.append((bi, ci, found))
        idf = {w: math.log((total + 1) / (df[w] + 1)) for w in words}
        scored = []
        for bi, ci, found in hits:
            if (bi, ci) in self.recent:
                continue
            c = self.books[bi]["chunks"][ci]
            if any(x in c for x in BLOCK_WORDS):
                continue
            # ありふれた言葉（段落の 2% 超に出る）だけで当たったものは弱くする
            s = sum(idf[w] for w in found if df[w] / total <= 0.02)
            s += 0.2 * sum(idf[w] for w in found if df[w] / total > 0.02)
            if s > 0:
                scored.append((s, bi, ci))
        if not scored:
            return None
        scored.sort(reverse=True)
        s, bi, ci = random.choice(scored[:3])
        self.recent = (self.recent + [(bi, ci)])[-20:]
        b = self.books[bi]
        return b["title"], b.get("kind", "book"), b["chunks"][ci][:EXCERPT]

    def define(self, term, limit=60):
        """term を説明している一文を返す：(文, 種類)。ノートを先に、なければ本から。見つからなければ ("", "")。
        「〜とは」「〜は、」「〜を…と呼ぶ」の形の文を選び、なければ term を含む短い文を使う。"""
        if not term or not self.books:
            return "", ""
        if term not in self._defs:
            pools = {"note": ([], []), "book": ([], [])}
            pat = re.compile(re.escape(term) + r"(とは|は、|は|を|と呼|という|として)")
            for b in self.books:
                if b.get("kind", "book") not in pools:     # 自分の文章・所見は、概念の説明には使わない
                    continue
                good, other = pools[b.get("kind", "book")]
                if len(good) >= 8:
                    continue
                for c in b["chunks"]:
                    if term not in c or any(x in c for x in BLOCK_WORDS):
                        continue
                    for sent in re.split(r"(?<=。)", c):
                        sent = sent.strip()
                        if term in sent and 10 <= len(sent) <= limit and not re.search(r"[|＊*#\[\]{}]", sent) \
                                and not re.search(r"(本ノート|本書|本章|この章|本稿|本研究|この本|著者|筆者|ノートでは)", sent) \
                                and sent.count("「") == sent.count("」") and sent.count("（") == sent.count("）"):
                            # 概念が文の頭のほうにあり、説明の形をしているものを「よい文」に
                            (good if pat.search(sent) and sent.find(term) <= 12 else other).append(sent)
            self._defs[term] = [(x, k) for k in ("note", "book") for x in (pools[k][0] or pools[k][1][:6])]
        found = self._defs[term]
        if not found:
            return "", ""
        best = [x for x in found if x[1] == found[0][1]]          # ノートがあればノートから
        return random.choice(best)

    def quote(self, limit=70, n=3):
        """自分の文章から、短い一節（一文）をいくつか。物語の掲示板に紛れ込ませる。"""
        sents = []
        for b in self.books:
            if b.get("kind") != "writing":
                continue
            for c in b["chunks"]:
                if any(x in c for x in BLOCK_WORDS):
                    continue
                for sent in re.split(r"(?<=[。！？])", c):
                    sent = sent.strip()
                    if (12 <= len(sent) <= limit and re.search(r"[。！？」]$", sent)
                            and sent.count("「") == sent.count("」")):
                        sents.append(sent)
        random.shuffle(sents)
        return sents[:n]

    def note(self, query, own=False):
        """観測メモに添える文。見つからなければ空。
        own：自分の文章・所見も使う（怖さが中・強のとき）。使えるときは、半分くらいはそちらを先に探す。"""
        hit = None
        if own and random.random() < OWN_FIRST:
            hit = self.search(query, kind={"writing", "analysis"})
        if not hit:
            hit = self.search(query, kind=None if own else {"book", "note"})
        if not hit:
            return ""
        title, kind, text = hit
        if kind == "writing":
            return ("【あなたの文章】（相手が自分で書いた小説の一節。題名・名前・サイト名は伏せてある。"
                    f"相手には見えていない）\n{text}")
        if kind == "analysis":
            who = "・".join(self.analysts())
            return (f"【ほかのAIの所見】{title}が、相手の書いた小説を分析した文章の一節（題名・名前は伏せてある。"
                    f"相手には見えていない。相手の文章を分析した AI は {who} の {len(self.analysts())} 体）\n{text}")
        if kind == "note":
            return (f"【ノートの一節】「{title}」の項より（相手自身の研究ノート。"
                    f"相手には見えていない）\n{text}")
        return f"【蔵書の一節】『{title}』より（相手には見えていない）\n{text}"
