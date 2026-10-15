"""認識結果の後始末と、物音から作られた誤認識の見分け。

Whisper は、声のない区間や物音だけの区間でも、学習に使われた動画の字幕に
よく出る文(「ご視聴ありがとうございました」など)を作ることがある。
声の検出(VAD)で物音だけの時間はそもそも送らないが、物音を声と取り違えた
区間はどうしても残るので、ここで見分ける。

扱いは3つ:
  ok    … そのまま本文に載せる
  flag  … 本文に載せるが「要確認」と書き添える(実際に言った可能性もあるもの)
  drop  … 本文から外し、末尾の一覧にだけ残す(録音にまず出てこない定型句など)
外したものも、時刻・理由・認識結果を必ず一覧に残す(黙って消さない)。
"""

import difflib
import re
import unicodedata
import zlib

# 録音の中でまず言われない、動画の字幕由来の定型句。文ごと外す。
# 実際の会話でも言いうる形(「最後まで見てね」「字幕はいらない」「高評価だった」
# など)にはかからないよう、動画の締めの言い回しに絞ってある
STRONG_PATTERNS = (
    (r"ご視聴.{0,12}ありがとう", "動画の締めの定型句"),
    (r"チャンネル登録", "動画の定型句"),
    (r"高評価.{0,8}(お願い|よろしく|押して)", "動画の定型句"),
    (r"次回もお楽しみに", "動画の定型句"),
    (r"最後まで(ご覧|ご視聴)(いただ|頂|くださ|下さ)", "動画の締めの定型句"),
    (r"字幕(作成|制作|提供|翻訳|協力)|^字幕\s*[:：]", "字幕の表記"),
    (r"(?i)thanks? (you )?(so much )?for watching", "動画の定型句(英語)"),
    (r"(?i)please subscribe", "動画の定型句(英語)"),
    (r"(?i)subtitles? (by|provided)", "字幕の表記(英語)"),
    (r"(?i)amara\.org", "字幕の表記(英語)"),
    (r"^[\(（\[【〔]?\s*(音楽|拍手|笑|笑い|BGM|歓声|無音|雑音|効果音|ため息)\s*[\)）\]】〕]?$",
     "効果音の表記"),
    (r"^[\u266a\u266b\u266c\u3030\u301c~\u30fc\s]+$", "記号だけ(音楽の表記)"),
)

# 実際にも言うが、物音だけの区間でも出やすい言葉。声の確からしさが低いときだけ要確認
WEAK_PHRASES = {
    "ありがとうございました", "ありがとうございます", "ありがとう",
    "お疲れ様でした", "お疲れさまでした", "おつかれさまでした", "お疲れ様です",
    "よろしくお願いします", "よろしくお願いいたします", "失礼します", "失礼しました",
    "おやすみなさい", "おはようございます", "こんにちは", "こんばんは",
    "では", "それでは", "じゃあ", "またね", "バイバイ", "さようなら",
    "いただきます", "ごちそうさまでした", "ごちそうさま",
    "はい", "うん", "ええ", "えー", "あー", "うーん", "ん", "あ", "お", "え", "う",
    "はいはい", "うんうん", "そうですね", "なるほど", "本当に", "ほんとに",
}

_CJK = r"\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef"
_SPACE_IN_CJK = re.compile(rf"(?<=[{_CJK}])[ \t]+(?=[{_CJK}])")
_PUNCT = re.compile(r"[\s、。，．,.!！?？…‥・「」『』（）()\[\]【】〜~ー\-—–:：;；\"'“”’]+")
_SENTENCE = re.compile(r"(?<=[。！？!?])\s*")
# 同じ語句の6回以上の繰り返し(「はいはいはいはい」程度は実際の会話にある)
_REPEAT_PHRASE = re.compile(r"(.{2,20}?)\1{5,}")
_REPEAT_CHAR = re.compile(r"(.)\1{9,}")


def _weak_core():
    return {_PUNCT.sub("", w) for w in WEAK_PHRASES}


def normalize(text):
    """表記の後始末: 余分な空白(日本語の文字の間の空白も)と未知語の印を消す。"""
    t = unicodedata.normalize("NFC", text or "")
    t = re.sub(r"<unk>|\[unk\]|<\|[^|>]*\|>", "", t, flags=re.I)
    t = t.replace("\u3000", " ")
    t = _SPACE_IN_CJK.sub("", t)
    t = re.sub(r"[ \t]+([、。！？])", r"\1", t)
    t = re.sub(r"[ \t]{2,}", " ", t)
    return t.strip()


def core(text):
    """比較用: 句読点・空白・長音などを除いた中身。"""
    return _PUNCT.sub("", text or "")


def _remove_strong(text):
    """定型句を含む文を外す。返り値: (残りの文, 外した理由のリスト)。"""
    kept, reasons = [], []
    for s in _SENTENCE.split(text):
        if not s.strip():
            continue
        hit = None
        for pat, why in STRONG_PATTERNS:
            if re.search(pat, s.strip()):
                hit = why
                break
        if hit:
            reasons.append(f"{hit}「{s.strip()[:20]}」")
        else:
            kept.append(s.strip())
    return "".join(_join_sentences(kept)), reasons


def _join_sentences(parts):
    out = []
    for p in parts:
        if out and re.search(r"[A-Za-z0-9]$", out[-1]) and re.match(r"[A-Za-z0-9]", p):
            out.append(" ")
        out.append(p)
    return out


