"""文字列の正規化・比べ方・幻覚の検出・用語集。

エンジン同士の一致を測るときは、表記の揺れ(子供/子ども/こども、句読点、
全角半角、カタカナ/ひらがな、フィラーの有無)で一致が下がらないよう、
読み(ひらがな)にそろえてから比べる。読みには pykakasi を使う
(入っていなければ、漢字はそのまま比べる。少し厳しめに出るだけで動く)。
"""

import difflib
import re
import unicodedata

import config

try:
    import pykakasi
    _KAKASI = pykakasi.kakasi()
except Exception:            # 入っていなくても動く
    _KAKASI = None

# 〔?〕〔聞き取れず〕などの記号
MARK_RE = re.compile(r"〔[^〔〕]{0,12}〕")
# フィラー。直前が文頭・句読点・空白のときだけ(「あの人」の「あの」は消さない)
_B = r"(?<![^\s、。，．,.!?！？「」])"
FILLER_RE = re.compile(
    _B + r"(?:"
    r"[えエ][ーｰ〜～]+(?:[っッ]?[とト])?|[えエ][っッ][とト][ーｰ〜～]*|"
    r"[あア][ーｰ〜～]+|[うウ][ーｰ〜～]*[んン][ーｰ〜～]*(?=[、。，,\s])|[んン][ーｰ〜～]+|"
    r"[おオ][ーｰ〜～]+|[あア][のノ][ーｰ〜～]+|[あア][のノ](?=[、，,])|"
    r"[そソ][のノ][ーｰ〜～]+|[まマ][ーｰ〜～]+|[まマ][あア](?=[、，,])|"
    r"[なナ][んン][かカ](?=[、，,])"
    r")[、，,]?\s*")
_SKIP_CHARS = set("ーｰ〜～")


def _kata_to_hira(ch: str) -> str:
    o = ord(ch)
    if 0x30A1 <= o <= 0x30F6:
        return chr(o - 0x60)
    return ch


def _keep(ch: str) -> bool:
    if ch in _SKIP_CHARS or ch.isspace():
        return False
    cat = unicodedata.category(ch)
    return cat[0] not in "PSZC"


def _norm_chars(s: str):
    """1文字ずつ正規化した文字を返す(NFKC・小文字・ひらがな化・記号除去)。"""
    for ch in unicodedata.normalize("NFKC", s).lower():
        ch = _kata_to_hira(ch)
        if _keep(ch):
            yield ch


def _has_kanji(s: str) -> bool:
    return any("一" <= c <= "鿿" or "㐀" <= c <= "䶿" for c in s)


def norm_map(text: str, drop_fillers: bool = True, readings: bool = True):
    """比べるための正規化した文字列と、各文字が元の文字列のどこから来たか。

    戻り値: (norm, starts, ends)。norm[i] は元の text[starts[i]:ends[i]] に由来する
    (読みに直した漢字は、その語全体が範囲になる)。
    """
    n = len(text)
    skip = [False] * n
    for m in MARK_RE.finditer(text):
        for i in range(m.start(), m.end()):
            skip[i] = True
    if drop_fillers:
        for m in FILLER_RE.finditer(text):
            for i in range(m.start(), m.end()):
                skip[i] = True
    out, starts, ends = [], [], []
    i = 0
    while i < n:
        if skip[i]:
            i += 1
            continue
        j = i
        while j < n and not skip[j]:
            j += 1
        _norm_segment(text, i, j, out, starts, ends, readings)
        i = j
    return "".join(out), starts, ends


def _norm_segment(text, i, j, out, starts, ends, readings):
    seg = text[i:j]
    if readings and _KAKASI is not None and _has_kanji(seg):
        try:
            items = _KAKASI.convert(seg)
        except Exception:
            items = None
        if items and "".join(it["orig"] for it in items) == seg:
            off = i
            for it in items:
                orig, hira = it["orig"], it["hira"] or it["orig"]
                if not _has_kanji(orig):
                    hira = orig
                for ch in _norm_chars(hira):
                    out.append(ch)
                    starts.append(off)
                    ends.append(off + len(orig))
                off += len(orig)
            return
    for k in range(i, j):
        for ch in _norm_chars(text[k]):
            out.append(ch)
            starts.append(k)
            ends.append(k + 1)


