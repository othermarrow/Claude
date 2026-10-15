"""音声の読み込み・声の検出(Silero VAD)・区間分け・送る音声の整え方。

流れ:
  1. ffmpeg で 16kHz・モノラル・16bit の生データにする(作業フォルダに置く)
  2. Silero VAD で 32ms ごとの「声らしさ」(0〜1)を出す
  3. 声らしさから発話の区間を作る(短い途切れはつなぎ、長い発話は途切れで分ける)
  4. 区間ごとに、送る音声を整える(大きな物音を下げ、声の音量をそろえる)
"""

import math
import os
import shutil
import subprocess
import sys
import threading
import time

import numpy as np

SR = 16000
FRAME = 512                  # Silero VAD の1回分(16kHz で 32ms)
FRAME_SEC = FRAME / SR
CONTEXT = 64                 # Silero VAD(v5 以降)が前の回から引き継ぐサンプル数


class AudioError(Exception):
    pass


# ==========================================
# 読み込み(ffmpeg)
# ==========================================
def need_ffmpeg():
    if not shutil.which("ffmpeg"):
        raise AudioError("ffmpeg がありません。Termux で `pkg install ffmpeg` を実行してください。")


def probe_duration(path):
    """長さ(秒)。分からなければ None。"""
    if not shutil.which("ffprobe"):
        return None
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", path],
            capture_output=True, text=True, timeout=60).stdout.strip()
        return float(out) if out and out != "N/A" else None
    except (subprocess.SubprocessError, ValueError, OSError):
        return None


def build_filter(highpass_hz=0, denoise="none", rnnoise_model="", rnnoise_mix=1.0):
    """ffmpeg の -af に渡すフィルタ。

    denoise:
      none     … 低い音を切るだけ
      rnnoise  … RNNoise で雑音を除く(rnnoise_mix の割合で元の音を残す)
      vad      … 声の検出用。RNNoise で雑音を除き、dynaudnorm で小さな声を持ち上げる
    """
    parts = []
    if highpass_hz:
        parts.append(f"highpass=f={int(highpass_hz)}")
    if denoise in ("rnnoise", "vad"):
        if not os.path.isfile(rnnoise_model):
            raise AudioError(f"RNNoise のモデルがありません: {rnnoise_model}\n"
                             "  setup.sh をもう一度実行してください。")
        # arnndn は 48kHz で動くので、前で変換する(出力の 16kHz へは -ar で戻す)。
        # パスは ' で囲む(囲んだ中はそのまま渡る)
        mix = 1.0 if denoise == "vad" else rnnoise_mix
        parts += ["aresample=48000", f"arnndn=m='{rnnoise_model}':mix={mix:g}"]
    if denoise == "vad":
        parts.append("dynaudnorm=f=250:g=15:p=0.9:m=20")
    return ",".join(parts)


