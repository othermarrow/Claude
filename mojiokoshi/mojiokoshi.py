#!/usr/bin/env python3
"""録音状態の悪い音声を、複数の文字起こしエンジンと複数の LLM で突き合わせて文字にする。

流れ
  1. 前処理   ffmpeg で 16kHz モノラルにし、エンジンごとに違う雑音処理をかける
  2. 区切り   声の切れ目で 40 秒前後の区間に分け、長い無音は送らない
  3. 文字起こし  Groq(Whisper 2種)・NVIDIA(Parakeet ほか)・Gemini(文字起こし専用モデル)
  4. 照合     区間ごとに、Whisper の指標・声の有無・系統の違うエンジンとの一致で
              幻覚(無音で出る定型句・繰り返し・1つだけ違う候補)を見つける
  5. 統合     複数の LLM がそれぞれ候補を読み比べて本文を復元する
  6. 合議     音声認識の候補に根拠がある割合・取りこぼしの少なさ・LLM 同士の一致で
              区間ごとに最良の統合を選び、どの候補にも無い言葉に〔?〕を付ける
  7. 校正     LLM が句読点・誤変換・フィラーを整える。元の文から離れすぎた校正は捨てる
  8. 出力     Markdown(時刻つき)・テキスト・字幕(SRT)・比較表・要確認の一覧

使い方
  python mojiokoshi.py              Converter の音声をすべて(済んだものは飛ばす)
  python mojiokoshi.py 会議.m4a      指定したファイルだけ
  python mojiokoshi.py check        キー・モデル・エンジンが今使えるか確かめる
  python mojiokoshi.py list         入力フォルダの音声と、済んだかどうか
  python mojiokoshi.py selftest     通信せずにできる自己点検
"""

import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import sys
import threading
import time

import asr
import audio
import config
import llm
import net
import textproc as tp

VERSION = "1.3"
LABELS = "ABCDEFGHIJ"
_print_lock = threading.Lock()


def say(*a):
    with _print_lock:
        print(*a, flush=True)


def hms(sec):
    sec = int(round(sec))
    return f"{sec // 3600:02d}:{sec % 3600 // 60:02d}:{sec % 60:02d}"


def srt_time(sec):
    ms = int(round(sec * 1000))
    return f"{ms // 3600000:02d}:{ms % 3600000 // 60000:02d}:{ms % 60000 // 1000:02d},{ms % 1000:03d}"


def sha(obj, n=10):
    s = obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:n]


def load_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    os.replace(tmp, path)


def run_parallel(tasks):
    """[(名前, 関数)] を並行に走らせる。Ctrl-C で止められるよう、デーモンスレッドで待つ。"""
    results, errors, threads = {}, {}, []
    for name, fn in tasks:
        def target(name=name, fn=fn):
            try:
                results[name] = fn()
            except net.Stopped:
                pass
            except BaseException as e:          # noqa: BLE001 呼び出し元で表示する
                errors[name] = e
        t = threading.Thread(target=target, daemon=True)
        t.start()
        threads.append(t)
    while any(t.is_alive() for t in threads):
        for t in threads:
            t.join(0.3)
    return results, errors


# ==========================================
# 1〜2. 前処理と区切り
# ==========================================
_profile_locks = {}
_profile_locks_lock = threading.Lock()


def workdir_for(src):
    st = os.stat(src)
    fsig = sha([os.path.abspath(src), st.st_size, int(st.st_mtime)])
    csig = sha([config.CHUNK_TARGET_SEC, config.CHUNK_MAX_SEC, config.CHUNK_MIN_SEC, config.SILENCE_SKIP_SEC,
                config.VAD_MARGIN_DB, config.VAD_HANGOVER_SEC, config.MIN_SPEECH_RATIO], 6)
    stem = re.sub(r"[^\w\-]+", "_", os.path.splitext(os.path.basename(src))[0])[:40]
    wd = os.path.join(config.WORK_DIR, f"{stem}_{fsig}_{csig}")
    os.makedirs(wd, exist_ok=True)
    return wd


def prepare(src, wd):
    base = os.path.join(wd, "base.wav")
    if not os.path.exists(base):
        say("  音声を 16kHz モノラルに変換中…")
        audio.decode(src, base + ".tmp.wav")
        os.replace(base + ".tmp.wav", base)
    duration = audio.wav_duration(base)
    chunks = load_json(os.path.join(wd, "chunks.json"))
    vad = load_json(os.path.join(wd, "vad.json"))
    if chunks is None or vad is None:
        say("  声のある所を探しています…")
        levels = audio.frame_levels(base, os.path.join(wd, "levels.txt"))
        vad = audio.detect_speech(levels)
        chunks = audio.make_chunks(levels, vad, duration)
        save_json(os.path.join(wd, "vad.json"), vad)
        save_json(os.path.join(wd, "chunks.json"), chunks)
    return {"src": src, "wd": wd, "base": base, "duration": duration, "vad": vad, "chunks": chunks}


def profile_wav(ctx, name):
    if config.AUDIO_PROFILES.get(name) == "":
        return ctx["base"]                 # 前処理なしは、変換しただけの音声をそのまま使う
    path = os.path.join(ctx["wd"], f"p_{name}.wav")
    with _profile_locks_lock:
        lock = _profile_locks.setdefault(path, threading.Lock())
    with lock:
        if not os.path.exists(path):
            say(f"  前処理「{name}」をかけています…")
            audio.make_profile(ctx["base"], name, path + ".tmp.wav")
            os.replace(path + ".tmp.wav", path)
    return path


# ==========================================
# 3. 文字起こし
# ==========================================
_SIG_IGNORE = {"enabled", "trust", "max_request_sec"}     # 結果を変えない設定


def engine_sig(e, glossary, legacy=None):
    d = {k: v for k, v in e.items() if not k.startswith("_") and k not in _SIG_IGNORE}
    if legacy is not None:               # 1.2 までの名前(trust・max_request_sec も含めていた)
        d = {k: v for k, v in e.items() if not k.startswith("_") and k != "enabled"}
        if "max_request_sec" in d:
            d["max_request_sec"] = legacy
    extra = [glossary.signature() if e.get("glossary") else "", config.ASR_LANGUAGE,
             config.ASR_LANGUAGE_BCP47, config.UPLOAD_FORMAT, config.RIVA_AUDIO,
             config.AUDIO_PROFILES.get(e.get("audio", "raw"))]
    return sha([d, extra], 8)


