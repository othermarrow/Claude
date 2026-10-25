"""音声の前処理・声の検出・区間(チャンク)への区切り・送る音声の切り出し(ffmpeg)。

区間は録音全体を隙間なく覆う(声を取りこぼさないため)。区切りは声の切れ目に置き、
SILENCE_SKIP_SEC 以上続く無音だけを「無音区間」として送らない。
"""

import math
import os
import subprocess
import wave

import config

SR = 16000
HOP = 480                     # 30ms
HOP_SEC = HOP / SR


class AudioError(Exception):
    pass


def _run(cmd):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        tail = (p.stderr or "").strip().splitlines()[-3:]
        raise AudioError(f"{cmd[0]} が失敗しました: " + " / ".join(tail))
    return p


def ffmpeg(*args):
    return _run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *args])


def decode(src, dst):
    """どんな形式でも 16kHz モノラル 16bit の WAV にする。"""
    ffmpeg("-i", src, "-vn", "-ac", "1", "-ar", str(SR), "-c:a", "pcm_s16le", dst)


def make_profile(base, name, dst):
    filt = config.AUDIO_PROFILES.get(name)
    if filt is None:
        raise AudioError(f"AUDIO_PROFILES に {name} がありません")
    if not filt:
        if os.path.exists(dst):
            os.remove(dst)
        try:
            os.link(base, dst)
        except OSError:
            import shutil
            shutil.copyfile(base, dst)
        return
    ffmpeg("-i", base, "-af", filt, "-ac", "1", "-ar", str(SR), "-c:a", "pcm_s16le", dst)


def wav_duration(path):
    with wave.open(path, "rb") as w:
        return w.getnframes() / w.getframerate()