class DecodeJob:
    """ffmpeg で src を 16kHz・モノラル・16bit の生データ(dst)にする。

    作るとすぐ裏で走り始める。wait() で終わるのを待つ(進み具合を表示できる)。
    声の検出では、元の音声の変換・検出と、雑音を除いた音声の変換を同時に進める。
    """

    def __init__(self, src, dst, start=None, duration=None, af=""):
        need_ffmpeg()
        self.src, self.dst = src, dst
        total = duration if duration else probe_duration(src)
        if total and start and not duration:
            total = max(0.0, total - start)
        self.total = total
        self.tmp = dst + ".part"
        cmd = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y"]
        if start:
            cmd += ["-ss", f"{start:.3f}"]
        cmd += ["-i", src]
        if duration:
            cmd += ["-t", f"{duration:.3f}"]
        cmd += ["-vn", "-sn", "-dn", "-ac", "1"]
        if af:
            cmd += ["-af", af]
        cmd += ["-ar", str(SR), "-f", "s16le", "-acodec", "pcm_s16le",
                "-progress", "pipe:1", "-nostats", self.tmp]
        self.done = 0.0
        self.err = ""
        self.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     text=True, errors="replace")
        self._out = threading.Thread(target=self._read_progress, daemon=True)
        self._err = threading.Thread(target=self._read_err, daemon=True)
        self._out.start()
        self._err.start()

    def _read_progress(self):
        for line in self.proc.stdout:
            if line.startswith("out_time_us="):
                try:
                    self.done = int(line.split("=", 1)[1]) / 1e6
                except ValueError:
                    pass

    def _read_err(self):
        self.err = self.proc.stderr.read()

    def wait(self, label=""):
        shown = -1
        while self.proc.poll() is None:
            if label and self.total:
                pct = int(min(100, self.done / self.total * 100))
                if pct >= shown + 5:
                    shown = pct
                    print(f"\r  {label}… {pct:3d}%", end="", file=sys.stderr, flush=True)
            time.sleep(0.3)
        self._out.join()
        self._err.join()
        if shown >= 0:
            print(f"\r  {label}… 100%", file=sys.stderr, flush=True)
        if self.proc.returncode != 0 or not os.path.exists(self.tmp):
            if os.path.exists(self.tmp):
                os.remove(self.tmp)
            raise AudioError(f"ffmpeg で読み込めませんでした: {self.src}\n{self.err.strip()[-800:]}")
        if os.path.getsize(self.tmp) < SR * 2 * 0.1:
            os.remove(self.tmp)
            raise AudioError(f"音声が入っていないか、短すぎます: {self.src}")
        os.replace(self.tmp, self.dst)

    def cancel(self):
        if self.proc.poll() is None:
            self.proc.kill()
            self.proc.wait()
        if os.path.exists(self.tmp):
            os.remove(self.tmp)


def decode(src, dst, start=None, duration=None, af="", label="変換"):
    """src を変換して終わるまで待つ。"""
    DecodeJob(src, dst, start=start, duration=duration, af=af).wait(label)


def load_pcm(path):
    """16bit の生データをメモリに読み込まずに開く(長い録音でもメモリを食わない)。"""
    return np.memmap(path, dtype="<i2", mode="r")


# ==========================================
# 声の検出(Silero VAD)
# ==========================================
class SileroVAD:
    def __init__(self, model_path, threads=2):
        try:
            import onnxruntime as ort
        except ImportError:
            raise AudioError("onnxruntime がありません。Termux で "
                             "`pkg install python-onnxruntime` を実行してください。")
        if not os.path.isfile(model_path):
            raise AudioError(f"Silero VAD のモデルがありません: {model_path}\n"
                             "  setup.sh をもう一度実行してください。")
        so = ort.SessionOptions()
        so.inter_op_num_threads = 1
        so.intra_op_num_threads = threads
        so.log_severity_level = 3
        self.sess = ort.InferenceSession(model_path, sess_options=so,
                                         providers=["CPUExecutionProvider"])

    def probs(self, pcm, streams=16, progress=True):
        """32ms ごとの声らしさ(0〜1)の配列を返す。

        録音を streams 本に分けて並べ、まとめて流す(1本ずつより数倍速い)。
        各本の頭の0.5秒ほどは前の文脈がないので、少し精度が落ちる。
        """
        n = len(pcm)
        nframes = max(1, math.ceil(n / FRAME))
        streams = max(1, min(int(streams), nframes))
        per = math.ceil(nframes / streams)            # 1本あたりのフレーム数
        state = np.zeros((2, streams, 128), dtype=np.float32)
        context = np.zeros((streams, CONTEXT), dtype=np.float32)
        sr = np.array(SR, dtype=np.int64)
        out = np.zeros((streams, per), dtype=np.float32)
        block = 500                                    # 一度に読むフレーム数(1本あたり。16本×16秒分)
        shown = -1
        for b0 in range(0, per, block):
            b1 = min(per, b0 + block)
            buf = np.zeros((streams, (b1 - b0) * FRAME), dtype=np.float32)
            for s in range(streams):
                a = (s * per + b0) * FRAME
                z = min(n, (s * per + b1) * FRAME)
                if a < z:
                    buf[s, :z - a] = pcm[a:z].astype(np.float32) / 32768.0
            buf = buf.reshape(streams, b1 - b0, FRAME)
            for i in range(b1 - b0):
                x = np.concatenate([context, buf[:, i, :]], axis=1)
                y, state = self.sess.run(None, {"input": x, "state": state, "sr": sr})
                out[:, b0 + i] = y[:, 0]
                context = x[:, -CONTEXT:]
            if progress:
                pct = int(b1 / per * 100)
                if pct >= shown + 5:
                    shown = pct
                    print(f"\r  声の検出… {pct:3d}%", end="", file=sys.stderr, flush=True)
        if progress and shown >= 0:
            print(file=sys.stderr)
        return out.reshape(-1)[:nframes]