def asr_cache_path(e, ctx, glossary):
    path = os.path.join(ctx["wd"], f"asr_{e['name']}_{engine_sig(e, glossary)}.json")
    if not os.path.exists(path):
        # 1.2 までの途中経過を引き継ぐ(1日の回数の上限がある分を取り直さないため)
        for old in (e.get("max_request_sec"), 600):
            p = os.path.join(ctx["wd"], f"asr_{e['name']}_{engine_sig(e, glossary, legacy=old)}.json")
            if os.path.exists(p):
                shutil.copyfile(p, path)
                break
    return path


def plan_groups(chunks, max_sec):
    groups, cur, dur = [], [], 0.0
    for c in chunks:
        d = c["end"] - c["start"]
        if cur and (dur + d > max_sec):
            groups.append(cur)
            cur, dur = [], 0.0
        cur.append(c)
        dur += d
    if cur:
        groups.append(cur)
    return groups


def distribute(units, grp, layout):
    """送った音声での時刻の units を、区間ごとに振り分け、元の録音の時刻に直す。"""
    out = [[] for _ in grp]
    untimed = []
    for u in units:
        if not u.get("timed", True):
            untimed.append(u)
            continue
        mid = (u["start"] + u["end"]) / 2
        k = min(range(len(layout)), key=lambda i: 0 if layout[i][0] <= mid < layout[i][1]
                else min(abs(mid - layout[i][0]), abs(mid - layout[i][1])))
        off = layout[k][2] - layout[k][0]
        out[k].append(dict(u, start=round(u["start"] + off, 2), end=round(u["end"] + off, 2)))
    if untimed:
        text = tp.join_units(u["text"] for u in untimed)
        parts = tp.split_proportional(text, [c["speech"] for c in grp]) if len(grp) > 1 else [text]
        for k, p in enumerate(parts):
            if p.strip():
                out[k].append({"start": grp[k]["start"], "end": grp[k]["end"], "text": p, "timed": False})
    return out


def asr_worker(e, ctx, glossary, label):
    path = asr_cache_path(e, ctx, glossary)
    cache = load_json(path) or {"chunks": {}}
    todo = [c for c in ctx["chunks"] if not c["silent"] and str(c["id"]) not in cache["chunks"]]
    total = sum(1 for c in ctx["chunks"] if not c["silent"])
    if not todo:
        return cache
    wav = profile_wav(ctx, e.get("audio", "raw"))
    riva = e["kind"].startswith("riva")
    fmt = ("pcm" if config.RIVA_AUDIO == "pcm" else "flac") if riva else config.UPLOAD_FORMAT
    max_sec = e.get("max_request_sec") or 0
    groups = plan_groups(todo, max_sec) if max_sec else [[c] for c in todo]
    tmpbase = os.path.join(ctx["wd"], f"req_{e['name']}")
    fails, last_t = 0, 0.0
    cache.pop("error", None)
    for gi, grp in enumerate(groups):
        pieces = [(c["start"], c["end"]) for c in grp]
        fpath, pcm, layout = audio.build_request_audio(wav, pieces, tmpbase, fmt)
        a = asr.Audio(fpath, fmt, pcm, layout[-1][1])
        try:
            res = asr.transcribe(e, a, glossary)
            fails = 0
        except asr.EngineFatal as ex:
            cache["error"] = str(ex)
            save_json(path, cache)
            say(f"  ✗ {label} {e['name']}: 使えません — {ex}")
            return cache
        except net.QuotaExhausted as ex:
            cache["error"] = f"上限: {ex}"
            save_json(path, cache)
            say(f"  ✗ {label} {e['name']}: 回数・量の上限に達しました。残りは次に実行したときに送ります — {ex.message[:120]}")
            return cache
        except (net.ApiError, asr.GrpcError, ValueError, OSError, AttributeError, KeyError) as ex:
            fails += 1
            say(f"  ! {label} {e['name']}: 区間 {grp[0]['id']}〜{grp[-1]['id']} が失敗 — {type(ex).__name__}: {ex}")
            if fails >= 3:
                cache["error"] = f"{type(ex).__name__}: {ex}"
                save_json(path, cache)
                say(f"  ✗ {label} {e['name']}: 続けて失敗したので、今回はここまでにします")
                return cache
            continue
        finally:
            if fpath and os.path.exists(fpath):
                os.remove(fpath)
        for c, units in zip(grp, distribute(res["units"], grp, layout)):
            cache["chunks"][str(c["id"])] = units
        if res.get("prompt"):
            cache["prompt"] = res["prompt"]
        save_json(path, cache)
        if time.time() - last_t > 20 or gi == len(groups) - 1:
            last_t = time.time()
            say(f"    {label} {e['name']}: {len(cache['chunks'])}/{total} 区間")
    return cache


def run_asr(ctx, engines, glossary):
    tasks = [(e["name"], (lambda e=e, lb=LABELS[i]: asr_worker(e, ctx, glossary, lb)))
             for i, e in enumerate(engines)]
    results, errors = run_parallel(tasks)
    for name, ex in errors.items():
        say(f"  ✗ {name}: 予期しないエラー — {type(ex).__name__}: {ex}")
        results[name] = {"chunks": {}, "error": f"予期しないエラー {type(ex).__name__}: {ex}"}
    return results


# ==========================================
# 4. 照合(区間ごと)
# ==========================================
def _speech_frac(vad, s, e):
    return audio.speech_seconds(vad["raw"], s, e) / max(e - s, 1e-6)