def _collapse_repeats(text):
    """同じ語句の6回以上の繰り返し・同じ文字の10回以上の連続を縮める。"""
    t2 = _REPEAT_PHRASE.sub(lambda m: m.group(1) * 2 + "…", text)
    t2 = _REPEAT_CHAR.sub(lambda m: m.group(1) * 4 + "…", t2)
    return t2, t2 != text


def compression_ratio(text):
    b = (text or "").encode("utf-8")
    return len(b) / max(1, len(zlib.compress(b)))


def _script_problem(text, language):
    """日本語のはずの結果に、日本語以外の文字が多くないか。"""
    if not language.lower().startswith("ja"):
        return ""
    chars = [c for c in text if not c.isspace() and not _PUNCT.fullmatch(c)]
    if not chars:
        return ""
    n = len(chars)
    hangul = sum(1 for c in chars if "\uac00" <= c <= "\ud7af" or "\u1100" <= c <= "\u11ff"
                 or "\u3130" <= c <= "\u318f")
    other = sum(1 for c in chars if "\u0400" <= c <= "\u04ff" or "\u0600" <= c <= "\u06ff"
                or "\u0e00" <= c <= "\u0e7f" or "\u0900" <= c <= "\u097f")
    latin = sum(1 for c in chars if c.isascii() and c.isalpha())
    kana = sum(1 for c in chars if "\u3040" <= c <= "\u30ff")
    kanji = sum(1 for c in chars if "\u4e00" <= c <= "\u9fff")
    if (hangul + other) / n > 0.2:
        return "日本語以外の文字が多い"
    if latin >= 15 and latin / n > 0.5:
        return "英語になっている(翻訳や誤認識の疑い)"
    if kanji >= 10 and kana == 0:
        return "かなが無い(中国語になった疑い)"
    return ""


def judge(seg, text, language, max_chars_per_sec=20.0, weak_voiced_sec=0.5,
          low_voiced_sec=0.3, low_prob=0.7, verify_text=None, empty_flag_voiced_sec=2.0,
          low_density_voiced_sec=4.0, low_density_chars_per_sec=1.5):
    """1区間の認識結果を判定する。

    seg: {"voiced_sec", "max_prob", ...}(audio.segment_stats の値)
    返り値: {"text", "status"(ok/flag/drop), "reasons"[...]}

    声らしさの統計だけでは、短い返事(「はい」)と咳・物音を分けきれない
    (テスト音源で、物音だけの区間の声らしい部分は 0.2〜0.8秒、実際の短い返事は
    0.2〜0.7秒で重なった)。そこで、物音だけでも出やすい言葉が、声らしい部分の
    短い区間から返ったときだけ要確認にする。消しはしない。
    """
    raw = text or ""
    t = normalize(raw)
    reasons = []
    status = "ok"
    voiced = float(seg.get("voiced_sec") or 0.0)

    if not core(t):
        if voiced >= empty_flag_voiced_sec:
            # 声らしい音が続いたのに文字にならなかった。会話の抜けかもしれないので
            # 本文に場所を残す
            return {"text": "", "status": "flag",
                    "reasons": [f"声らしい音があるのに文字にならなかった(声らしい部分 {voiced:.1f}秒)"]}
        return {"text": "", "status": "drop", "reasons": ["文字なし"]}

    t, removed = _remove_strong(t)
    if removed:
        reasons.extend(removed)
        if not core(t):
            return {"text": normalize(raw), "status": "drop", "reasons": reasons}
        status = "flag"

    t, collapsed = _collapse_repeats(t)
    if collapsed:
        if len(set(core(t))) <= 2 and len(core(raw)) >= 20:
            reasons.append("同じ文字の繰り返しだけ(誤認識の疑い)")
            return {"text": normalize(raw)[:80], "status": "drop", "reasons": reasons}
        reasons.append("同じ語句の繰り返し(誤認識の疑い。縮めて表示)")
        status = "flag"
    elif len(t) >= 40 and compression_ratio(t) > 2.4:
        reasons.append("繰り返しの多い文(誤認識の疑い)")
        status = "flag"

    c = core(t)
    rate = len(c) / max(0.5, float(seg.get("voiced_sec") or 0.0))
    if rate > max_chars_per_sec and len(c) >= 10:
        reasons.append(f"声の長さに比べて文字が多い({rate:.0f}字/秒)")
        status = "flag"

    maxp = float(seg.get("max_prob") or 0.0)
    if voiced >= low_density_voiced_sec and len(c) < low_density_chars_per_sec * voiced:
        reasons.append(f"文字が少ない(声らしい部分 {voiced:.0f}秒で{len(c)}字。抜けがあるかも)")
        status = "flag"
    if c in _WEAK_CORE and voiced < weak_voiced_sec:
        reasons.append(f"物音だけでも出やすい言葉(声らしい部分 {voiced:.1f}秒)")
        status = "flag"
    elif voiced < low_voiced_sec and maxp < low_prob:
        reasons.append(f"声の確からしさが低い区間(最大 {maxp:.2f}・声らしい部分 {voiced:.1f}秒)")
        status = "flag"

    sp = _script_problem(t, language)
    if sp:
        reasons.append(sp)
        status = "flag"

    if verify_text is not None:
        vc = core(normalize(verify_text))
        if not vc:
            reasons.append("確認用のモデルでは声なし")
            status = "flag"
        elif len(c) >= 10 and len(vc) >= 10 and similarity(c, vc) < 0.1:
            reasons.append("確認用のモデルと内容が大きく違う")
            status = "flag"

    return {"text": t, "status": status, "reasons": reasons}


def similarity(a, b):
    return difflib.SequenceMatcher(None, a or "", b or "", autojunk=False).ratio()


_WEAK_CORE = _weak_core()
