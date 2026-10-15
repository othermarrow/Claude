"""結果の書き出し(Obsidian 用の Markdown・改行したテキスト・字幕形式の SRT)。"""

import datetime
import os
import re


def ts(sec):
    """秒 → 00:12:34"""
    sec = max(0, int(sec))
    return f"{sec // 3600:02d}:{sec % 3600 // 60:02d}:{sec % 60:02d}"


def ts_srt(sec):
    ms = max(0, int(round(sec * 1000)))
    return f"{ms // 3600000:02d}:{ms % 3600000 // 60000:02d}:{ms % 60000 // 1000:02d},{ms % 1000:03d}"


def human(sec):
    """秒 → 2時間31分05秒 / 12分32秒 / 45秒"""
    sec = max(0, int(round(sec)))
    h, m, s = sec // 3600, sec % 3600 // 60, sec % 60
    if h:
        return f"{h}時間{m:02d}分{s:02d}秒"
    if m:
        return f"{m}分{s:02d}秒"
    return f"{s}秒"


_SENT_END = re.compile(r"(?<=[。！？!?])\s*")
_ONLY_PUNCT = re.compile(r"[\s。、．，.,！？!?…]+")


def split_lines(text, width=60):
    """文の終わり(。！？)で改行する。句点のない長い文は、読点(、)で width 字ほどに折る。"""
    lines = []
    for sent in _SENT_END.split(text or ""):
        sent = sent.strip()
        if not sent or _ONLY_PUNCT.fullmatch(sent):
            continue
        if len(sent) <= width + 20:
            lines.append(sent)
            continue
        buf = ""
        for chunk in re.split(r"(?<=[、,])", sent):
            if buf and len(buf) + len(chunk) > width:
                lines.append(buf)
                buf = chunk
            else:
                buf += chunk
        if buf:
            lines.append(buf)
    return lines


def _blocks(info, segments, gap_note_sec):
    """本文に載せる順に、("gap", 始め, 終わり) と ("seg", 区間) を返す。"""
    out = []
    prev_end = info.get("offset", 0.0)
    for s in segments:
        if s["status"] == "drop":
            continue
        if s["start"] - prev_end >= gap_note_sec:
            out.append(("gap", prev_end, s["start"]))
        out.append(("seg", s))
        prev_end = max(prev_end, s["end"])
    end = info.get("offset", 0.0) + info["duration"]
    if end - prev_end >= gap_note_sec:
        out.append(("gap", prev_end, end))
    return out


def _seg_lines(s):
    """区間の本文の行。文字にならなかった区間・失敗した区間は、そのことを書く。"""
    if s["status"] == "error":
        return ["(認識できませんでした)"]
    if not s.get("text"):
        return ["(文字にならず)"]
    return split_lines(s["text"])


def _counts(segments):
    return {k: sum(1 for s in segments if s["status"] == k)
            for k in ("ok", "flag", "drop", "error")}


def _cell(text):
    return (text or "").replace("|", "｜").replace("\n", " ")


def _yaml_str(s):
    return '"' + str(s).replace("\\", "\\\\").replace('"', '\\"') + '"'


def _range_note(info):
    if info.get("range_from") is None and info.get("range_to") is None:
        return ""
    to = ts(info["range_to"]) if info.get("range_to") is not None else "終わり"
    return f"(このうち {ts(info.get('range_from') or 0)}〜{to} を処理)"