def assemble(ctx, engines, results, glossary):
    """区間ごとに、各エンジンの文・正規化した文・一致度・注記をまとめる。"""
    vad = ctx["vad"]
    fam_of = {e["name"]: e.get("family", e["name"]) for e in engines}
    fam_ids = {}
    for e in engines:
        fam_ids.setdefault(fam_of[e["name"]], len(fam_ids) + 1)
    gkanji = glossary.kanji_set() if glossary else frozenset()
    # 半分以上の区間が話し言葉になっていないエンジンは、このファイルでは丸ごと外す
    junk_engines = {}
    for e in engines:
        outs = [tp.clean_asr_text(tp.join_units(u.get("text", "") for u in us))
                for us in ((results.get(e["name"]) or {}).get("chunks") or {}).values()]
        outs = [t for t in outs if t]
        bad = sum(1 for t in outs if tp.junk_reason(t, gkanji))
        if len(outs) >= 5 and bad / len(outs) > 0.5:
            junk_engines[e["name"]] = f"{bad}/{len(outs)} 区間が用語・漢字の羅列"
    ctx["junk_engines"] = junk_engines
    for name, why in junk_engines.items():
        say(f"  ✗ {name}: このファイルでは使いません — {why}")
    table = {}
    for c in ctx["chunks"]:
        row = {"chunk": c, "texts": {}, "notes": {}, "dropped": {}}
        table[c["id"]] = row
        if c["silent"]:
            continue
        for e in engines:
            if e["name"] in junk_engines:
                continue
            res = results.get(e["name"]) or {}
            units = (res.get("chunks") or {}).get(str(c["id"]))
            if units is None:
                continue                     # このエンジンはこの区間を返していない
            prompt_n = tp.norm(res.get("prompt", ""), drop_fillers=False)
            kept, dropped = [], []
            for u in units:
                t = u.get("text") or ""
                nsp, lp = u.get("no_speech_prob"), u.get("avg_logprob")
                if nsp is not None and lp is not None and nsp > config.WHISPER_NO_SPEECH_PROB and lp < config.WHISPER_LOGPROB:
                    dropped.append(("無音らしい", t))
                    continue
                dur = (u.get("end") or 0) - (u.get("start") or 0)
                if u.get("timed", True) and not u.get("word") and dur >= 1.0 and _speech_frac(vad, u["start"], u["end"]) < 0.05:
                    dropped.append(("声の無い所", t))
                    continue
                if prompt_n:
                    tn = tp.norm(t, drop_fillers=False)
                    if len(tn) >= 6 and tp.coverage(tn, [prompt_n], 3) > 0.7:
                        dropped.append(("用語集の書き写し", t))
                        continue
                kept.append(t)
            text = tp.clean_asr_text(tp.join_units(kept))
            why = tp.junk_reason(text, gkanji)
            if why:
                dropped.append((why, text))
                text = ""
            row["texts"][e["name"]] = text
            if dropped:
                row["dropped"][e["name"]] = dropped
        texts = row["texts"]
        # 動画の定型句: 系統の違うエンジン(何も聞き取らなかったものを含む)に無ければ消す。
        # 他の系統の結果が無い区間では、声の少ない区間に出た動画の定型句だけ消す。
        for name in list(texts):
            t = texts[name]
            if not t:
                continue
            others = [tp.norm(texts[o], False) for o in texts if fam_of[o] != fam_of[name]]
            phrases = list(config.HALLUCINATION_STRONG)
            if c["ratio"] < 0.3 and others:
                phrases += config.HALLUCINATION_WEAK
            if not others and c["ratio"] >= 0.3:
                continue
            rm = [h for h in tp.find_phrases(t, phrases)
                  if not any(tp.norm(h[2], False) in o for o in others)]
            if rm:
                row["dropped"].setdefault(name, []).extend(("定型句", t[s:e]) for s, e, _ in rm)
                texts[name] = tp.remove_spans(t, rm)
        # 1つの系統だけが、声のほとんど無い区間で何か書いた → 幻覚とみなす
        fams_with = {fam_of[n] for n in texts if texts[n]}
        fams_all = {fam_of[n] for n in texts}
        if len(fams_with) == 1 and len(fams_all) >= 3 and c["ratio"] < 0.15:
            for n in texts:
                if texts[n]:
                    row["dropped"].setdefault(n, []).append(("1系統だけ", texts[n]))
                    texts[n] = ""
        norms = {n: tp.norm(t) for n, t in texts.items()}
        row["norms"] = norms
        names = [n for n in texts if norms[n]]
        # 一致度: 系統の違う組の平均(1系統しか無ければ全組)
        pairs = [(a, b) for i, a in enumerate(names) for b in names[i + 1:] if fam_of[a] != fam_of[b]]
        if not pairs:
            pairs = [(a, b) for i, a in enumerate(names) for b in names[i + 1:]]
        sims = {(a, b): tp.ratio(norms[a], norms[b]) for a, b in pairs}
        row["agreement"] = round(sum(sims.values()) / len(sims), 3) if sims else None
        mean_sim = {}
        for n in names:
            vals = [v for (a, b), v in sims.items() if n in (a, b)]
            mean_sim[n] = sum(vals) / len(vals) if vals else 0.0
        row["mean_sim"] = mean_sim
        best_pair = max(sims.values()) if sims else 0.0
        trust = {e["name"]: e.get("trust", 0.5) for e in engines}
        medoid = max(names, key=lambda n: (mean_sim[n] + 0.15 * trust[n], len(norms[n]))) if names else None
        row["medoid"] = medoid
        # 2つ以上の系統が一致した内容(取りこぼしの測りに使う)
        if medoid:
            others = [norms[o] for o in names if fam_of[o] != fam_of[medoid]] or [norms[o] for o in names if o != medoid]
            mask = tp.covered_mask(norms[medoid], others, 3)
            row["consensus"] = "".join(ch for ch, m in zip(norms[medoid], mask) if m)
        else:
            row["consensus"] = ""
        for e in engines:
            n = e["name"]
            if n not in texts:
                continue
            note = [f"系統{fam_ids[fam_of[n]]}"]
            if not texts[n]:
                note.append("出力なし")
            else:
                if len(names) >= 3 and mean_sim.get(n, 1) < 0.35 and best_pair >= 0.6:
                    note.append("外れ値")
                if c["speech"] > 0 and len(norms[n]) / max(c["speech"], 1.0) > config.MAX_CHARS_PER_SEC:
                    note.append("多すぎる")
                lps = [u.get("avg_logprob") for u in (results.get(n, {}).get("chunks", {}).get(str(c["id"])) or [])
                       if u.get("avg_logprob") is not None]
                if lps and sum(lps) / len(lps) < -0.8:
                    note.append("低信頼")
            row["notes"][n] = "・".join(note)
    return table


# ==========================================
# 5. 統合
# ==========================================
def merge_items(ctx, engines, table):
    items = []
    chunks = ctx["chunks"]
    for c in chunks:
        row = table[c["id"]]
        if c["silent"] or not any(row["texts"].values()):
            continue
        cands = [(LABELS[i], row["texts"][e["name"]], row["notes"].get(e["name"], ""))
                 for i, e in enumerate(engines) if e["name"] in row["texts"]]
        notes = []
        if row.get("agreement") is not None:
            notes.append(f"系統の違う候補どうしの一致度 {row['agreement']:.2f}。")
        items.append({"id": c["id"], "time": f"{hms(c['start'])}–{hms(c['end'])}",
                      "speech": f"{int(round(c['ratio'] * 100))}%", "cands": cands, "notes": notes,
                      "h": sha([cands, notes, MERGE_VERSION])})

    def ctx_text(cid):
        row = table.get(cid)
        if not row or not row.get("medoid"):
            return ""
        return row["texts"][row["medoid"]]
    for it in items:
        it["before"] = ctx_text(it["id"] - 1)[-120:]
        it["after"] = ctx_text(it["id"] + 1)[:120]
    return items


MERGE_VERSION = 1
PROOF_VERSION = 1


