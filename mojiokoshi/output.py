"""結果の書き出し(Obsidian 用の Markdown と、字幕形式の SRT)。"""

import datetime
import os


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


def _cell(text):
    return (text or "").replace("|", "｜").replace("\n", " ")


def _yaml_str(s):
    return '"' + str(s).replace("\\", "\\\\").replace('"', '\\"') + '"'


def write_markdown(path, info, segments, gap_note_sec=60):
    """segments: 時刻順の [{"start", "end", "text", "status", "reasons"}]。"""
    kept = [s for s in segments if s["status"] != "drop"]
    flagged = [s for s in segments if s["status"] == "flag"]
    dropped = [s for s in segments if s["status"] == "drop"]
    errors = [s for s in segments if s["status"] == "error"]
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
    rng = ""
    if info.get("range_from") is not None or info.get("range_to") is not None:
        rng = f"(このうち {ts(info.get('range_from') or 0)}〜"
        rng += f"{ts(info['range_to']) if info.get('range_to') is not None else '終わり'} を処理)"
    lines.append(f"| 録音 | {_cell(info['source_name'])} {human(info['source_duration'])}{rng} |")
    sp = info["speech_sec"]
    pct = sp / info["duration"] * 100 if info["duration"] else 0
    lines.append(f"| 声と判定した時間 | {human(sp)}(処理した時間の {pct:.0f}%) / {len(segments)}区間 |")
    lines.append(f"| モデル | {_cell(info['model_desc'])} |")
    if info.get("verify_desc"):
        lines.append(f"| 確認用のモデル | {_cell(info['verify_desc'])} |")
    lines.append(f"| 雑音の処理 | {_cell(info['denoise_desc'])} |")
    how = "元の音声と雑音を除いた音声の両方" if info.get("vad_denoised") else "元の音声"
    lines.append(f"| 声の検出 | Silero VAD(しきい値 {info['vad_threshold']:g}・{how}) |")
    extra = f"要確認 {len(flagged)} / 除外 {len(dropped)}"
    if errors:
        extra += f" / 失敗 {len(errors)}"
    lines.append(f"| 判定 | {extra}(末尾に一覧) |")
    lines.append("")
    lines.append("## 本文")
    lines.append("")

    prev_end = info.get("offset", 0.0)
    for s in kept:
        gap = s["start"] - prev_end
        if gap >= gap_note_sec:
            lines.append(f"*({ts(prev_end)}〜{ts(s['start'])} 発話なし {human(gap)})*")
            lines.append("")
        if s["status"] == "error":
            body = f"(認識できませんでした: {s['reasons'][0] if s['reasons'] else ''})"
        else:
            body = s["text"]
        mark = ""
        if s["status"] == "flag":
            mark = f" ⚠(要確認: {'、'.join(s['reasons'])})"
        lines.append(f"**{ts(s['start'])}** {body}{mark}")
        lines.append("")
        prev_end = s["end"]
    end = info.get("offset", 0.0) + info["duration"]
    if end - prev_end >= gap_note_sec:
        lines.append(f"*({ts(prev_end)}〜{ts(end)} 発話なし {human(end - prev_end)})*")
        lines.append("")
    if not kept:
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


def write_srt(path, segments):
    out = []
    n = 0
    for s in segments:
        if s["status"] in ("drop", "error") or not s["text"]:
            continue
        n += 1
        text = s["text"]
        if s["status"] == "flag":
            text = "[要確認] " + text
        out.append(str(n))
        out.append(f"{ts_srt(s['start'])} --> {ts_srt(s['end'])}")
        out.append(text)
        out.append("")
    _write(path, "\n".join(out))


def _write(path, text):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + ".part"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)