def write_markdown(path, info, segments, gap_note_sec=60):
    """segments: 時刻順の [{"start", "end", "text", "status", "reasons"}]。"""
    n = _counts(segments)
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

    lines = ["---"]
    lines.append(f"source: {_yaml_str(info['source_name'])}")
    if info.get("recorded"):
        lines.append(f"recorded: {_yaml_str(info['recorded'])}")
    lines.append(f"duration: {_yaml_str(ts(info['duration']))}")
    lines.append(f"model: {_yaml_str(info['model_name'])}")
    lines.append(f"created: {_yaml_str(now)}")
    lines.append("tags: [文字起こし]")
    lines.append("---")
    lines.append("")
    lines.append(f"# {info['title']}")
    lines.append("")
    lines.append("| 項目 | 内容 |")
    lines.append("|---|---|")
    lines.append(f"| 録音 | {_cell(info['source_name'])} {human(info['source_duration'])}"
                 f"{_range_note(info)} |")
    sp = info["speech_sec"]
    pct = sp / info["duration"] * 100 if info["duration"] else 0
    lines.append(f"| 声と判定した時間 | {human(sp)}(処理した時間の {pct:.0f}%) / {len(segments)}区間 |")
    lines.append(f"| モデル | {_cell(info['model_desc'])} |")
    if info.get("verify_desc"):
        lines.append(f"| 確認用のモデル | {_cell(info['verify_desc'])} |")
    lines.append(f"| 雑音の処理 | {_cell(info['denoise_desc'])} |")
    how = "元の音声と雑音を除いた音声の両方" if info.get("vad_denoised") else "元の音声"
    lines.append(f"| 声の検出 | Silero VAD(しきい値 {info['vad_threshold']:g}・{how}) |")
    if info.get("recovered"):
        lines.append(f"| 送り直し | 文字が少なかった {info['recovered']}区間を細かく分けて認識し直した |")
    if info.get("second_desc"):
        lines.append(f"| 2回目の認識 | {_cell(info['second_desc'])} |")
    if info.get("polish_desc"):
        lines.append(f"| 読みやすく整えた版 | {_cell(info['polish_desc'])} |")
    extra = f"要確認 {n['flag']} / 除外 {n['drop']}"
    if n["error"]:
        extra += f" / 失敗 {n['error']}"
    lines.append(f"| 判定 | {extra}(末尾に一覧) |")
    lines.append("")
    lines.append("## 本文")
    lines.append("")

    blocks = _blocks(info, segments, gap_note_sec)
    for b in blocks:
        if b[0] == "gap":
            lines.append(f"*({ts(b[1])}〜{ts(b[2])} 発話なし {human(b[2] - b[1])})*")
            lines.append("")
            continue
        s = b[1]
        head = f"**{ts(s['start'])}**"
        if s["status"] == "flag":
            head += f" ⚠ 要確認: {'、'.join(s['reasons'])}"
        elif s["status"] == "error":
            head += f" ⚠ 失敗: {s['reasons'][0] if s['reasons'] else ''}"
        lines.append(head)
        lines.extend(_seg_lines(s))
        if s.get("alt_show") and s.get("alt"):
            lines.append(f"> 別の認識(雑音を除いた音声): {s['alt']}")
        lines.append("")
    if not any(b[0] == "seg" for b in blocks):
        lines.append("(声と判定した区間で、文字にできたものはありませんでした)")
        lines.append("")

    lines.append("## 要確認・除外の一覧")
    lines.append("")
    rows = [s for s in segments if s["status"] in ("flag", "drop", "error")]
    if rows:
        lines.append("| 時刻 | 扱い | 理由 | 認識結果 |")
        lines.append("|---|---|---|---|")
        label = {"flag": "要確認", "drop": "除外", "error": "失敗"}
        for s in rows:
            lines.append(f"| {ts(s['start'])}〜{ts(s['end'])} | {label[s['status']]} | "
                         f"{_cell('、'.join(s['reasons']))} | {_cell(s.get('raw', s['text']))} |")
    else:
        lines.append("なし")
    lines.append("")
    _write(path, "\n".join(lines))


def write_txt(path, info, segments, gap_note_sec=60, timestamps=True, paragraph_gap=3.0):
    """読む用のテキスト。間の短い区間どうしは1つの段落にまとめ、文ごとに改行する。

    要確認の区間は行末に「(要確認)」とだけ書く(理由は .md の一覧)。
    """
    n = _counts(segments)
    lines = [info["title"]]
    lines.append(f"録音: {info['source_name']}({human(info['source_duration'])}){_range_note(info)}"
                 f" / 声と判定: {human(info['speech_sec'])} / モデル: {info['model_name']}")
    if info.get("polish_desc"):
        lines.append(f"{info['polish_desc']}。元の認識結果は .md")
    note = f"要確認 {n['flag']} / 除外 {n['drop']}"
    if n["error"]:
        note += f" / 失敗 {n['error']}"
    lines.append(note + "(理由は .md の一覧)")
    lines.append("")
    prev_end = None
    for b in _blocks(info, segments, gap_note_sec):
        if b[0] == "gap":
            if timestamps:
                if prev_end is not None:
                    lines.append("")
                lines.append(f"({ts(b[1])}〜{ts(b[2])} 発話なし {human(b[2] - b[1])})")
            prev_end = None
            continue
        s = b[1]
        new_par = prev_end is None or s["start"] - prev_end >= paragraph_gap
        if new_par:
            if lines[-1] != "":
                lines.append("")
            if timestamps:
                lines.append(f"[{ts(s['start'])}]")
        body = _seg_lines(s)
        if s["status"] == "flag":
            body[-1] += "(要確認)"
        elif s["status"] == "error":
            body[-1] += "(失敗)"
        lines.extend(body)
        prev_end = s["end"]
    lines.append("")
    _write(path, "\n".join(lines))


def write_srt(path, segments):
    out = []
    n = 0
    for s in segments:
        if s["status"] in ("drop", "error") or not s["text"]:
            continue
        n += 1
        text = "\n".join(split_lines(s["text"], width=30))
        if s["status"] == "flag":
            text = "[要確認] " + text
        out.append(str(n))
        out.append(f"{ts_srt(s['start'])} --> {ts_srt(s['end'])}")
        out.append(text)
        out.append("")
    _write(path, "\n".join(out))


def write_outputs(base, formats, info, segments, gap_note_sec=60, txt_timestamps=True,
                  txt_segments=None, paragraph_gap=3.0):
    """formats(md / txt / srt)のファイルを書き、書いたパスのリストを返す。

    txt_segments を渡すと、txt にはそちら(読みやすく整えた版)を書く。
    """
    paths = []
    for fmt in formats:
        path = f"{base}.{fmt}"
        if fmt == "md":
            write_markdown(path, info, segments, gap_note_sec)
        elif fmt == "txt":
            write_txt(path, info, txt_segments or segments, gap_note_sec, txt_timestamps,
                      paragraph_gap)
        elif fmt == "srt":
            write_srt(path, segments)
        else:
            continue
        paths.append(path)
    return paths


def _write(path, text):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + ".part"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)