def llm_worker(stage, model, items, ctx, glossary_text, batch, fn, validate):
    """llm_worker_one を呼び、モデルが使えなければ(404・403)同じ枠の次の候補で続ける。"""
    tried = set()
    while True:
        tried.add(model["model"])
        state = {}
        cache = llm_worker_one(stage, model, items, ctx, glossary_text, batch, fn, validate, state)
        if not state.get("unavailable"):
            return cache
        try:
            nxt = llm.resolve(model["name"], exclude=tried)
        except llm.ModelUnavailable:
            return cache
        say(f"  → {model['name']}: {nxt['model']} に切り替えます")
        model = nxt


def llm_worker_one(stage, model, items, ctx, glossary_text, batch, fn, validate, outer):
    """items を batch 個ずつ LLM に送り、区間ごとの結果をキャッシュに残す。

    まとめて送って返ってこなかった区間(出力が途中で切れた等)は、1つずつ送り直す。
    """
    path = os.path.join(ctx["wd"], f"{stage}_{model['name']}_{sha([model['model'], glossary_text], 8)}.json")
    cache = load_json(path) or {"chunks": {}}
    cache["model"] = f"{model['provider']}:{model['model']}"
    stage_ja = "統合" if stage == "merge" else "校正"

    def have(x):
        return (cache["chunks"].get(str(x["id"])) or {}).get("h") == x["h"]
    todo = [it for it in items if not have(it)]
    if not todo:
        return cache
    state = {"fails": 0}

    def call(lst):
        try:
            got, _finish = fn(model, lst, glossary_text)
            state["fails"] = 0
        except (net.QuotaExhausted, llm.ModelUnavailable) as ex:
            say(f"  ✗ {stage_ja} {model['name']}({model['model']}): 今回はここまで — {str(ex)[:160]}")
            if isinstance(ex, llm.ModelUnavailable):
                outer["unavailable"] = True
            return "stop"
        except net.ApiError as ex:
            low = (ex.message or "").lower()
            if ex.status == 413 or (ex.status == 400 and ("too large" in low or "context" in low or "reduce" in low)):
                # 1回に送る量が多すぎる(Groq の無料枠は1分あたりのトークン数が小さい)→ 半分ずつ送る
                if len(lst) > 1:
                    half = len(lst) // 2
                    a = call(lst[:half])
                    return a if a == "stop" else call(lst[half:])
                say(f"  ! {stage_ja} {model['name']}: 区間 {lst[0]['id']} は1つでも大きすぎて送れない")
                return "fail"
            state["fails"] += 1
            say(f"  ! {stage_ja} {model['name']}: 失敗 — {str(ex)[:160]}")
            return "stop" if state["fails"] >= 3 else "fail"
        for x in lst:
            if x["id"] in got:
                ok = validate(x, got[x["id"]])
                cache["chunks"][str(x["id"])] = {"h": x["h"], "text": got[x["id"]] if ok else None,
                                                 "rejected": None if ok else got[x["id"]]}
        save_json(path, cache)
        return "ok"

    batches = [todo[i:i + batch] for i in range(0, len(todo), batch)]
    last_t = 0.0
    for bi, b in enumerate(batches):
        st = call(b)
        if st == "stop":
            return cache
        missing = [x for x in b if not have(x)]
        if st == "ok" and len(b) > 1:
            for x in missing:
                if call([x]) == "stop":
                    return cache
        if time.time() - last_t > 20 or bi == len(batches) - 1:
            last_t = time.time()
            say(f"    {stage_ja} {model['name']}: {sum(1 for it in items if have(it))}/{len(items)} 区間")
    return cache


def gloss_for(glossary, model):
    return glossary.for_llm(model.get("glossary_chars", 4000)) if glossary else ""


def resolve_models(names, label):
    out = []
    for n in names:
        try:
            out.append(llm.resolve(n))
        except llm.ModelUnavailable as ex:
            say(f"  - {label} {n}: 使いません — {ex}")
    return out


def run_merge(ctx, engines, table, glossary, models):
    items = merge_items(ctx, engines, table)
    if not items or not models:
        return {}, items

    def validate(it, text):
        longest = max((len(tp.norm(t)) for _, t, _ in it["cands"]), default=0)
        return len(tp.norm(text)) <= 2 * longest + 20
    def work(m, lst):
        return lambda: llm_worker("merge", m, lst, ctx, gloss_for(glossary, m), m["batch"], llm.merge, validate)
    results, errors = run_parallel([(m["name"], work(m, items)) for m in models])
    # どの LLM からも統合が返らなかった区間だけ、代わりの LLM に回す
    for name in [n for n in config.MERGE_BACKUPS if n not in results]:
        missing = [it for it in items if not any(
            ((r.get("chunks") or {}).get(str(it["id"])) or {}).get("text") is not None
            and ((r.get("chunks") or {}).get(str(it["id"])) or {}).get("h") == it["h"] for r in results.values())]
        if not missing:
            break
        found = resolve_models([name], "統合の代わり")
        if not found:
            continue
        m = found[0]
        say(f"  [統合の代わり] {m['name']}={m['model']} に {len(missing)} 区間")
        more, err2 = run_parallel([(m["name"], work(m, missing))])
        results.update(more)
        errors.update(err2)
    for name, ex in errors.items():
        say(f"  ✗ 統合 {name}: 予期しないエラー — {type(ex).__name__}: {ex}")
    return results, items


# ==========================================
# 6. 合議
# ==========================================
def choose(ctx, table, merges, items, glossary):
    gloss_ns = glossary.norm_terms() if glossary else []
    chosen = {}
    for it in items:
        cid = it["id"]
        row = table[cid]
        asr_ns = [n for n in row["norms"].values() if n]
        cands = {}
        for name, cache in merges.items():
            ent = (cache.get("chunks") or {}).get(str(cid))
            if ent and ent.get("h") == it["h"] and ent.get("text") is not None:
                cands[name] = ent["text"]
        info = {"scores": {}, "flags": []}
        if cands:
            mn = {k: tp.norm(v) for k, v in cands.items()}
            for k in cands:
                info["scores"][k] = tp.score_merge(mn[k], asr_ns, row["consensus"], [mn[o] for o in mn if o != k])
            best = max(cands, key=lambda k: info["scores"][k][0])
            text, by = cands[best], best
            if asr_ns and info["scores"][best][1] < 0.5:
                info["flags"].append(f"統合の根拠が薄い(根拠率 {info['scores'][best][1]:.2f})ため音声認識の候補を採用")
                text, by = row["texts"][row["medoid"]], f"ASR:{row['medoid']}"
        elif row.get("medoid"):
            text, by = row["texts"][row["medoid"]], f"ASR:{row['medoid']}"
            info["flags"].append("LLM の統合なし(音声認識の候補をそのまま採用)")
        else:
            text, by = "", "-"
        text = text.strip()
        if text and asr_ns and not by.startswith("ASR:"):
            text, nmark = tp.mark_unsupported(text, asr_ns, gloss_ns)
            if nmark:
                info["flags"].append(f"候補に無い言葉 {nmark} か所に〔?〕")
        info.update(text=text, by=by)
        chosen[cid] = info
    return chosen