# ==========================================
# 区間分け
# ==========================================
def find_speech(probs, threshold, neg_threshold, min_speech_sec, min_silence_sec,
                min_voiced_sec=0.0):
    """声らしさから発話の区間(フレーム番号の [始め, 終わり))を作る。

    threshold を超えたら声の始まり。neg_threshold を下回る状態が min_silence_sec
    続いたら声の終わり(Silero VAD の get_speech_timestamps と同じ考え方)。
    声らしさが threshold 以上のフレームが合わせて min_voiced_sec に満たない区間
    (物音で一瞬だけ声らしさが上がった区間)は捨てる。
    """
    min_sil = max(1, round(min_silence_sec / FRAME_SEC))
    min_sp = max(1, round(min_speech_sec / FRAME_SEC))
    regions = []
    start = None
    low_from = None
    for i, p in enumerate(probs):
        if start is None:
            if p >= threshold:
                start, low_from = i, None
            continue
        if p >= threshold:
            low_from = None
        elif p < neg_threshold:
            if low_from is None:
                low_from = i
            if i - low_from >= min_sil:
                regions.append((start, low_from))
                start, low_from = None, None
    if start is not None:
        regions.append((start, low_from if low_from is not None else len(probs)))
    min_v = round(min_voiced_sec / FRAME_SEC)
    probs = np.asarray(probs)
    return [(a, b) for a, b in regions
            if b - a >= min_sp and (min_v <= 0 or int((probs[a:b] >= threshold).sum()) >= min_v)]


def plan_segments(probs, regions, pad_sec, merge_gap_sec, max_segment_sec):
    """発話の区間を、送る単位にまとめる。

    前後に余白を足し、間の短い区間どうしをつなぎ(文脈が増えて認識が正確になる)、
    max_segment_sec を超える区間は声の途切れた所で分ける。
    返り値: [(始めのフレーム, 終わりのフレーム), ...]
    """
    total = len(probs)
    pad = round(pad_sec / FRAME_SEC)
    gap = round(merge_gap_sec / FRAME_SEC)
    max_len = max(round(4.0 / FRAME_SEC), round(max_segment_sec / FRAME_SEC))

    padded = [(max(0, a - pad), min(total, b + pad)) for a, b in regions]

    # 長すぎる発話を先に分ける(つなぐ前に分けると、分け目が声の途切れに来る)
    pieces = []
    for a, b in padded:
        pieces.extend(split_long(probs, a, b, max_len))

    merged = []
    for a, b in pieces:
        if merged:
            pa, pb = merged[-1]
            if a - pb <= gap and b - pa <= max_len:
                merged[-1] = (pa, max(pb, b))
                continue
            if a < pb:                    # 余白どうしの重なり
                a = pb
        if b > a:
            merged.append((a, b))
    return merged


def split_long(probs, a, b, max_len):
    out = []
    while b - a > max_len:
        # 上限の 55%〜100% の範囲で、声らしさが最も低い所(声の途切れ)で切る
        lo = a + int(max_len * 0.55)
        hi = a + max_len
        win = _smooth(probs[lo:hi], 9)
        cut = lo + int(np.argmin(win))
        out.append((a, cut))
        a = cut
    out.append((a, b))
    return out


def _smooth(x, k):
    if len(x) < k:
        return np.asarray(x, dtype=np.float32)
    kern = np.ones(k, dtype=np.float32) / k
    return np.convolve(x, kern, mode="same")