def frame_levels(base, tmp):
    """30ms ごとの音量(dB)。声の検出は雑音を軽く除いた音で、音量の自動調整はかけずに測る。"""
    def filt(fast):
        opts = ":measure_perchannel=none:measure_overall=RMS_level" if fast else ""
        return ("highpass=f=80,afftdn=nr=12:nf=-40:tn=1,"
                f"asetnsamples=n={HOP}:p=0,astats=metadata=1:reset=1{opts},"
                f"ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file={tmp}")
    try:
        ffmpeg("-i", base, "-af", filt(True), "-f", "null", "-")
    except AudioError:            # 古い ffmpeg は measure_* を知らない
        ffmpeg("-i", base, "-af", filt(False), "-f", "null", "-")
    levels = []
    with open(tmp, encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith("lavfi.astats.Overall.RMS_level="):
                v = line.split("=", 1)[1].strip()
                try:
                    x = float(v)
                except ValueError:
                    x = -120.0
                if math.isinf(x) or math.isnan(x):
                    x = -120.0
                levels.append(max(-120.0, x))
    os.remove(tmp)
    return levels


def detect_speech(levels):
    """音量の並びから、声のある所を見つける。

    戻り値: {"threshold": dB, "floor": dB, "peak": dB,
             "regions": [[start, end], ...](余白込み), "raw": [[start, end], ...](余白なし)}
    """
    n = len(levels)
    if n == 0:
        return {"threshold": 0, "floor": 0, "peak": 0, "regions": [], "raw": []}
    s = sorted(levels)
    floor = s[int(0.10 * (n - 1))]
    peak = s[int(0.95 * (n - 1))]
    margin = max(3.0, min(config.VAD_MARGIN_DB, (peak - floor) * 0.35))
    thr = floor + margin
    raw = [v > thr for v in levels]
    # 0.12 秒より短い音(物音)は声とみなさない
    min_run = 4
    i = 0
    while i < n:
        if raw[i]:
            j = i
            while j < n and raw[j]:
                j += 1
            if j - i < min_run:
                for k in range(i, j):
                    raw[k] = False
            i = j
        else:
            i += 1
    hang = int(config.VAD_HANGOVER_SEC / HOP_SEC)
    dil = [False] * n
    for i, v in enumerate(raw):
        if v:
            for k in range(max(0, i - hang), min(n, i + hang + 1)):
                dil[k] = True
    return {"threshold": round(thr, 1), "floor": round(floor, 1), "peak": round(peak, 1),
            "regions": _mask_regions(dil), "raw": _mask_regions(raw)}


def _mask_regions(mask):
    out, i, n = [], 0, len(mask)
    while i < n:
        if mask[i]:
            j = i
            while j < n and mask[j]:
                j += 1
            out.append([round(i * HOP_SEC, 2), round(j * HOP_SEC, 2)])
            i = j
        else:
            i += 1
    return out


def speech_seconds(raw_regions, start, end):
    total = 0.0
    for s, e in raw_regions:
        if e <= start:
            continue
        if s >= end:
            break
        total += min(e, end) - max(s, start)
    return total


def make_chunks(levels, vad, duration):
    """録音全体を区間に分ける。

    戻り値: [{"id", "start", "end", "speech"(声の秒数), "ratio"(声の割合), "silent"}]
    """
    regions = vad["regions"]
    tgt, mx, mn = config.CHUNK_TARGET_SEC, config.CHUNK_MAX_SEC, config.CHUNK_MIN_SEC
    # 1) 長い無音を外して、声のあるひと続き(span)にする
    spans = []
    cur = None
    for s, e in regions:
        if cur and s - cur[1] < config.SILENCE_SKIP_SEC:
            cur[1] = e
        else:
            if cur:
                spans.append(cur)
            cur = [s, e]
    if cur:
        spans.append(cur)
    # 2) 長い span を声の切れ目で切る
    pieces = []
    for s, e in spans:
        gaps = [(ps_e, ns_s) for (ps_s, ps_e), (ns_s, ns_e) in zip(regions, regions[1:])
                if ps_e >= s and ns_s <= e and ns_s > ps_e]
        cur_s = s
        while e - cur_s > mx:
            lo, hi = cur_s + mn, cur_s + mx
            best, best_score = None, None
            for g0, g1 in gaps:
                mid = (g0 + g1) / 2
                if lo <= mid <= hi:
                    score = (g1 - g0) * 2 - abs(mid - (cur_s + tgt)) / tgt * 1.5
                    if best_score is None or score > best_score:
                        best, best_score = mid, score
            if best is None:
                best = _quietest(levels, cur_s + tgt - 10, hi)
            pieces.append([cur_s, best])
            cur_s = best
        pieces.append([cur_s, e])
    # 3) 短すぎる最後の切れ端は前とつなぐ
    merged = []
    for p in pieces:
        if merged and p[1] - p[0] < mn and merged[-1][1] == p[0] and p[1] - merged[-1][0] <= mx + mn:
            merged[-1][1] = p[1]
        else:
            merged.append(p)
    # 4) 隙間(長い無音)も無音区間として並べ、全体を覆う
    chunks, t = [], 0.0
    for s, e in merged:
        s, e = max(0.0, s), min(duration, e)
        if s - t > 0.05:
            chunks.append([t, s, True])
        chunks.append([s, e, False])
        t = e
    if duration - t > 0.05:
        chunks.append([t, duration, True])
    out = []
    for i, (s, e, silent) in enumerate(chunks):
        sp = speech_seconds(vad["raw"], s, e)
        ratio = sp / (e - s) if e > s else 0.0
        if not silent and (ratio < config.MIN_SPEECH_RATIO or sp < 0.3):
            silent = True
        out.append({"id": i, "start": round(s, 2), "end": round(e, 2), "speech": round(sp, 2),
                    "ratio": round(ratio, 3), "silent": silent})
    return out


def _quietest(levels, lo, hi):
    a, b = max(0, int(lo / HOP_SEC)), min(len(levels), int(hi / HOP_SEC))
    if b <= a:
        return hi
    # 0.3 秒の移動平均が最も小さい所
    w = 10
    best_i, best_v = a, None
    for i in range(a, b):
        seg = levels[max(0, i - w // 2): i + w // 2 + 1]
        v = sum(seg) / len(seg)
        if best_v is None or v < best_v:
            best_i, best_v = i, v
    return round(best_i * HOP_SEC, 2)


def read_pcm(wav_path, start, end):
    with wave.open(wav_path, "rb") as w:
        sr = w.getframerate()
        a = max(0, int(start * sr))
        b = min(w.getnframes(), int(end * sr))
        w.setpos(a)
        return w.readframes(max(0, b - a))


def build_request_audio(wav_path, pieces, dst_base, fmt, gap=0.4):
    """pieces [(start, end)] をつないで1つの音声にする(間に gap 秒の無音)。

    戻り値: (path, pcm, layout)。layout は [(つないだ音声での開始, 終了, 元の開始)]。
    fmt: wav / flac / opus / pcm(pcm はファイルを作らず生データだけ)
    """
    gap_bytes = b"\x00\x00" * int(gap * SR)
    datas, layout, t = [], [], 0.0
    for k, (s, e) in enumerate(pieces):
        if k:
            datas.append(gap_bytes)
            t += gap
        d = read_pcm(wav_path, s, e)
        datas.append(d)
        dur = len(d) / 2 / SR
        layout.append((t, t + dur, s))
        t += dur
    pcm = b"".join(datas)
    if fmt == "pcm":
        return None, pcm, layout
    wav = dst_base + ".wav"
    with wave.open(wav, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm)
    if fmt == "wav":
        return wav, pcm, layout
    if fmt == "flac":
        out = dst_base + ".flac"
        ffmpeg("-i", wav, "-c:a", "flac", "-compression_level", "5", out)
    elif fmt == "opus":
        out = dst_base + ".ogg"
        ffmpeg("-i", wav, "-c:a", "libopus", "-b:a", "32k", "-application", "voip", out)
    else:
        raise AudioError(f"知らない形式: {fmt}")
    os.remove(wav)
    return out, pcm, layout


def tone(dst, seconds=1.5):
    """接続確認用の短い音(check で使う)。"""
    ffmpeg("-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", "-ac", "1", "-ar", str(SR),
           "-c:a", "pcm_s16le", dst)