# ==========================================
# 7. 校正
# ==========================================
def proof_ok(src, out, asr_ns):
    a = tp.norm(tp.strip_marks(src))
    b = tp.norm(tp.strip_marks(out))
    if not a:
        return not b, "元が空"
    sim = tp.ratio(a, b)
    if sim < config.PROOF_MIN_SIMILARITY:
        return False, f"元の文との一致 {sim:.2f}"
    if len(b) > len(a) * config.PROOF_MAX_GROWTH + 3:
        return False, f"長さ {len(b) / len(a):.2f} 倍"
    for mark in (config.INAUDIBLE_MARK, config.UNCERTAIN_MARK):
        if out.count(mark) < src.count(mark):
            return False, f"{mark} が消えた"
    if tp.new_unsupported(src, out, asr_ns):
        return False, "元にも候補にも無い言葉が入った"
    return True, f"{sim:.2f}"


def run_proof(ctx, table, chosen, glossary, models):
    items = [{"id": cid, "text": info["text"], "h": sha([info["text"], config.FILLER_MODE, PROOF_VERSION])}
             for cid, info in sorted(chosen.items()) if info["text"]]
    if not items or not models:
        return {}

    def validate(it, text):
        return bool(text) or not it["text"]

    def work(m, lst):
        return lambda: llm_worker("proof", m, lst, ctx, gloss_for(glossary, m), m.get("proof_batch", config.PROOF_BATCH),
                                  llm.proof, validate)
    primary, backups = models[:config.PROOF_COUNT], models[config.PROOF_COUNT:]
    results, errors = run_parallel([(m["name"], work(m, items)) for m in primary])
    # 校正が1つも返らなかった区間だけ、次の候補のモデルに回す(上限に達したときなど)
    for m in backups:
        missing = [it for it in items if not any(
            ((r.get("chunks") or {}).get(str(it["id"])) or {}).get("h") == it["h"] for r in results.values())]
        if not missing:
            break
        say(f"  [校正の代わり] {m['name']}={m['model']} に {len(missing)} 区間")
        more, err2 = run_parallel([(m["name"], work(m, missing))])
        results.update(more)
        errors.update(err2)
    for name, ex in errors.items():
        say(f"  ✗ 校正 {name}: 予期しないエラー — {type(ex).__name__}: {ex}")
    return results


def finalize(table, chosen, proofs, glossary):
    final = {}
    for cid, info in chosen.items():
        src = info["text"]
        asr_ns = [n for n in table[cid]["norms"].values() if n] if table[cid].get("norms") else []
        h = sha([src, config.FILLER_MODE, PROOF_VERSION])
        ok, why = {}, {}
        for name, cache in proofs.items():
            ent = (cache.get("chunks") or {}).get(str(cid))
            if not ent or ent.get("h") != h or ent.get("text") is None:
                continue
            good, reason = proof_ok(src, ent["text"], asr_ns)
            why[name] = reason
            if good:
                ok[name] = ent["text"]
        if ok:
            on = {k: tp.norm(tp.strip_marks(v)) for k, v in ok.items()}
            sn = tp.norm(tp.strip_marks(src))

            def score(k):
                others = [tp.ratio(on[k], on[o]) for o in on if o != k]
                return tp.ratio(on[k], sn) + (sum(others) / len(others) if others else 0)
            best = max(ok, key=score)
            text, proof_by = ok[best], best
        else:
            text, proof_by = src, None
            if config.FILLER_MODE == "remove":
                text = tp.strip_fillers(text)
        if glossary:
            text = glossary.apply_rules(text)
        text = re.sub(r"[ 　]+\n", "\n", text).strip()
        final[cid] = {"text": text, "proof_by": proof_by, "proof_checks": why}
    return final


# ==========================================
# 8. 出力
# ==========================================
_SENT_END = tuple("。！？!?」』）)〕")


def make_paragraphs(pieces, max_chars=700):
    """区間の文を段落にまとめる。文の途中で終わる区間は、次の区間と同じ段落にする。

    戻り値: [(段落の最初の区間, 本文)]。長い無音をはさむ所では必ず段落を分ける。
    """
    paras, cur, cur_c, prev = [], "", None, None
    for c, t in pieces:
        gap = prev is not None and c["start"] - prev["end"] >= config.SILENCE_SKIP_SEC - 0.5
        if cur and (gap or cur.rstrip().endswith(_SENT_END) or len(cur) >= max_chars or "\n" in t[:1]):
            paras.append((cur_c, cur.strip()))
            cur, cur_c = "", None
        if cur_c is None:
            cur_c = c
        cur += t.strip() if not cur else (t.strip() if cur[-1:] in "、，" or not cur[-1:].isascii() else " " + t.strip())
        prev = c
    if cur:
        paras.append((cur_c, cur.strip()))
    return paras