def segment_stats(probs, a, b, threshold):
    p = probs[a:b]
    if len(p) == 0:
        return {"max_prob": 0.0, "mean_prob": 0.0, "voiced_sec": 0.0}
    return {
        "max_prob": round(float(p.max()), 3),
        "mean_prob": round(float(p.mean()), 3),
        "voiced_sec": round(float((p >= threshold).sum()) * FRAME_SEC, 2),
    }


# ==========================================
# 送る音声を整える
# ==========================================
def shape_segment(pcm, probs, a, b, threshold, neg_threshold,
                  duck=True, target_dbfs=-23.0, max_gain_db=45.0):
    """フレーム a〜b の音声を、送る形(16bit の生データ)にして返す。

    - 声のない瞬間(声らしさ < neg_threshold)で声より 6dB 以上大きい物音は、
      声の大きさまで下げる。声と重なった物音でも、声より 12dB 以上大きい分は削る。
      どちらも、音量の基準が物音に引っぱられて声が小さく扱われるのを防ぐため。
    - 声の部分の音量を target_dbfs にそろえる(遠くの小さな声を持ち上げる)。
    """
    x = pcm[a * FRAME:b * FRAME].astype(np.float32) / 32768.0
    if len(x) == 0:
        return b""
    nf = math.ceil(len(x) / FRAME)
    fr = np.zeros(nf * FRAME, dtype=np.float32)
    fr[:len(x)] = x
    rms = np.sqrt(np.mean(fr.reshape(nf, FRAME) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms)
    p = np.asarray(probs[a:a + nf], dtype=np.float32)
    if len(p) < nf:
        p = np.pad(p, (0, nf - len(p)))

    speech = p >= threshold
    if speech.sum() >= 3:
        speech_db = float(np.median(db[speech]))
    else:
        speech_db = float(np.percentile(db, 75))

    gain_db = np.zeros(nf, dtype=np.float32)
    if duck:
        loud = (p < neg_threshold) & (db > speech_db + 6)
        gain_db[loud] = speech_db - db[loud]
        over = db + gain_db > speech_db + 12
        gain_db[over] = speech_db + 12 - db[over]
        gain_db = np.maximum(gain_db, -40)
        # 下げ始めを前後1フレーム広げる(物音の立ち上がりを取りこぼさない)
        g = gain_db.copy()
        g[1:] = np.minimum(g[1:], gain_db[:-1])
        g[:-1] = np.minimum(g[:-1], gain_db[1:])
        gain_db = g

    norm_db = float(np.clip(target_dbfs - speech_db, -12.0, max_gain_db))
    # フレームの中心どうしを直線でつなぎ、つなぎ目で音が跳ねないようにする
    centers = (np.arange(nf) + 0.5) * FRAME
    gain = np.interp(np.arange(len(x)), centers, gain_db + norm_db)
    y = x * (10.0 ** (gain / 20.0)).astype(np.float32)
    peak = float(np.max(np.abs(y))) if len(y) else 0.0
    if peak > 0.97:
        y *= 0.97 / peak
    return (np.clip(y, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()


def wav_bytes(pcm_bytes, sr=SR):
    """16bit モノラルの生データに WAV のヘッダを付ける(BNR・確認用)。"""
    import io
    import wave
    bio = io.BytesIO()
    with wave.open(bio, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm_bytes)
    return bio.getvalue()


def resample(x, sr_from, sr_to):
    """簡易な再標本化(BNR に送る 48kHz との変換用)。整数倍だけを扱う。"""
    if sr_from == sr_to:
        return x
    if sr_to % sr_from == 0:
        k = sr_to // sr_from
        t = np.arange(len(x) * k) / k
        return np.interp(t, np.arange(len(x)), x).astype(np.float32)
    if sr_from % sr_to == 0:
        k = sr_from // sr_to
        # 折り返しを防ぐため、k サンプルの平均をとってから間引く
        n = len(x) // k * k
        return x[:n].reshape(-1, k).mean(axis=1).astype(np.float32)
    raise ValueError(f"{sr_from} → {sr_to} の変換はできません")
