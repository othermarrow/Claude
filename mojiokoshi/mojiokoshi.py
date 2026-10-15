#!/usr/bin/env python3
"""録音を文字起こしする(NVIDIA API)。

    python mojiokoshi.py 録音.m4a                 文字起こし
    python mojiokoshi.py 録音.m4a --dry-run       声の検出だけ(送信しない)
    python mojiokoshi.py models                   モデルが使えるか確かめる
    python mojiokoshi.py check                    準備ができているか確かめる

物音だけの時間は声の検出(Silero VAD・スマホの中で処理)で除き、声のある区間だけを
NVIDIA API(Whisper large-v3 など)に送る。詳しくは README.md。
"""

import argparse
import datetime
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config          # noqa: E402
import audio           # noqa: E402
import nvasr           # noqa: E402
import output          # noqa: E402
import textfilter      # noqa: E402

USER_FUNCTIONS = "~/.config/mojiokoshi/functions.json"
_print_lock = threading.Lock()


def say(*a, **k):
    with _print_lock:
        print(*a, **k, flush=True)


class Abort(Exception):
    pass


# ==========================================
# 設定まわり
# ==========================================
def load_api_key():
    key = os.environ.get(config.KEY_NAME, "").strip()
    if key:
        return key
    for path in config.KEYS_FILES:
        p = os.path.expanduser(path)
        if not os.path.isfile(p):
            continue
        try:
            with open(p, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("export "):
                        line = line[7:].strip()
                    if line.startswith(config.KEY_NAME + "="):
                        v = line.split("=", 1)[1].strip().strip("'\"")
                        if v:
                            return v
        except OSError:
            continue
    return ""


def need_api_key():
    key = load_api_key()
    if not key:
        raise Abort(f"{config.KEY_NAME} がありません。.bashrc に\n"
                    f"  export {config.KEY_NAME}=nvapi-...\n"
                    "を書いて `source ~/.bashrc` するか、README の「準備」を見てください。")
    return key


def _user_functions():
    p = os.path.expanduser(USER_FUNCTIONS)
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _save_user_functions(data):
    p = os.path.expanduser(USER_FUNCTIONS)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p + ".part", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(p + ".part", p)


def model_conf(name):
    """config.ASR_MODELS に、models で確かめた値(functions.json)を重ねたもの。"""
    if name not in config.ASR_MODELS:
        raise Abort(f"モデル {name} は config.py の ASR_MODELS にありません"
                    f"(あるのは {', '.join(config.ASR_MODELS)})。")
    mc = dict(config.ASR_MODELS[name])
    mc["key"] = name
    for k, v in (_user_functions().get(name) or {}).items():
        if k in ("function_id", "language", "mode", "style") and v:
            mc[k] = v
    if not mc.get("function_id"):
        raise Abort(f"モデル {name} の function-id がありません。"
                    "`python mojiokoshi.py models` で探してください。")
    return mc


def _judge_kw():
    return {"max_chars_per_sec": config.MAX_CHARS_PER_SEC,
            "weak_voiced_sec": config.WEAK_VOICED_SEC,
            "low_voiced_sec": config.LOW_EVIDENCE_VOICED_SEC,
            "low_prob": config.LOW_EVIDENCE_PROB}


def parse_time(s):
    """1:02:03 / 62:03 / 3723 → 秒"""
    if s is None or s == "":
        return None
    parts = str(s).strip().split(":")
    try:
        nums = [float(p) for p in parts]
    except ValueError:
        raise Abort(f"時刻の書き方が分かりません: {s}(例: 1:02:03 / 62:03 / 3723)")
    sec = 0.0
    for n in nums:
        sec = sec * 60 + n
    return sec


def _sha256(path, n=16):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()[:n]


# ==========================================
# 1つの録音の処理
# ==========================================
class Job:
    def __init__(self, src, opts, api_key=None):
        self.src = os.path.abspath(os.path.expanduser(src))
        if not os.path.isfile(self.src):
            raise Abort(f"ファイルがありません: {self.src}")
        self.opts = opts
        self.api_key = api_key
        self.start = opts.start or 0.0
        self.end = opts.end
        if self.end is not None and self.end <= self.start:
            raise Abort("--to は --from より後にしてください。")
        st = os.stat(self.src)
        self.source_duration = audio.probe_duration(self.src)
        sig = json.dumps([self.src, st.st_size, int(st.st_mtime), self.start, self.end,
                          config.HIGHPASS_HZ])
        key = hashlib.sha1(sig.encode()).hexdigest()[:12]
        stem = os.path.splitext(os.path.basename(self.src))[0]
        self.stem = stem
        self.wd = os.path.join(os.path.expanduser(config.WORK_DIR), f"{stem[:30]}-{key}")
        os.makedirs(self.wd, exist_ok=True)
        self.pcm_path = os.path.join(self.wd, "audio.s16")
        self.meta_path = os.path.join(self.wd, "meta.json")
        self.cache_path = os.path.join(self.wd, "asr.jsonl")
        self.cache = self._load_cache()
        self.cache_lock = threading.Lock()
        self.meta = self._load_meta()
        self._pcm = {}
        self._bnr_ok = True
        self._vad_ran = False

    # ---------- 作業フォルダ ----------
    def _load_meta(self):
        try:
            with open(self.meta_path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def _save_meta(self):
        with open(self.meta_path + ".part", "w", encoding="utf-8") as f:
            json.dump(self.meta, f, ensure_ascii=False, indent=1)
        os.replace(self.meta_path + ".part", self.meta_path)

    def _load_cache(self):
        cache = {}
        try:
            with open(self.cache_path, encoding="utf-8") as f:
                for line in f:
                    try:
                        r = json.loads(line)
                    except ValueError:
                        continue          # 途中で切れた最後の行
                    if r.get("key") and not r.get("error"):
                        cache[r["key"]] = r
        except OSError:
            pass
        return cache

    def _remember(self, rec):
        with self.cache_lock:
            if not rec.get("error"):
                self.cache[rec["key"]] = rec
            with open(self.cache_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    # ---------- 音声 ----------
    def _decode(self, path, af, label, background=False):
        """変換する。background なら裏で始めて DecodeJob を返す(済んでいれば None)。"""
        if os.path.exists(path):
            return None
        dur = (self.end - self.start) if self.end is not None else None
        job = audio.DecodeJob(self.src, path, start=self.start or None, duration=dur, af=af)
        if background:
            return job
        try:
            job.wait(label)
        except BaseException:
            job.cancel()
            raise
        return None

    def pcm(self, kind="vad"):
        """kind: vad(声の検出用) / asr(送る音声。雑音の処理によってはvadと同じ)。"""
        if kind == "asr" and self.opts.denoise != "rnnoise":
            kind = "vad"
        if kind in self._pcm:
            return self._pcm[kind]
        if kind == "vad":
            af = audio.build_filter(config.HIGHPASS_HZ)
            self._decode(self.pcm_path, af, "変換")
            path = self.pcm_path
            if "duration" not in self.meta:
                self.meta["duration"] = os.path.getsize(path) / 2 / audio.SR
                self._save_meta()
        else:
            path = os.path.join(self.wd, "audio_rnnoise.s16")
            af = audio.build_filter(config.HIGHPASS_HZ, "rnnoise",
                                    config.RNNOISE_MODEL_PATH, config.RNNOISE_MIX)
            self._decode(path, af, "雑音の除去")
        self._pcm[kind] = audio.load_pcm(path)
        return self._pcm[kind]

    def cleanup_audio(self):
        self._pcm.clear()
        for name in ("audio.s16", "audio_rnnoise.s16"):
            p = os.path.join(self.wd, name)
            if os.path.exists(p):
                os.remove(p)

    # ---------- 声の検出 ----------
    def vad_probs(self):
        """32ms ごとの声らしさ。VAD_DENOISED なら、雑音を除いた音声での結果と合わせる。"""
        import numpy as np
        denoised = self.opts.vad_denoised
        sig = {"model": _sha256(config.VAD_MODEL_PATH), "streams": config.VAD_STREAMS}
        sig2 = dict(sig, filter=audio.build_filter(
            config.HIGHPASS_HZ, "vad", config.RNNOISE_MODEL_PATH)) if denoised else None
        p1 = os.path.join(self.wd, "vad.npy")
        p2 = os.path.join(self.wd, "vad_denoised.npy")
        have1 = os.path.exists(p1) and self.meta.get("vad") == sig and "duration" in self.meta
        have2 = (not denoised) or (os.path.exists(p2) and self.meta.get("vad2") == sig2)
        if not (have1 and have2):
            vad = audio.SileroVAD(config.VAD_MODEL_PATH)
            t0 = time.time()
            path2 = os.path.join(self.wd, "audio_vad.s16")
            bg = None
            if not have2:
                # 雑音を除いた音声の変換(時間がかかる)を裏で先に始め、その間に
                # 元の音声の変換と声の検出を済ませる
                bg = self._decode(path2, sig2["filter"], "", background=True)
            try:
                if not have1:
                    probs = vad.probs(self.pcm("vad"), streams=config.VAD_STREAMS)
                    np.save(p1, probs)
                    self.meta["vad"] = sig
                    self._save_meta()
                if not have2:
                    if bg is not None:
                        bg.wait("雑音除去(検出用)")
                        bg = None
                    probs2 = vad.probs(audio.load_pcm(path2), streams=config.VAD_STREAMS)
                    np.save(p2, probs2)
                    os.remove(path2)
                    self.meta["vad2"] = sig2
            finally:
                if bg is not None:
                    bg.cancel()
            self.meta["vad_seconds"] = round(time.time() - t0, 1)
            self._save_meta()
            self._vad_ran = True
        probs = np.load(p1)
        if denoised:
            probs2 = np.load(p2)
            n = min(len(probs), len(probs2))
            probs = np.maximum(probs[:n], probs2[:n])
        return probs

    def segments(self, probs):
        o = self.opts
        regions = audio.find_speech(probs, o.vad_threshold, o.vad_neg_threshold,
                                    config.MIN_SPEECH_SEC, config.MIN_SILENCE_SEC)
        plan = audio.plan_segments(probs, regions, config.SPEECH_PAD_SEC,
                                   config.MERGE_GAP_SEC, config.MAX_SEGMENT_SEC)
        segs = []
        for i, (a, b) in enumerate(plan):
            s = {"id": i, "f0": a, "f1": b,
                 "start": round(self.start + a * audio.FRAME_SEC, 2),
                 "end": round(self.start + b * audio.FRAME_SEC, 2)}
            s.update(audio.segment_stats(probs, a, b, o.vad_threshold))
            segs.append(s)
        return segs

    # ---------- 送信 ----------
    def _seg_key(self, mc, s, style="pcm"):
        o = self.opts
        parts = [mc["name"], mc["language"], mc["mode"], o.denoise,
                 f"{s['f0']}-{s['f1']}", int(config.DUCK_TRANSIENTS),
                 config.TARGET_SPEECH_DBFS, o.vad_threshold, o.vad_neg_threshold]
        if style != "pcm":
            parts.append(style)
        return "|".join(str(x) for x in parts)

    def _segment_audio(self, s, probs, client):
        o = self.opts
        data = audio.shape_segment(self.pcm("asr"), probs, s["f0"], s["f1"],
                                   o.vad_threshold, o.vad_neg_threshold,
                                   duck=config.DUCK_TRANSIENTS,
                                   target_dbfs=config.TARGET_SPEECH_DBFS)
        if o.denoise == "bnr" and self._bnr_ok:
            data = self._apply_bnr(data, client)
        return data

    def _apply_bnr(self, data, client):
        import numpy as np
        try:
            fid = self.opts.bnr_function_id
            x = np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768.0
            y = client.bnr(fid, audio.resample(x, audio.SR, 48000),
                           intensity=config.BNR_INTENSITY)
            z = audio.resample(np.asarray(y, dtype=np.float32), 48000, audio.SR)
            if len(z) < len(x) * 0.9:
                raise nvasr.SegmentAPIError("返ってきた音声が短すぎます")
            z = np.clip(z[:len(x)], -1, 1)
            return (z * 32767).astype("<i2").tobytes()
        except (nvasr.SegmentAPIError, nvasr.FatalAPIError, ValueError) as e:
            if self._bnr_ok:
                self._bnr_ok = False
                say(f"  [BNR] 雑音除去に失敗したため、以降は雑音除去なしで送ります({str(e)[:150]})")
            return data

    def _style_for(self, mc):
        """送り方(pcm / wav)。auto なら pcm で始め、空の結果が続けば wav を試す。"""
        if mc["mode"] == "streaming":
            return "pcm", False
        st = mc.get("style") or config.AUDIO_STYLE
        if st == "auto":
            return "pcm", True
        return st, False

    def run_model(self, mc, segs, probs, client, label):
        """segs を mc で認識する(記録済みは送らない)。返り値: {id: 記録}。"""
        style, probe_wav = self._style_for(mc)
        results = {}
        todo = []
        for s in segs:
            rec_w = self.cache.get(self._seg_key(mc, s, "wav"))
            rec_p = self.cache.get(self._seg_key(mc, s, "pcm"))
            rec = rec_w or (rec_p if rec_p and (style == "pcm" or rec_p.get("text", "").strip())
                            else None)
            if rec:
                results[s["id"]] = rec
            else:
                todo.append(s)
        if not todo:
            return results
        n_all = len(segs)
        say(f"{label}: {len(todo)}区間を送ります(記録済み {n_all - len(todo)})")
        self.pcm("asr")                      # 送る前に変換を済ませておく
        state = {"style": style, "probe": probe_wav, "fatal": [], "done": n_all - len(todo),
                 "errors_in_row": 0, "empty_strong": 0}
        lock = threading.Lock()

        def send(s, data, st):
            r = client.recognize(mc["function_id"], data, mc["language"], mc["mode"],
                                 punctuation=config.AUTOMATIC_PUNCTUATION,
                                 style=st, what=mc["name"])
            return {"key": self._seg_key(mc, s, st), "id": s["id"], **r}

        def work(s):
            if state["fatal"] or client.limiter.stop.is_set():
                return s, None
            data = self._segment_audio(s, probs, client)
            st = state["style"]
            try:
                rec = send(s, data, st)
                # 声のはっきりした区間が空で返るのが続いたら、送り方を変えて試す
                if (state["probe"] and st == "pcm" and not rec.get("text", "").strip()
                        and s["voiced_sec"] >= 3.0):
                    with lock:
                        state["empty_strong"] += 1
                        try_wav = state["probe"] and state["empty_strong"] >= 2
                        if try_wav:
                            state["probe"] = False
                    if try_wav:
                        rec2 = send(s, data, "wav")
                        if rec2.get("text", "").strip():
                            state["style"] = "wav"
                            self._remember_style(mc, "wav")
                            say("  [送り方] 声のある区間が空で返るため、WAV 形式で送る方式に"
                                "切り替えました(次からもこの方式)。")
                            rec = rec2
            except nvasr.SegmentAPIError as e:
                if client.limiter.stop.is_set():      # 止める途中の失敗は記録しない
                    return s, None
                rec = {"key": self._seg_key(mc, s, st), "id": s["id"], "text": "",
                       "error": str(e)[:300]}
            except nvasr.FatalAPIError as e:
                state["fatal"].append(str(e))
                client.limiter.stop.set()
                return s, None
            self._remember(rec)
            return s, rec

        def report(s, rec):
            state["done"] += 1
            results[s["id"]] = rec
            head = rec.get("text", "").strip().replace("\n", " ")
            if rec.get("error"):
                head = f"(失敗: {rec['error'][:60]})"
                state["errors_in_row"] += 1
                if state["errors_in_row"] >= 3 and not state["fatal"]:
                    state["fatal"].append(
                        f"{mc['name']}: 3区間続けて失敗しました({rec['error'][:150]})。\n"
                        "  通信できる状態か確かめてから、同じコマンドでやり直してください。")
                    client.limiter.stop.set()
            else:
                state["errors_in_row"] = 0
            say(f"  [{state['done']:>4}/{n_all}] {output.ts(s['start'])} {head[:40]}")

        self._run_pool(work, todo, report, client)

        # 途中で WAV 方式に切り替わったら、それまでに空で返った区間を送り直す
        if state["style"] == "wav" and style == "pcm" and not state["fatal"]:
            again = [s for s in segs if s["id"] in results
                     and not results[s["id"]].get("text", "").strip()
                     and not results[s["id"]].get("error")
                     and not results[s["id"]]["key"].endswith("|wav")]
            if again:
                say(f"  空で返った {len(again)}区間を WAV 形式で送り直します。")
                state["done"] = n_all - len(again)
                self._run_pool(work, again, report, client)
        if state["fatal"]:
            raise Abort(state["fatal"][0] + "\n  ここまでの結果は保存しました。"
                        "同じコマンドで続きから再開します。")
        return results

    def _run_pool(self, work, items, report, client):
        ex = ThreadPoolExecutor(max_workers=max(1, config.CONCURRENCY))
        futs = [ex.submit(work, s) for s in items]
        try:
            for fut in as_completed(futs):
                s, rec = fut.result()
                if rec is not None:
                    report(s, rec)
        except KeyboardInterrupt:
            client.limiter.stop.set()
            ex.shutdown(wait=False, cancel_futures=True)
            raise
        ex.shutdown(wait=True)

    def _remember_style(self, mc, style):
        user = _user_functions()
        user.setdefault(mc["key"], {})["style"] = style
        _save_user_functions(user)

    # ---------- 全体 ----------
    def run(self):
        o = self.opts
        name = os.path.basename(self.src)
        dur_txt = output.human(self.source_duration) if self.source_duration else "長さ不明"
        say(f"\n=== {name}({dur_txt})")
        if self.start or self.end is not None:
            say(f"  処理する範囲: {output.ts(self.start)}〜"
                f"{output.ts(self.end) if self.end is not None else '終わり'}")
        probs = self.vad_probs()
        duration = self.meta.get("duration") or len(probs) * audio.FRAME_SEC
        segs = self.segments(probs)
        speech = sum(s["end"] - s["start"] for s in segs)
        pct = speech / duration * 100 if duration else 0
        say(f"  声と判定: {output.human(speech)}(処理した時間の {pct:.0f}%)/ {len(segs)}区間")
        if self._vad_ran and self.meta.get("vad_seconds"):
            say(f"  (声の検出にかかった時間: {output.human(self.meta['vad_seconds'])})")

        if o.dry_run:
            self._print_plan(segs)
            return None

        mc = model_conf(o.model)
        vc = model_conf(o.verify) if o.verify else None
        if o.language:
            mc["language"] = o.language
        n_req = len(segs) * (2 if vc else 1)
        say(f"  送信: 最大 {n_req}回(見込み 約{max(1, math.ceil(n_req / config.REQUESTS_PER_MINUTE))}分)")

        limiter = nvasr.RateLimiter(config.REQUESTS_PER_MINUTE, config.RPM_FLOOR)
        client = None
        try:
            client = nvasr.RivaClient(config.NVIDIA_GRPC_SERVER, self.api_key, limiter,
                                      timeout=config.REQUEST_TIMEOUT,
                                      max_retries=config.MAX_RETRIES,
                                      insecure=config.NVIDIA_GRPC_INSECURE, log=say)
            res = self.run_model(mc, segs, probs, client, f"文字起こし({mc['name']})")
            texts = [r for r in res.values() if not r.get("error")]
            if len(texts) >= 5 and not any(r.get("text", "").strip() for r in texts):
                say("  ⚠ すべての区間が空で返りました。function-id・言語コード・送り方が"
                    "合っていない可能性があります。`python mojiokoshi.py models` で確かめるか、"
                    "短い録音で試してください。")
            judged = {}
            for s in segs:
                rec = res.get(s["id"]) or {}
                judged[s["id"]] = textfilter.judge(
                    s, rec.get("text", ""), mc["language"],
                    **_judge_kw())
            vres = {}
            if vc:
                need = [s for s in segs if judged[s["id"]]["status"] != "drop"]
                vres = self.run_model(vc, need, probs, client, f"確認({vc['name']})")
        finally:
            if client:
                client.close()

        final = []
        for s in segs:
            rec = res.get(s["id"]) or {}
            if rec.get("error"):
                final.append({**s, "text": "", "raw": "", "status": "error",
                              "reasons": [rec["error"][:120]]})
                continue
            vtext = None
            if vc and s["id"] in vres and not vres[s["id"]].get("error"):
                vtext = vres[s["id"]].get("text", "")
            j = textfilter.judge(s, rec.get("text", ""), mc["language"],
                                 verify_text=vtext, **_judge_kw())
            item = {**s, "raw": rec.get("text", ""), **j}
            if vtext is not None:
                item["verify_text"] = vtext
            final.append(item)

        paths = self._write(final, mc, vc, duration)
        if o.polish:
            paths.append(self._polish(final, mc, vc, duration))
        errors = sum(1 for s in final if s["status"] == "error")
        if errors:
            say(f"  ⚠ {errors}区間は認識に失敗しました。同じコマンドをもう一度実行すると、"
                "失敗した区間だけ送り直します。")
        elif config.DELETE_AUDIO_CACHE and not o.keep_audio:
            self.cleanup_audio()
        return paths

    def _print_plan(self, segs):
        say("  区間(送信はしていません):")
        for s in segs[:40]:
            say(f"    {output.ts(s['start'])}〜{output.ts(s['end'])} "
                f"{s['end'] - s['start']:5.1f}秒 声らしさ 最大{s['max_prob']:.2f}"
                f" 平均{s['mean_prob']:.2f}")
        if len(segs) > 40:
            say(f"    …ほか {len(segs) - 40}区間")

    def _out_paths(self, suffix=""):
        out_dir = self.opts.out or config.OUTPUT_DIR or os.path.dirname(self.src)
        out_dir = os.path.expanduser(out_dir)
        base = f"{self.stem}_文字起こし"
        if self.start or self.end is not None:
            a = output.ts(self.start).replace(":", "")
            b = output.ts(self.end).replace(":", "") if self.end is not None else "end"
            base += f"_{a}-{b}"
        base += suffix
        return os.path.join(out_dir, base + ".md"), os.path.join(out_dir, base + ".srt")

    def _info(self, mc, vc, duration, segs):
        o = self.opts
        st = os.stat(self.src)
        den = {"none": "なし", "rnnoise": f"RNNoise(混ぜる割合 {config.RNNOISE_MIX:g})",
               "bnr": "NVIDIA Maxine BNR"}[o.denoise]
        if o.denoise == "bnr" and not self._bnr_ok:
            den += "(途中で失敗したため一部なし)"
        if config.DUCK_TRANSIENTS:
            den += " / 声のない瞬間の大きな物音を下げる"
        if config.HIGHPASS_HZ:
            den += f" / {config.HIGHPASS_HZ}Hz 以下を切る"
        return {
            "title": f"{self.stem} の文字起こし",
            "source_name": os.path.basename(self.src),
            "recorded": datetime.datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M"),
            "source_duration": self.source_duration or duration,
            "duration": duration,
            "offset": self.start,
            "range_from": self.start if (self.start or self.end is not None) else None,
            "range_to": self.end,
            "speech_sec": sum(s["end"] - s["start"] for s in segs),
            "model_name": mc["name"],
            "model_desc": f"{mc['name']}(言語 {mc['language']})",
            "verify_desc": f"{vc['name']}(言語 {vc['language']})" if vc else "",
            "denoise_desc": den,
            "vad_threshold": o.vad_threshold,
            "vad_denoised": o.vad_denoised,
        }

    def _write(self, final, mc, vc, duration):
        md, srt = self._out_paths()
        info = self._info(mc, vc, duration, final)
        try:
            output.write_markdown(md, info, final, config.GAP_NOTE_SEC)
            output.write_srt(srt, final)
        except PermissionError:
            raise Abort(f"保存できませんでした: {md}\n"
                        "  共有ストレージに書くには、Termux で一度 `termux-setup-storage` を"
                        "実行して許可してください。")
        with open(os.path.join(self.wd, "result.json"), "w", encoding="utf-8") as f:
            json.dump({"info": info, "segments": final}, f, ensure_ascii=False, indent=1)
        n = {k: sum(1 for s in final if s["status"] == k) for k in ("ok", "flag", "drop")}
        say(f"  結果: 本文 {n['ok'] + n['flag']}区間(うち要確認 {n['flag']})/ 除外 {n['drop']}区間")
        say(f"  保存: {md}")
        say(f"        {srt}")
        return [md, srt]

    def _polish(self, final, mc, vc, duration):
        import polish
        o = self.opts
        idx = [i for i, s in enumerate(final) if s["status"] in ("ok", "flag") and s["text"]]
        lines = [final[i]["text"] for i in idx]
        models = [o.polish_model or config.POLISH_MODEL] + list(config.POLISH_FALLBACK_MODELS)
        say(f"読みやすく整える({models[0]}): {len(lines)}行")
        fixed, changed, used = polish.polish_lines(
            lines, self.api_key, config.NVIDIA_BASE_URL, models,
            batch=config.POLISH_BATCH_LINES, min_sim=config.POLISH_MIN_SIMILARITY, log=say)
        pol = [dict(s) for s in final]
        for i, t in zip(idx, fixed):
            pol[i]["text"] = t
        md, _ = self._out_paths("_整形")
        info = self._info(mc, vc, duration, final)
        info["title"] = f"{self.stem} の文字起こし(整形)"
        info["model_desc"] += (f" → {used or '(整形できず)'}で変換ミスと句読点を直した版"
                               f"({changed}行を修正。元の文字起こしは別ファイル)")
        output.write_markdown(md, info, pol, config.GAP_NOTE_SEC)
        say(f"  保存: {md}")
        return md


# ==========================================
# models: モデルが使えるか確かめる
# ==========================================
def cmd_models(args):
    import numpy as np
    key = need_api_key()
    names = [args.name] if args.name else list(config.ASR_MODELS)
    for n in names:
        if n not in config.ASR_MODELS:
            raise Abort(f"モデル {n} は config.py の ASR_MODELS にありません。")
    user = _user_functions()

    say("NVCF の関数一覧から探しています…")
    funcs, why = nvasr.list_functions(key, config.NVCF_FUNCTIONS_URL)
    found = {}
    if funcs is None:
        say(f"  一覧は取れませんでした({why})。設定の function-id で確かめます。")
    else:
        say(f"  {len(funcs)}件の関数が見えました。")
        for n in names:
            ms = nvasr.match_functions(funcs, config.ASR_MODELS[n]["match"])
            found[n] = ms
            for fn in ms[:5]:
                say(f"  {n}: {fn.get('name')}  {fn.get('id')}")
            if not ms:
                say(f"  {n}: 見つかりませんでした")
        bnr = nvasr.match_functions(funcs, ("bnr",))
        for fn in bnr[:3]:
            say(f"  bnr: {fn.get('name')}  {fn.get('id')}")
        if bnr and not user.get("bnr", {}).get("function_id"):
            user.setdefault("bnr", {})["function_id"] = bnr[0].get("id")

    rng = np.random.default_rng(0)
    probe = (rng.standard_normal(int(audio.SR * 1.5)) * 30).astype("<i2").tobytes()
    limiter = nvasr.RateLimiter(20, 6)
    client = nvasr.RivaClient(config.NVIDIA_GRPC_SERVER, key, limiter,
                              timeout=60, max_retries=1,
                              insecure=config.NVIDIA_GRPC_INSECURE, log=say)
    import grpc
    try:
        for n in names:
            base = dict(config.ASR_MODELS[n])
            cands = []
            for fid in ((user.get(n) or {}).get("function_id"), base.get("function_id"),
                        *[fn.get("id") for fn in found.get(n, [])]):
                if fid and fid not in cands:
                    cands.append(fid)
            say(f"\n[{n}] {base['name']}")
            if not cands:
                say("  function-id がありません。build.nvidia.com のこのモデルの API ページで"
                    "確かめ、`python mojiokoshi.py models --set "
                    f"{n} <function-id>` で登録してください。")
                continue
            ok = None
            for fid in cands:
                try:
                    ms = client.list_models(fid)
                    for mname, params in ms[:8]:
                        say(f"  モデル: {mname} 種類={params.get('type', '?')} "
                            f"言語={params.get('language_code', '?')}")
                except grpc.RpcError as e:
                    code = e.code().name if e.code() else "?"
                    if code in ("UNAUTHENTICATED", "PERMISSION_DENIED"):
                        raise Abort(f"API キーが通りません({code})。NVIDIA_API_KEY を確かめてください。")
                    say(f"  ({fid}: モデル一覧は取れませんでした {code})")
                langs = [base["language"]] + [c for c in config.LANGUAGE_CANDIDATES
                                              if c != base["language"]]
                modes = [base["mode"]] + [m for m in ("offline", "streaming") if m != base["mode"]]
                for mode in modes:
                    for lang in langs:
                        try:
                            r = client.recognize(fid, probe, lang, mode, what=n)
                            ok = {"function_id": fid, "language": lang, "mode": mode}
                            say(f"  OK  function-id={fid} 言語={lang} 方式={mode}"
                                f"(雑音だけの音声への応答: 「{r['text'][:20]}」)")
                            break
                        except nvasr.FatalAPIError as e:
                            msg = str(e).splitlines()[0]
                            say(f"  NG  function-id={fid} 言語={lang} 方式={mode}: {msg[:160]}")
                            if "キーが通りません" in msg:
                                raise Abort(msg)
                            if "見つかりません" in msg:
                                break
                        except nvasr.SegmentAPIError as e:
                            say(f"  NG  function-id={fid} 言語={lang} 方式={mode}: {str(e)[:160]}")
                    if ok:
                        break
                if ok:
                    break
            if ok:
                user[n] = ok
            else:
                say("  使える組み合わせが見つかりませんでした。")
    finally:
        client.close()
    _save_user_functions(user)
    say(f"\n確かめた結果を {USER_FUNCTIONS} に保存しました(config.py より優先されます)。")


def cmd_set(args):
    user = _user_functions()
    user.setdefault(args.name, {})["function_id"] = args.function_id
    if args.language:
        user[args.name]["language"] = args.language
    _save_user_functions(user)
    say(f"{args.name} の function-id を {args.function_id} にしました({USER_FUNCTIONS})。")


# ==========================================
# check: 準備ができているか
# ==========================================
def cmd_check(args):
    ok_all = True

    def row(ok, what, note=""):
        nonlocal ok_all
        ok_all &= ok
        say(f"  {'OK' if ok else 'NG'}  {what}{('  ' + note) if note else ''}")

    say("準備の確認:")
    row(sys.version_info >= (3, 9), f"Python {sys.version.split()[0]}")
    for mod, pkg in (("numpy", "python-numpy"), ("onnxruntime", "python-onnxruntime"),
                     ("grpc", "python-grpcio")):
        try:
            m = __import__(mod)
            row(True, f"{mod} {getattr(m, '__version__', '')}")
        except ImportError:
            row(False, mod, f"→ pkg install {pkg}")
    row(bool(shutil.which("ffmpeg")), "ffmpeg", "" if shutil.which("ffmpeg") else "→ pkg install ffmpeg")
    if os.path.isfile(config.VAD_MODEL_PATH):
        try:
            import numpy as np
            vad = audio.SileroVAD(config.VAD_MODEL_PATH)
            t = np.arange(audio.SR * 2) / audio.SR
            # 声に似た音(基本周波数が揺れる倍音)と、雑音
            f0 = 140 + 30 * np.sin(2 * np.pi * 3 * t)
            ph = 2 * np.pi * np.cumsum(f0) / audio.SR
            voice = sum(np.sin(k * ph) / k for k in range(1, 12)) * (0.5 + 0.5 * np.sin(2 * np.pi * 4 * t))
            pcm = (np.concatenate([voice * 3000, np.random.default_rng(1).standard_normal(audio.SR * 2) * 300])
                   ).astype("<i2")
            p = vad.probs(pcm, streams=1, progress=False)
            row(True, "Silero VAD", f"動作OK(テスト音の声らしさ 最大 {p.max():.2f})")
        except Exception as e:      # noqa: BLE001
            row(False, "Silero VAD", f"{type(e).__name__}: {e}")
    else:
        row(False, "Silero VAD のモデル", "→ bash setup.sh")
    row(os.path.isfile(config.RNNOISE_MODEL_PATH), "RNNoise のモデル(--denoise rnnoise 用)",
        "" if os.path.isfile(config.RNNOISE_MODEL_PATH) else "→ bash setup.sh")
    key = load_api_key()
    row(bool(key), config.KEY_NAME, "あり" if key else "→ .bashrc に export を書く")
    if shutil.which("termux-wake-lock"):
        say("  OK  termux-wake-lock(処理中にスマホが眠らないようにする)")
    say("すべて OK です。" if ok_all else "NG の行を直してから使ってください。")


# ==========================================
# 入口
# ==========================================
def _wake_lock(on):
    if not config.WAKE_LOCK:
        return
    cmd = "termux-wake-lock" if on else "termux-wake-unlock"
    if shutil.which(cmd):
        try:
            subprocess.run([cmd], timeout=10, check=False)
        except (subprocess.SubprocessError, OSError):
            pass


def _notify(title, content):
    if not config.NOTIFY or not shutil.which("termux-notification"):
        return
    try:
        subprocess.run(["termux-notification", "--title", title, "--content", content],
                       timeout=10, check=False, capture_output=True)
    except (subprocess.SubprocessError, OSError):
        pass


def build_parser():
    p = argparse.ArgumentParser(
        prog="mojiokoshi.py",
        description="録音を文字起こしする(NVIDIA API)。物音だけの時間は送らない。",
        epilog="ほかに: models(モデルの確認) / models --set 名前 ID / check(準備の確認)")
    p.add_argument("files", nargs="+", help="録音ファイル(m4a・mp3・wav・mp4 など。複数可)")
    p.add_argument("-o", "--out", help="保存先のフォルダ(既定: 録音と同じフォルダ)")
    p.add_argument("--from", dest="start", help="ここから処理する(例 1:02:03)")
    p.add_argument("--to", dest="end", help="ここまで処理する(例 1:30:00)")
    p.add_argument("--model", default=config.ASR_MODEL, choices=list(config.ASR_MODELS),
                   help=f"文字起こしのモデル(既定: {config.ASR_MODEL})")
    p.add_argument("--verify", default=config.VERIFY_MODEL or None,
                   choices=list(config.ASR_MODELS),
                   help="確認用のモデル。これが声なしとした区間を要確認にする")
    p.add_argument("--language", help="言語コードを変える(例 ja / ja-JP / multi)")
    p.add_argument("--denoise", default=config.DENOISE, choices=("none", "rnnoise", "bnr"),
                   help=f"雑音の除去(既定: {config.DENOISE})")
    p.add_argument("--vad-threshold", type=float, default=config.VAD_THRESHOLD,
                   help=f"声とみなす確からしさ 0〜1(既定: {config.VAD_THRESHOLD})")
    p.add_argument("--fast-vad", action="store_true",
                   help="声の検出を元の音声だけで行う(速いが、大きな雑音の下の声を取りこぼしやすい)")
    p.add_argument("--polish", action="store_true",
                   help="LLM で変換ミスと句読点を直した版も作る(_整形.md)")
    p.add_argument("--polish-model", help=f"整形に使うモデル(既定: {config.POLISH_MODEL})")
    p.add_argument("--dry-run", action="store_true",
                   help="声の検出だけして、区間と送信回数の見込みを表示する(送信しない)")
    p.add_argument("--keep-audio", action="store_true",
                   help="変換した音声を作業フォルダに残す(設定を変えてやり直すとき速い)")
    return p


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    try:
        if argv and argv[0] == "models":
            mp = argparse.ArgumentParser(prog="mojiokoshi.py models")
            mp.add_argument("name", nargs="?", help="確かめるモデル(省略ですべて)")
            mp.add_argument("--set", nargs=2, metavar=("名前", "ID"),
                            help="function-id を手で登録する")
            mp.add_argument("--language", help="--set と一緒に言語コードも登録する")
            a = mp.parse_args(argv[1:])
            if a.set:
                a.name, a.function_id = a.set
                return cmd_set(a)
            return cmd_models(a)
        if argv and argv[0] == "check":
            return cmd_check(None)

        opts = build_parser().parse_args(argv)
        opts.start = parse_time(opts.start)
        opts.end = parse_time(opts.end)
        if not 0.0 < opts.vad_threshold < 1.0:
            raise Abort("--vad-threshold は 0〜1 の間で指定してください。")
        opts.vad_neg_threshold = min(config.VAD_NEG_THRESHOLD, opts.vad_threshold - 0.05)
        opts.vad_denoised = config.VAD_DENOISED and not opts.fast_vad
        if opts.vad_denoised and not os.path.isfile(config.RNNOISE_MODEL_PATH):
            say("RNNoise のモデルがないため、声の検出は元の音声だけで行います(setup.sh で入ります)。")
            opts.vad_denoised = False
        if opts.verify == opts.model:
            opts.verify = None
        api_key = None if opts.dry_run else need_api_key()
        opts.bnr_function_id = ""
        if opts.denoise == "bnr" and not opts.dry_run:
            opts.bnr_function_id = (_user_functions().get("bnr") or {}).get("function_id", "")
            if not opts.bnr_function_id:
                raise Abort("BNR の function-id がありません。`python mojiokoshi.py models` で"
                            "探すか、`python mojiokoshi.py models --set bnr <function-id>` で登録してください。")
        if opts.denoise == "rnnoise" and not os.path.isfile(config.RNNOISE_MODEL_PATH):
            raise Abort("RNNoise のモデルがありません。setup.sh をもう一度実行してください。")
    except (Abort, nvasr.FatalAPIError) as e:
        say(str(e))
        return 1

    _wake_lock(True)
    failed = 0
    written = []
    try:
        for f in opts.files:
            try:
                paths = Job(f, opts, api_key).run()
                if paths:
                    written.extend(paths)
            except (Abort, audio.AudioError, nvasr.FatalAPIError) as e:
                failed += 1
                say(f"  ✗ {e}")
    except KeyboardInterrupt:
        say("\n中断しました。ここまでの結果は保存してあります。同じコマンドで続きから再開します。")
        _wake_lock(False)
        return 130
    _wake_lock(False)
    if written:
        _notify("文字起こしが終わりました", os.path.basename(written[0]))
    elif failed and not opts.dry_run:
        _notify("文字起こしが止まりました", "Termux の表示を確かめてください")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
