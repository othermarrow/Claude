"""ミナモの蔵書：端末の中の本（txt）から、相手の発言に近い一節を探す。

本の文章はリポジトリにも画面にも置かない。Termux のフォルダ（LIBRARY_DIR）に
置いた txt を読み、整えた結果を ~/.cache/minamo/ に取っておくだけ。
見つけた一節は、その回だけ観測メモに添えて API に送る（会話の履歴には残さない）。

探し方（標準ライブラリだけ・索引なし）
  1. 相手の発言から、漢字・カタカナの続き（2文字以上）を拾ってキーワードにする
  2. 各キーワードを含む段落の数を数え、珍しい言葉ほど重く見る
  3. 点の高い段落の中から一つ選ぶ（同じ段落は続けて使わない）

入れない本
  - 心理検査の手引き（WAIS・WISC・発達診断など）：検査の問題や採点基準は外に出さない
  - 自殺を主題にした本・当事者の手記：ホラーの材料にしない
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
    "発達と診断", "自殺学", "自殺したのか", "自閉症です",
]
# この言葉を含む段落は使わない
BLOCK_WORDS = ["自殺", "自死", "希死", "自傷", "リストカット", "縊", "飛び降り",
               "過量服薬", "死にたい", "遺書",
               # 症例記録にある性の話も、ホラーの材料にしない
               "性器", "性交", "挿入", "揷入", "ペニス", "陰茎", "膣", "性的虐待",
               "強姦", "レイプ", "近親姦"]

_CJK = r"\u3040-\u30ff\u3400-\u9fff\uff01-\uff60\u3000-\u303f"
_SPACES = re.compile(rf"(?<=[{_CJK}])[ \t　]+(?=[{_CJK}])")
# 漢字・カタカナの続き。一字の漢字（「母」「夢」）も拾うが、ありふれていれば弱く数える
_KEYWORD = re.compile(r"[\u4e00-\u9fff\u30a0-\u30ff\u3005\u30fc]+")
_HIRA = re.compile(r"[\u3040-\u309f]")
_GOOD = re.compile(rf"[{_CJK}]")
_UUID_PREFIX = re.compile(r"^[0-9a-f]{8}-")
_PERIOD = re.compile(rf"(?<=[{_CJK}])[.\uff0e](?![0-9])")
_COMMA = re.compile(rf"(?<=[{_CJK}])[,\uff0c](?![0-9])")
_KANJI_KANA = re.compile(r"[\u4e00-\u9fff\u30a0-\u30ff]")


def _title(path, text=""):
    """ファイル名を題にする。名前に日本語がほとんどなければ、本文の最初の行から取る。"""
    stem = os.path.splitext(os.path.basename(path))[0]
    stem = re.sub(r"[_\s]+", " ", _UUID_PREFIX.sub("", stem)).strip()
    if len(_KANJI_KANA.findall(stem)) >= 2:
        return stem
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
        line = _COMMA.sub("\u3001", _PERIOD.sub("\u3002", line))
        if not line:
            if buf:
                paras.append("".join(buf))
                buf = []
            continue
        buf.append(line)
    if buf:
        paras.append("".join(buf))
    return "".join(paras)


def _chunks(text):
    """文の切れ目で CHUNK_MIN〜CHUNK_MAX 字に分け、読める文だけ残す。"""
    out, cur = [], ""
    for sent in re.split(r"(?<=[。！？])", text):
        cur += sent
        if len(cur) >= CHUNK_MIN:
            out.append(cur[:CHUNK_MAX])
            cur = ""
    keep = []
    for c in out:
        n = len(c)
        if (len(_HIRA.findall(c)) / n >= 0.25 and len(_GOOD.findall(c)) / n >= 0.85
                and c.count("。") >= 2):
            keep.append(c)
    return keep


class Library:
    def __init__(self, folder):
        self.folder = os.path.expanduser(folder)
        self.books = []          # [{"title":, "chunks": [...]}]
        self.skipped = []        # 読まなかった本の題
        self.recent = []         # 最近使った (本, 段落)
        self._load()

    # ---------- 読み込み ----------
    def _files(self):
        out = []
        for root, _, names in os.walk(self.folder):
            for n in sorted(names):
                if n.lower().endswith((".txt", ".md")):
                    p = os.path.join(root, n)
                    st = os.stat(p)
                    out.append((p, st.st_size, int(st.st_mtime)))
        return out

    def _load(self):
        if not os.path.isdir(self.folder):
            return
        files = self._files()
        sig = hashlib.sha1(json.dumps([files, EXCLUDE_MARKERS, CHUNK_MAX]).encode()).hexdigest()
        try:
            with open(CACHE, encoding="utf-8") as f:
                cached = json.load(f)
            if cached.get("sig") == sig and cached.get("folder") == self.folder:
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
            if _excluded(path, text[:3000]):
                self.skipped.append(_title(path, text))
                continue
            chunks = _chunks(_clean(text))
            if chunks:
                self.books.append({"title": _title(path, text), "chunks": chunks})
        try:
            os.makedirs(os.path.dirname(CACHE), exist_ok=True)
            with open(CACHE, "w", encoding="utf-8") as f:
                json.dump({"sig": sig, "folder": self.folder, "books": self.books,
                           "skipped": self.skipped}, f, ensure_ascii=False)
        except OSError:
            pass

    def __len__(self):
        return len(self.books)

    # ---------- 探す ----------
    def search(self, query):
        """(題, 一節) を返す。見つからなければ None。"""
        words = [w for w in dict.fromkeys(_KEYWORD.findall(query or "")) if w != "\u30fc"][:12]
        if not words or not self.books:
            return None
        total = sum(len(b["chunks"]) for b in self.books)
        df = {w: 0 for w in words}
        hits = []                           # (bi, ci, [words])
        for bi, b in enumerate(self.books):
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
        return self.books[bi]["title"], self.books[bi]["chunks"][ci][:EXCERPT]

    def note(self, query):
        """観測メモに添える文。見つからなければ空。"""
        hit = self.search(query)
        if not hit:
            return ""
        title, text = hit
        return f"【蔵書の一節】『{title}』より（相手には見えていない）\n{text}"