def norm(text: str, drop_fillers: bool = True) -> str:
    return norm_map(text or "", drop_fillers)[0]


def ratio(a: str, b: str) -> float:
    """正規化済みの2つの文字列の一致度(0〜1)。"""
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b, autojunk=False).ratio()


def covered_mask(a: str, others, min_block: int = 3):
    """a の各文字が、others のどれかと min_block 字以上続けて一致するか。"""
    mask = [False] * len(a)
    if not a:
        return mask
    for b in others:
        if not b:
            continue
        sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
        for blk in sm.get_matching_blocks():
            if blk.size >= min_block:
                for k in range(blk.a, blk.a + blk.size):
                    mask[k] = True
    return mask


def coverage(a: str, others, min_block: int = 3) -> float:
    if not a:
        return 1.0
    mask = covered_mask(a, others, min_block)
    return sum(mask) / len(mask)


def runs(mask, value=False, min_len=1):
    """mask の中で value が min_len 以上続く区間 [(start, end)]。"""
    out, i, n = [], 0, len(mask)
    while i < n:
        if mask[i] == value:
            j = i
            while j < n and mask[j] == value:
                j += 1
            if j - i >= min_len:
                out.append((i, j))
            i = j
        else:
            i += 1
    return out


# ------------------------------------------
# エンジンの出力の掃除
# ------------------------------------------
_CJK_SPACE_RE = re.compile(r"(?<=[^\x00-\x7f])[ 　]+(?=[^\x00-\x7f])")
_SPACES_RE = re.compile(r"[ 　]{2,}")
_REPEAT_RE = re.compile(r"((.{1,25}?)[、。，．,.!?！？\s]*)\1{3,}")
_CHAR_REPEAT_RE = re.compile(r"(.)\1{7,}")
_NOISE_RE = re.compile(r"[♪♫♬]+|[\[［(（【](?:音楽|拍手|笑|笑い|BGM|music|Music|MUSIC|雑音|無音)[\]］)）】]")


# 日本語の録音に混ざるはずのない文字(キリル・ギリシャ・ハングル・アラビア等)。
# Parakeet は聞き取れない所でロシア語風の綴りを出した
_FOREIGN_RE = re.compile(r"[\u0370-\u03ff\u0400-\u052f\u0590-\u06ff\u1100-\u11ff\uac00-\ud7af]+[.,!?。、]?")


def clean_asr_text(text: str) -> str:
    """エンジンの出力の、言葉でない部分と機械的な繰り返しを取る。"""
    t = (text or "").replace("\r", "").replace("\n", " ")
    t = _NOISE_RE.sub("", t)
    t = _FOREIGN_RE.sub("", t)
    t = _CJK_SPACE_RE.sub("", t)          # Parakeet は日本語の1字ごとに空白を入れる
    t = _SPACES_RE.sub(" ", t)
    t = collapse_repeats(t)
    return t.strip()


def junk_reason(text: str, gloss_kanji=frozenset()):
    """話し言葉になっていない出力なら、その理由。普通の文なら None。

    実際の録音で、Parakeet は用語集の語の漢字(人名・棟の名前)だけを並べた。
    日本語の話し言葉は仮名が多い(他のエンジンは最低でも4割)ので、
    仮名が2割未満で、同じ漢字の繰り返しか用語集の漢字ばかりのものを捨てる。
    """
    js = [c for c in text if "\u3041" <= c <= "\u9fff"]
    if len(js) < 6:
        return None
    kana = sum(1 for c in js if c <= "\u30ff")
    if kana / len(js) >= 0.2:
        return None
    kanji = [c for c in js if c > "\u30ff"]
    gcov = sum(1 for c in kanji if c in gloss_kanji) / len(kanji) if kanji else 0.0
    if gcov >= 0.5:
        return "用語の羅列"
    if len(set(js)) / len(js) < 0.6:
        return "漢字の羅列"
    return None


def collapse_repeats(t: str) -> str:
    """同じ語句が4回以上続く所を2回に畳む(Whisper の繰り返しの暴走)。"""
    t = _REPEAT_RE.sub(lambda m: m.group(1) * 2, t)
    return _CHAR_REPEAT_RE.sub(lambda m: m.group(1) * 3, t)


