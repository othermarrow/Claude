"""実行前の確かめ。統合・校正の LLM と文字起こしエンジンに、ごく短い問い合わせを送り、
使えるものだけで処理を始める。

- LLM: 「はい」とだけ答えさせる。403(プロジェクトで止められている)・404(このアカウントで
  使えない)なら、同じ枠の次の候補を試す。上限(429)なら、その枠は今回は使わない。
- エンジン: 1.5 秒の音を送る。1日の回数が少ないもの(probe=False。gemini-transcribe)は
  送らずにキーだけ確かめる。
- 結果は PREFLIGHT_CACHE_HOURS のあいだ覚えておき、続けて実行しても問い合わせ直さない
  (上限に当たったものは1時間)。設定を変えたあとは --recheck で覚えた結果を捨てる。
"""

import json
import os
import tempfile
import time

import asr
import audio
import config
import llm
import net
import textproc as tp

_CACHE = os.path.join(config.WORK_DIR, "preflight_cache.json")


def _say(*a):
    print(*a, flush=True)


class _quick:
    """確かめの問い合わせは、待ち時間を短くし、送り直しを減らす(応答しないものですぐ止まらないように)。"""
    NAMES = {"REQUEST_TIMEOUT": 45, "MAX_RETRIES": 1, "MAX_WAIT_SEC": 30, "TIMEOUT_RETRIES": 0}

    def __enter__(self):
        self.old = {k: getattr(config, k) for k in self.NAMES}
        for k, v in self.NAMES.items():
            setattr(config, k, v)

    def __exit__(self, *a):
        for k, v in self.old.items():
            setattr(config, k, v)


def _load():
    try:
        return json.load(open(_CACHE, encoding="utf-8"))
    except Exception:
        return {}


def _save(data):
    os.makedirs(config.WORK_DIR, exist_ok=True)
    tmp = _CACHE + ".tmp"
    json.dump(data, open(tmp, "w", encoding="utf-8"), ensure_ascii=False)
    os.replace(tmp, _CACHE)


def _remembered(cache, key):
    ent = cache.get(key)
    if not ent:
        return None
    ttl = 3600 if ent["kind"] in ("quota", "noresponse") else config.PREFLIGHT_CACHE_HOURS * 3600
    if time.time() - ent["t"] > ttl:
        return None
    return ent


def probe_llm(m, cache, fresh):
    """(kind, 説明)。kind は ok / unavailable / quota / error。"""
    key = f"llm:{m['provider']}:{m['model']}"
    ent = None if fresh else _remembered(cache, key)
    if ent:
        return ent["kind"], ent["why"] + "(確認済み)"
    t0 = time.time()
    _say(f"    … {m['name']}: {m['model']} に問い合わせ中")
    try:
        with _quick():
            llm.chat(m, "短く答える。", "「はい」とだけ答えてください。", max_tokens=300)
        kind, why = "ok", f"応答 {time.time() - t0:.1f}秒"
    except llm.ModelUnavailable as ex:
        kind, why = "unavailable", str(ex)[:150]
    except net.QuotaExhausted as ex:
        kind, why = "quota", str(ex)[:150]
    except net.NoResponse as ex:
        kind, why = "noresponse", str(ex)[:150]
    except net.ApiError as ex:
        kind, why = "error", str(ex)[:150]
    cache[key] = {"t": time.time(), "kind": kind, "why": why}
    return kind, why


def llm_models(names, label, fresh=False):
    """names の枠ごとに、実際に応答するモデルを選ぶ。使える順に返す。"""
    cache = _load()
    out = []
    for n in names:
        tried = set()
        while True:
            try:
                m = llm.resolve(n, exclude=tried)
            except llm.ModelUnavailable as ex:
                _say(f"  ✗ {label} {n}: 使いません — {ex}")
                break
            kind, why = probe_llm(m, cache, fresh)
            if kind == "ok":
                _say(f"  ✓ {label} {n}: {m['model']}({why})")
                out.append(m)
                break
            _say(f"  ✗ {label} {n}: {m['model']} — {why}")
            if kind in ("unavailable", "noresponse"):
                tried.add(m["model"])          # 同じ枠の次の候補へ
                continue
            break                              # 上限・通信の失敗は、この枠を今回は使わない
    _save(cache)
    return out


def engines(es, fresh=False):
    """文字起こしエンジンのうち、使えるものだけを返す。"""
    cache = _load()
    out = []
    with tempfile.TemporaryDirectory() as td:
        wav = os.path.join(td, "tone.wav")
        audio.tone(wav)
        for e in es:
            if not e.get("probe", True):
                _say(f"  ・ {e['name']}: 1日の回数が少ないので、確かめずに使う")
                out.append(e)
                continue
            key = "asr:" + json.dumps([e["kind"], e.get("model"), e.get("function_id"),
                                       e.get("language_code")], ensure_ascii=False)
            ent = None if fresh else _remembered(cache, key)
            if ent:
                kind, why = ent["kind"], ent["why"] + "(確認済み)"
            else:
                riva = e["kind"].startswith("riva")
                fmt = ("pcm" if config.RIVA_AUDIO == "pcm" else "flac") if riva else config.UPLOAD_FORMAT
                t0 = time.time()
                _say(f"    … {e['name']}: 問い合わせ中")
                try:
                    fpath, pcm, _ = audio.build_request_audio(wav, [(0, 1.5)], os.path.join(td, "r"), fmt)
                    with _quick():
                        asr.transcribe(dict(e), asr.Audio(fpath, fmt, pcm, 1.5), tp.Glossary())
                    kind, why = "ok", f"応答 {time.time() - t0:.1f}秒"
                except asr.EngineFatal as ex:
                    kind, why = "unavailable", str(ex)[:150]
                except net.QuotaExhausted as ex:
                    kind, why = "quota", str(ex)[:150]
                except net.NoResponse as ex:
                    kind, why = "noresponse", str(ex)[:150]
                except (net.ApiError, asr.GrpcError, OSError) as ex:
                    kind, why = "error", str(ex)[:150]
                cache[key] = {"t": time.time(), "kind": kind, "why": why}
            if kind in ("ok", "error"):
                mark = "✓" if kind == "ok" else "?"
                _say(f"  {mark} {e['name']}: {why}" + ("(一時的な失敗かもしれないので使う)" if kind == "error" else ""))
                out.append(e)
            else:
                _say(f"  ✗ {e['name']}: 使いません — {why}")
    _save(cache)
    return out
