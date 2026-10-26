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
EXCERPT = 260

# ファイル名か書名のあたり（空白を除いた最初の 400 字）にこれがある本は読まない。
# 目次に出てくるだけの本まで外さないように、冒頭だけを見る。
EXCLUDE_MARKERS = [
    "WAIS", "WISC", "成人知能検査", "知能検査法", "精神発達診断法", "発達診断",
    "発達と診断", "K式", "自殺学", "自殺したのか", "自閉症です",
]
# 名前にこれを含むフォルダは読まない（「.」で始まるフォルダも読まない）。
# Vault 全体を指したときに、職場の資料やコード、索引が混ざらないようにする。
SKIP_DIRS = ["仕事用", "Abstract", "Terminal", "LLM", "zork用",
             "索引", "管理", "出典", "Templates", "テンプレート"]
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


def _chunks(text):
    """文の切れ目で CHUNK_MIN〜CHUNK_MAX 字に分け、読める文だけ残す。"""
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
        if (len(_HIRA.findall(c)) / n >= 0.25 and len(_GOOD.findall(c)) / n >= 0.85
                and c.count("。") >= 2):
            keep.append(c)
    return keep


class Library:
    """folders：読むフォルダの列。見つからないフォルダは黙って飛ばす。"""

    def __init__(self, folders):
        if isinstance(folders, str):
            folders = [folders]
        self.folders = [os.path.expanduser(f) for f in folders]
        self.books = []          # [{"title":, "kind": "book"|"note", "chunks": [...]}]
        self.skipped = []        # 読まなかった本の題
        self.recent = []         # 最近使った (本, 段落)
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
        sig = hashlib.sha1(json.dumps(
            [files, EXCLUDE_MARKERS, SKIP_DIRS, CHUNK_MAX, 3]).encode()).hexdigest()
        try:
            with open(CACHE, encoding="utf-8") as f:
                cached = json.load(f)
            if cached.get("sig") == sig:
                self.books, self.skipped = cached["books"], cached["skipped"]
                return
        except (OSError, ValueError, KeyError):
            pass
        for path, _, _ in files:
            try:
                with open(path, encoding="utf-8", errors="replace") as f:
                    text = f.read()
            except OSError:
                continue
            is_md = path.lower().endswith(".md")
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
        """(本の数, ノートの数)"""
        notes = sum(1 for b in self.books if b.get("kind") == "note")
        return len(self.books) - notes, notes

    # ---------- 探す ----------
    def search(self, query, kind=None):
        """(題, 種類, 一節) を返す。見つからなければ None。kind で本・ノートに絞れる。"""
        words = [w for w in dict.fromkeys(_KEYWORD.findall(query or "")) if w != "ー"][:12]
        if not words or not self.books:
            return None
        total = sum(len(b["chunks"]) for b in self.books)
        df = {w: 0 for w in words}
        hits = []                           # (bi, ci, [words])
        for bi, b in enumerate(self.books):
            if kind and b.get("kind", "book") != kind:
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

    def note(self, query):
        """観測メモに添える文。見つからなければ空。"""
        hit = self.search(query)
        if not hit:
            return ""
        title, kind, text = hit
        if kind == "note":
            return (f"【ノートの一節】「{title}」の項より（相手自身の研究ノート。"
                    f"相手には見えていない）\n{text}")
        return f"【蔵書の一節】『{title}』より（相手には見えていない）\n{text}"