def join_units(texts) -> str:
    """区切られた認識結果をつなぐ。英数字どうしの間だけ空白を入れる。"""
    out = ""
    for t in texts:
        t = (t or "").strip()
        if not t:
            continue
        if out and out[-1].isascii() and out[-1].isalnum() and t[0].isascii() and t[0].isalnum():
            out += " "
        out += t
    return out


def find_phrases(text: str, phrases):
    """text(元の文字列)の中の phrases の出現位置 [(start, end, phrase)]。読みで探す。"""
    n, st, en = norm_map(text, drop_fillers=False)
    hits = []
    for p in phrases:
        pn = norm(p, drop_fillers=False)
        if not pn:
            continue
        k = n.find(pn)
        while k >= 0:
            hits.append((st[k], en[k + len(pn) - 1], p))
            k = n.find(pn, k + len(pn))
    return hits


def remove_spans(text: str, spans) -> str:
    """spans [(start, end, ...)] を消す。前後の句読点も1つ消す。"""
    for s, e, *_ in sorted(spans, reverse=True):
        while e < len(text) and text[e] in "、。！？!?，．.,　 ":
            e += 1
        text = text[:s] + text[e:]
    return text.strip(" 、，,")


def strip_fillers(text: str) -> str:
    return FILLER_RE.sub("", text)


def strip_marks(text: str) -> str:
    return MARK_RE.sub("", text)


# ------------------------------------------
# 用語集
# ------------------------------------------
_ARROW_RE = re.compile(r"\s*(?:→|->|=>|⇒|＞|>)\s*")
_FIELD_RE = re.compile(r"[\t,，、:：|｜]")
_PAREN_RE = re.compile(r"[（(]([^）)]*)[）)]")


class Glossary:
    """用語集。

    1行に1語。書き方:
      強度行動障害                  … 用語だけ
      PECS(ペクス)・ PECS,ペクス     … 用語と読み・説明(2つ目以降はメモとして LLM に渡す)
      ぺくす、ペクス → PECS          … 誤認識の直し方(左を右に必ず置き換える)
      # で始まる行は無視
    """

    def __init__(self, terms=None, notes=None, rules=None, path=None):
        self.terms = terms or []
        self.notes = notes or {}
        self.rules = rules or []
        self.path = path

    @classmethod
    def load(cls, path):
        try:
            raw = open(path, "rb").read()
        except FileNotFoundError:
            return cls(path=path)
        for enc in ("utf-8-sig", "cp932", "utf-16"):
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        else:
            text = raw.decode("utf-8", "replace")
        return cls.parse(text, path)

    @classmethod
    def parse(cls, text, path=None):
        terms, notes, rules = [], {}, []
        for line in text.splitlines():
            line = line.strip().lstrip("・-*•").strip()
            if not line or line.startswith("#"):
                continue
            parts = _ARROW_RE.split(line, maxsplit=1)
            if len(parts) == 2 and parts[1].strip():
                right = parts[1].strip()
                for w in re.split(r"[、,，/／]", parts[0]):
                    w = w.strip()
                    if w and w != right:
                        rules.append((w, right))
                if right not in terms:
                    terms.append(right)
                continue
            note = []
            m = _PAREN_RE.search(line)
            if m:
                note.append(m.group(1).strip())
                line = _PAREN_RE.sub("", line).strip()
            fields = [f.strip() for f in _FIELD_RE.split(line) if f.strip()]
            if not fields:
                continue
            term = fields[0]
            note += fields[1:]
            if term not in terms:
                terms.append(term)
            if note:
                notes[term] = "・".join(note)
        return cls(terms, notes, rules, path)

    def __bool__(self):
        return bool(self.terms or self.rules)

    def signature(self) -> str:
        import hashlib
        s = repr((self.terms, sorted(self.notes.items()), self.rules))
        return hashlib.sha1(s.encode()).hexdigest()[:10]

    def whisper_prompt(self, limit=None) -> str:
        limit = limit or config.WHISPER_PROMPT_CHARS
        out = ""
        for t in self.terms:
            nxt = (out + "、" + t) if out else t
            if len(nxt) > limit:
                break
            out = nxt
        return f"{out}。" if out else ""

    def vocab(self, limit=None):
        return self.terms[: (limit or config.ENGINE_VOCAB_MAX)]

    def for_llm(self, limit_chars=4000) -> str:
        lines = []
        for t in self.terms:
            lines.append(f"- {t}" + (f"({self.notes[t]})" if t in self.notes else ""))
        text = "\n".join(lines)
        if len(text) > limit_chars:
            text = text[:limit_chars].rsplit("\n", 1)[0]
        if self.rules:
            text += "\n誤認識の直し方(左のように聞こえたら右の表記にする):\n"
            text += "\n".join(f"- {w} → {r}" for w, r in self.rules[:200])
        return text.strip()

    def apply_rules(self, text: str) -> str:
        for w, r in self.rules:
            if w not in text:
                continue
            if w in r:
                # 右が左を含む(例: 支援 → 行動支援)ときは、すでに右になっている所を守る
                text = text.replace(r, "\x00").replace(w, r).replace("\x00", r)
            else:
                text = text.replace(w, r)
        return text

    def kanji_set(self):
        return frozenset(c for t in self.terms for c in t if "\u4e00" <= c <= "\u9fff")

    def norm_terms(self):
        return [x for x in (norm(t, drop_fillers=False) for t in self.terms) if len(x) >= 2]