def write_outputs(ctx, out_stem, engines, results, table, merges, chosen, final, models_used, started):
    os.makedirs(config.OUTPUT_DIR, exist_ok=True)
    detail = os.path.join(config.OUTPUT_DIR, f"{out_stem}_詳細")
    os.makedirs(detail, exist_ok=True)
    chunks = ctx["chunks"]
    pieces = [(c, final[c["id"]]["text"]) for c in chunks if c["id"] in final and final[c["id"]]["text"]]
    paras = make_paragraphs(pieces)
    agreements = [table[c["id"]]["agreement"] for c in chunks if table[c["id"]].get("agreement") is not None]
    avg_agree = sum(agreements) / len(agreements) if agreements else None
    body = "\n\n".join(t for _, t in paras)
    n_unc = body.count(config.UNCERTAIN_MARK)
    n_ina = body.count(config.INAUDIBLE_MARK)
    used = [e["name"] for e in engines if (results.get(e["name"]) or {}).get("chunks")]
    missing = []
    total_voiced = sum(1 for c in chunks if not c["silent"])
    for e in engines:
        got = len((results.get(e["name"]) or {}).get("chunks") or {})
        if got < total_voiced:
            err = (results.get(e["name"]) or {}).get("error") or "未処理"
            missing.append(f"{e['name']}({got}/{total_voiced} 区間。{err[:80]})")
    status = "完了" if not missing else "一部のエンジン欠け"
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    title = os.path.splitext(os.path.basename(ctx["src"]))[0]

    def yaml_list(xs):
        return "[" + ", ".join(json.dumps(x, ensure_ascii=False) for x in xs) + "]"
    fm = ["---",
          f"source: {json.dumps(os.path.basename(ctx['src']), ensure_ascii=False)}",
          f'duration: "{hms(ctx["duration"])}"',
          f"transcribed: {now}",
          f"engines: {yaml_list(used)}",
          f"merge_models: {yaml_list(models_used['merge'])}",
          f"proof_models: {yaml_list(models_used['proof'])}",
          f"agreement: {round(avg_agree, 2) if avg_agree is not None else 'null'}",
          f"uncertain: {n_unc}",
          f"inaudible: {n_ina}",
          f"status: {status}",
          f"tags: {yaml_list(config.OBSIDIAN_TAGS)}",
          "---", "", f"# {title}", ""]
    md = fm[:]
    for c, t in paras:
        md.append(f"**[{hms(c['start'])}]** {t}" if config.MD_TIMESTAMPS else t)
        md.append("")
    with open(os.path.join(config.OUTPUT_DIR, f"{out_stem}.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md).rstrip() + "\n")
    with open(os.path.join(config.OUTPUT_DIR, f"{out_stem}.txt"), "w", encoding="utf-8") as f:
        f.write(body + "\n")
    if config.WRITE_UNMARKED_COPY:
        with open(os.path.join(detail, f"{out_stem}_記号なし.txt"), "w", encoding="utf-8") as f:
            f.write(re.sub(r"[ 　]{2,}", " ", tp.strip_marks(body)) + "\n")
    # 字幕(区間ごと)
    srt = []
    for i, (c, t) in enumerate(pieces, 1):
        srt += [str(i), f"{srt_time(c['start'])} --> {srt_time(c['end'])}", t.replace("\n", " "), ""]
    with open(os.path.join(detail, f"{out_stem}.srt"), "w", encoding="utf-8") as f:
        f.write("\n".join(srt))
    # 統合前(逐語に近い)の本文
    with open(os.path.join(detail, "統合_校正前.txt"), "w", encoding="utf-8") as f:
        for c in chunks:
            if c["id"] in chosen and chosen[c["id"]]["text"]:
                f.write(f"[{hms(c['start'])}] {chosen[c['id']]['text']}\n")
    # エンジンごとの生の結果
    for i, e in enumerate(engines):
        res = results.get(e["name"]) or {}
        lines = []
        for c in chunks:
            units = (res.get("chunks") or {}).get(str(c["id"]))
            if units:
                lines.append(f"[{hms(c['start'])}] " + tp.clean_asr_text(tp.join_units(u.get("text", "") for u in units)))
        with open(os.path.join(detail, f"{LABELS[i]}_{e['name']}.txt"), "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    # 比較表と要確認
    cmp_lines = [f"# {title} の比較", "",
                 "候補: " + " / ".join(f"{LABELS[i]} = {e['name']}" for i, e in enumerate(engines)), ""]
    review = [f"# {title} の要確認", "",
              f"一致度 {config.REVIEW_AGREEMENT} 未満・〔?〕〔聞き取れず〕・統合の失敗がある区間。録音の該当時刻を聞き直してください。", ""]
    for c in chunks:
        if c["silent"]:
            continue
        row, info, fin = table[c["id"]], chosen.get(c["id"]), final.get(c["id"])
        ag = row.get("agreement")
        cmp_lines.append(f"## [{hms(c['start'])}–{hms(c['end'])}] 区間 {c['id']}"
                         f"(声 {int(c['ratio'] * 100)}%・一致度 {'-' if ag is None else f'{ag:.2f}'})")
        for i, e in enumerate(engines):
            if e["name"] in row["texts"]:
                cmp_lines.append(f"- **{LABELS[i]}** ({row['notes'].get(e['name'], '')}) {row['texts'][e['name']] or '(なし)'}")
            for why, t in row["dropped"].get(e["name"], []):
                cmp_lines.append(f"  - 捨てた({why}): {t}")
        for name, cache in merges.items():
            ent = (cache.get("chunks") or {}).get(str(c["id"]))
            if ent:
                sc = (info or {}).get("scores", {}).get(name)
                scs = f"点 {sc[0]:.2f}・根拠 {sc[1]:.2f}・網羅 {sc[2]:.2f}・LLM一致 {sc[3]:.2f}" if sc else ""
                t = ent.get("text") if ent.get("text") is not None else f"(不採用: 長すぎる) {ent.get('rejected')}"
                cmp_lines.append(f"- 統合 {name} {scs}: {t}")
        if info:
            cmp_lines.append(f"- **採用**({info['by']}): {info['text']}")
            for fl in info["flags"]:
                cmp_lines.append(f"  - {fl}")
        if fin:
            if fin["proof_by"]:
                cmp_lines.append(f"- **最終**(校正 {fin['proof_by']}): {fin['text']}")
            else:
                cmp_lines.append(f"- **最終**(校正なし): {fin['text']}")
            for name, why in fin["proof_checks"].items():
                cmp_lines.append(f"  - 校正 {name}: {why}")
        cmp_lines.append("")
        text = (fin or {}).get("text", "")
        reasons = []
        if ag is not None and ag < config.REVIEW_AGREEMENT:
            reasons.append(f"一致度 {ag:.2f}")
        if config.UNCERTAIN_MARK in text or config.INAUDIBLE_MARK in text:
            reasons.append("〔?〕/〔聞き取れず〕あり")
        if info and info["flags"]:
            reasons += info["flags"]
        if reasons:
            review.append(f"- **[{hms(c['start'])}–{hms(c['end'])}]** {'・'.join(reasons)}")
            review.append(f"  - {text or '(空)'}")
    with open(os.path.join(detail, "比較.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(cmp_lines) + "\n")
    if len(review) == 4:
        review.append("なし")
    if ctx.get("junk_engines"):
        review += ["", "## 外したエンジン(出力が話し言葉になっていない)", ""] + \
                  [f"- {n}: {w}" for n, w in ctx["junk_engines"].items()]
    if missing:
        review += ["", "## 欠けたエンジン", ""] + [f"- {m}" for m in missing] + \
                  ["", "時間をおいて `python mojiokoshi.py --force ファイル名` を実行すると、欠けた分だけ問い合わせて作り直します。"]
    with open(os.path.join(detail, "要確認.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(review) + "\n")
    took = time.time() - started
    say(f"  ✓ 書き出しました: {os.path.join(config.OUTPUT_DIR, out_stem + '.md')}")
    say(f"    一致度の平均 {('-' if avg_agree is None else f'{avg_agree:.2f}')}・〔?〕{n_unc}・〔聞き取れず〕{n_ina}・"
        f"所要 {int(took // 60)}分{int(took % 60)}秒" + (f"・欠け: {', '.join(m.split('(')[0] for m in missing)}" if missing else ""))


# ==========================================
# 1ファイルの処理
# ==========================================
def process_file(src, out_stem, engines, merge_models, proof_models, glossary, fresh=False):
    started = time.time()
    wd = workdir_for(src)
    if fresh:
        shutil.rmtree(wd, ignore_errors=True)
        os.makedirs(wd, exist_ok=True)
    ctx = prepare(src, wd)
    voiced = [c for c in ctx["chunks"] if not c["silent"]]
    say(f"  長さ {hms(ctx['duration'])}・区間 {len(voiced)}(無音 {len(ctx['chunks']) - len(voiced)})"
        f"・声の割合 {sum(c['speech'] for c in ctx['chunks']) / max(ctx['duration'], 1) * 100:.0f}%")
    if not voiced:
        say("  声が見つかりませんでした。")
    say("  [文字起こし] " + ", ".join(f"{LABELS[i]}={e['name']}" for i, e in enumerate(engines)))
    results = run_asr(ctx, engines, glossary) if voiced else {}
    table = assemble(ctx, engines, results, glossary)
    merges, items = {}, []
    if config.MERGE_ENABLED and merge_models:
        say(f"  [統合] {', '.join(m['name'] + '=' + m['model'] for m in merge_models)}")
        merges, items = run_merge(ctx, engines, table, glossary, merge_models)
    else:
        items = merge_items(ctx, engines, table)
    chosen = choose(ctx, table, merges, items, glossary)
    proofs = {}
    if config.PROOF_ENABLED and proof_models:
        say(f"  [校正] {', '.join(m['name'] + '=' + m['model'] for m in proof_models[:config.PROOF_COUNT])}")
        proofs = run_proof(ctx, table, chosen, glossary, proof_models)
    final = finalize(table, chosen, proofs, glossary)
    models_used = {"merge": [c.get("model", n) for n, c in merges.items() if c.get("chunks")],
                   "proof": [c.get("model", n) for n, c in proofs.items() if c.get("chunks")]}
    write_outputs(ctx, out_stem, engines, results, table, merges, chosen, final, models_used, started)
    if not config.KEEP_AUDIO_CACHE:
        for f in os.listdir(wd):
            if f.endswith(".wav"):
                os.remove(os.path.join(wd, f))


# ==========================================
# 入力ファイル・コマンド
# ==========================================
def input_files():
    try:
        names = sorted(os.listdir(config.INPUT_DIR))
    except FileNotFoundError:
        return []
    return [os.path.join(config.INPUT_DIR, n) for n in names
            if os.path.splitext(n)[1].lower() in config.AUDIO_EXTS
            and os.path.isfile(os.path.join(config.INPUT_DIR, n))]


def out_stems(files):
    stems = {}
    for f in files:
        stems.setdefault(os.path.splitext(os.path.basename(f))[0], []).append(f)
    out = {}
    for stem, fs in stems.items():
        for f in fs:
            out[f] = stem if len(fs) == 1 else f"{stem}_{os.path.splitext(f)[1].lstrip('.')}"
    return out


def active_engines(only=None):
    es = [dict(e) for e in config.ENGINES if (e.get("enabled", True) if not only else e["name"] in only)]
    if only:
        unknown = set(only) - {e["name"] for e in es}
        if unknown:
            sys.exit(f"ENGINES に無い名前: {', '.join(sorted(unknown))}")
    usable = []
    for e in es:
        prov = asr.provider_of(e)
        if not net.key(prov):
            say(f"  - {e['name']}: 使いません — {net.KEY_NAMES[prov]} がありません")
            continue
        if e["kind"].startswith("riva") and not e.get("function_id"):
            say(f"  - {e['name']}: 使いません — function_id が空です")
            continue
        usable.append(e)
    return usable


def proof_model_list(names):
    """校正に使えるモデルを順に(先頭の PROOF_COUNT 個を使い、残りは代わり)。"""
    out = []
    for n in names:
        try:
            out.append(llm.resolve(n))
        except llm.ModelUnavailable as ex:
            say(f"  - 校正 {n}: 使いません — {ex}")
    return out


def cmd_run(args):
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            sys.exit(f"{tool} がありません。pkg install ffmpeg を実行してください。")
    files = input_files()
    stems = out_stems(files)
    if args.files:
        picked = []
        for name in args.files:
            p = name if os.path.isabs(name) else os.path.join(config.INPUT_DIR, name)
            if not os.path.exists(p) and os.path.exists(name):
                p = os.path.abspath(name)
            if not os.path.exists(p):
                sys.exit(f"見つかりません: {name}")
            picked.append(p)
            stems.setdefault(p, os.path.splitext(os.path.basename(p))[0])
        files = picked
    if not files:
        say(f"{config.INPUT_DIR} に音声ファイルがありません。")
        return
    todo = files if args.force else [
        f for f in files if not os.path.exists(os.path.join(config.OUTPUT_DIR, stems[f] + ".md"))]
    skipped = len(files) - len(todo)
    if skipped:
        say(f"書き出し済みの {skipped} 件は飛ばします(作り直すときは --force)。")
    if not todo:
        return
    glossary = tp.Glossary.load(config.GLOSSARY_FILE)
    say(f"用語集: {len(glossary.terms)} 語・直し方 {len(glossary.rules)} 件" if glossary
        else f"用語集: なし({config.GLOSSARY_FILE})")
    if tp._KAKASI is None:
        say("(pykakasi が無いので、読みをそろえずに比べます。pip install pykakasi で精度が上がります)")
    engines = active_engines(args.engines.split(",") if args.engines else None)
    if not engines:
        sys.exit("使える文字起こしエンジンがありません。python mojiokoshi.py check で確かめてください。")
    if len(engines) < 2:
        say("! 使えるエンジンが1つだけです。突き合わせができないので、幻覚を見つけにくくなります。")
    merge_names = args.merge.split(",") if args.merge else config.MERGE_MODELS
    proof_names = args.proof.split(",") if args.proof else config.PROOF_MODELS
    merge_models = resolve_models(merge_names, "統合") if config.MERGE_ENABLED and not args.no_llm else []
    proof_models = (proof_model_list(proof_names) if config.PROOF_ENABLED and not args.no_proof
                    and not args.no_llm else [])
    for i, f in enumerate(todo, 1):
        say(f"\n[{i}/{len(todo)}] {os.path.basename(f)}")
        try:
            process_file(f, stems[f], engines, merge_models, proof_models, glossary, fresh=args.fresh)
        except audio.AudioError as ex:
            say(f"  ✗ 音声を読めませんでした: {ex}")


def cmd_list(_args):
    files = input_files()
    stems = out_stems(files)
    if not files:
        say(f"{config.INPUT_DIR} に音声ファイルがありません。")
    for f in files:
        done = os.path.exists(os.path.join(config.OUTPUT_DIR, stems[f] + ".md"))
        say(f"{'✓' if done else '・'} {os.path.basename(f)}")


def cmd_check(args):
    ok = lambda b: "✓" if b else "✗"    # noqa: E731
    say(f"mojiokoshi {VERSION} / Python {sys.version.split()[0]}")
    say("\n[道具]")
    for tool in ("ffmpeg", "ffprobe", "curl"):
        say(f"  {ok(shutil.which(tool))} {tool}")
    if shutil.which("curl"):
        import subprocess
        v = subprocess.run(["curl", "-V"], capture_output=True, text=True).stdout
        say(f"  {ok('HTTP2' in v)} curl の HTTP/2(NVIDIA に必要)")
    try:
        import grpc  # noqa: F401
        say("  ✓ grpcio(NVIDIA はこれで送る)")
    except ImportError:
        say("  ・ grpcio なし(NVIDIA は curl で送る。問題なし)")
    say(f"  {ok(tp._KAKASI is not None)} pykakasi(読みをそろえて比べる。無くても動く)")
    say("\n[場所]")
    say(f"  {ok(os.path.isdir(config.INPUT_DIR))} 入力 {config.INPUT_DIR}({len(input_files())} 件)")
    g = tp.Glossary.load(config.GLOSSARY_FILE)
    say(f"  {ok(bool(g))} 用語集 {config.GLOSSARY_FILE}({len(g.terms)} 語・直し方 {len(g.rules)} 件)")
    say("\n[API キー]")
    for prov, name in net.KEY_NAMES.items():
        k = net.key(prov)
        say(f"  {ok(k)} {name}" + (f"({k[:6]}…{k[-3:]})" if k else ""))
    say("\n[統合・校正の LLM]")
    for n in config.LLMS:
        try:
            m = llm.resolve(n)
            tag = ("統合" if n in config.MERGE_MODELS else "") + ("・校正" if n in config.PROOF_MODELS else "")
            mark = "?" if m.get("unverified") else "✓"
            say(f"  {mark} {n}: {m['model']} {('(' + tag.strip('・') + ')') if tag else '(未使用)'}")
            if m.get("unverified"):
                say(f"      モデル一覧が取れないので、候補の先頭を仮に使う — {llm.LIST_ERRORS.get(m['provider'], '')}")
            if args.deep:
                t0 = time.time()
                out, _ = llm.chat(m, "短く答える。", "「はい」とだけ答えてください。", max_tokens=200)
                say(f"      応答 {time.time() - t0:.1f}秒: {out[:30]!r}")
        except llm.ModelUnavailable as ex:
            say(f"  ✗ {n}: {ex}")
        except net.ApiError as ex:
            say(f"  ✗ {n}: {ex}")
    say("\n[文字起こしエンジン](1.5秒の音を送って確かめる)")
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        wav = os.path.join(td, "tone.wav")
        audio.tone(wav)
        g = tp.Glossary.load(config.GLOSSARY_FILE)
        for e in config.ENGINES:
            if not e.get("enabled", True) and not args.all:
                say(f"  ・ {e['name']}: 無効(enabled=False)")
                continue
            e = dict(e)
            riva = e["kind"].startswith("riva")
            fmt = ("pcm" if config.RIVA_AUDIO == "pcm" else "flac") if riva else config.UPLOAD_FORMAT
            try:
                fpath, pcm, layout = audio.build_request_audio(wav, [(0, 1.5)], os.path.join(td, "r"), fmt)
                t0 = time.time()
                res = asr.transcribe(e, asr.Audio(fpath, fmt, pcm, 1.5), g)
                txt = tp.clean_asr_text(tp.join_units(u["text"] for u in res["units"]))
                say(f"  ✓ {e['name']}: 応答 {time.time() - t0:.1f}秒" + (f"(出力 {txt[:20]!r})" if txt else ""))
            except (asr.EngineFatal, net.ApiError) as ex:
                say(f"  ✗ {e['name']}: {str(ex)[:200]}")
                if riva:
                    say("      → build.nvidia.com のそのモデルの API のページで function-id を確かめ、"
                        "~/.config/mojiokoshi/config_local.py に書く(README の「4. 確かめる」)")
    say("\n✗ のものは、使わずに残りで動きます。")


def cmd_selftest(_args):
    import selftest
    sys.exit(0 if selftest.run() else 1)


def main():
    ap = argparse.ArgumentParser(description="複数のエンジンと LLM で突き合わせる文字起こし")
    ap.add_argument("files", nargs="*", help="ファイル名(省略で入力フォルダのすべて)。check / list / selftest も使える")
    ap.add_argument("--force", action="store_true", help="書き出し済みでも作り直す(途中経過は使い回す)")
    ap.add_argument("--fresh", action="store_true", help="途中経過も捨てて最初から")
    ap.add_argument("--engines", help="使うエンジンをカンマ区切りで(例: whisper-v3,parakeet)")
    ap.add_argument("--merge", help="統合に使う LLM をカンマ区切りで(LLMS の名前)")
    ap.add_argument("--proof", help="校正に使う LLM をカンマ区切りで(LLMS の名前)")
    ap.add_argument("--no-proof", action="store_true", help="校正しない")
    ap.add_argument("--no-llm", action="store_true", help="LLM を使わない(音声認識の候補から選ぶだけ)")
    ap.add_argument("--deep", action="store_true", help="check で LLM にも実際に問い合わせる")
    ap.add_argument("--all", action="store_true", help="check で無効のエンジンも確かめる")
    args = ap.parse_args()
    os.makedirs(config.WORK_DIR, exist_ok=True)
    cmd = args.files[0] if args.files and args.files[0] in ("check", "list", "selftest") else None
    try:
        if cmd == "check":
            cmd_check(args)
        elif cmd == "list":
            cmd_list(args)
        elif cmd == "selftest":
            cmd_selftest(args)
        else:
            cmd_run(args)
    except KeyboardInterrupt:
        net.STOP.set()
        say("\n中断しました。もう一度実行すると、続きから再開します。")
        sys.exit(130)


if __name__ == "__main__":
    main()