# ------------------------------------------
# 統合結果の評価と〔?〕付け
# ------------------------------------------
def score_merge(merged_n, asr_ns, consensus_n, other_merges_n):
    """統合結果の良さ。(総合点, 根拠率, 網羅率, LLM 間の一致)

    根拠率: 統合結果のうち、音声認識の候補のどれかに出てくる部分の割合(足した言葉が少ない)
    網羅率: 2つ以上の系統が一致した内容のうち、統合結果に残っている割合(落とした言葉が少ない)
    """
    p = coverage(merged_n, asr_ns, 3)
    r = coverage(consensus_n, [merged_n], 3) if consensus_n else 1.0
    a = (sum(ratio(merged_n, o) for o in other_merges_n) / len(other_merges_n)
         if other_merges_n else 1.0)
    return 0.45 * p + 0.35 * r + 0.2 * a, p, r, a


def mark_unsupported(text: str, asr_ns, gloss_ns, min_chars=None):
    """どの音声認識の候補にも無い連なりの直後に〔?〕を付ける。戻り値: (text, 付けた数)"""
    min_chars = min_chars or config.UNSUPPORTED_MIN_CHARS
    n, st, en = norm_map(text)
    if not n:
        return text, 0
    mask = covered_mask(n, asr_ns, 3)
    for g in gloss_ns:
        k = n.find(g)
        while k >= 0:
            for i in range(k, k + len(g)):
                mask[i] = True
            k = n.find(g, k + 1)
    spots = []
    for s, e in runs(mask, False, min_chars):
        pos = en[e - 1]          # 読みにした語は、語の終わりを指している
        if text[pos:pos + len(config.UNCERTAIN_MARK)] == config.UNCERTAIN_MARK:
            continue
        spots.append(pos)
    for pos in sorted(set(spots), reverse=True):
        text = text[:pos] + config.UNCERTAIN_MARK + text[pos:]
    return text, len(set(spots))


def new_unsupported(src: str, out: str, asr_ns, min_chars=None) -> int:
    """校正結果 out に、元の文 src にも音声認識の候補にも無い連なりがいくつあるか。"""
    min_chars = min_chars or config.UNSUPPORTED_MIN_CHARS
    n = norm(out)
    if not n:
        return 0
    mask = covered_mask(n, [norm(src)] + list(asr_ns), 3)
    return len(runs(mask, False, min_chars))


def split_proportional(text: str, weights):
    """時刻の無い文字起こしを、区間の長さに比例して文の切れ目で分ける。"""
    if len(weights) <= 1:
        return [text]
    total = sum(weights) or 1
    sents = re.findall(r"[^。！？!?]*[。！？!?]?", text)
    sents = [s for s in sents if s.strip()]
    if not sents:
        return [text] + [""] * (len(weights) - 1)
    length = sum(len(s) for s in sents)
    out, cur, acc, k = [], "", 0, 0
    bound = weights[0] / total * length
    for s in sents:
        if k < len(weights) - 1 and acc + len(s) / 2 > bound and cur:
            out.append(cur)
            cur = ""
            k += 1
            bound += weights[k] / total * length
        cur += s
        acc += len(s)
    out.append(cur)
    while len(out) < len(weights):
        out.append("")
    return out[: len(weights) - 1] + ["".join(out[len(weights) - 1:])]
