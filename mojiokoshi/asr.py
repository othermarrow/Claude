"""文字起こしエンジン。

どのエンジンも transcribe(engine, audio) で、時刻つきの断片(units)の並びを返す。
  unit = {"start": 秒, "end": 秒, "text": 文字列, ...エンジン固有の指標}
時刻は送った音声の頭からの秒。区間への振り分けは呼び出し側(mojiokoshi.py)で行う。

NVIDIA(Riva)は gRPC。grpcio が入っていればそれを使い、無ければ curl の
HTTP/2 で gRPC の枠を直接組んで送る(Termux で grpcio を入れずに済むように)。
"""

import base64
import json
import os
import re
import shutil
import struct
import subprocess
import tempfile
import threading

import config
import net

GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GEMINI_BASE = "https://generativelanguage.googleapis.com"
RIVA_RECOGNIZE = "/nvidia.riva.asr.RivaSpeechRecognition/Recognize"
RIVA_STREAM = "/nvidia.riva.asr.RivaSpeechRecognition/StreamingRecognize"

MIME = {"flac": "audio/flac", "wav": "audio/wav", "opus": "audio/ogg", "ogg": "audio/ogg"}


class EngineFatal(Exception):
    """このエンジンは今回の実行では使えない(キー・function-id・モデル名の誤りなど)。"""


class Audio:
    """送る音声。path は送る形式のファイル、pcm は 16kHz モノラル 16bit の生データ。"""

    def __init__(self, path, fmt, pcm=None, duration=0.0):
        self.path, self.fmt, self.pcm, self.duration = path, fmt, pcm, duration

    def read(self):
        with open(self.path, "rb") as f:
            return f.read()


def transcribe(engine, audio, glossary):
    kind = engine["kind"]
    if kind == "groq":
        return groq_transcribe(engine, audio, glossary)
    if kind in ("riva", "riva_stream"):
        return riva_transcribe(engine, audio, glossary)
    if kind == "gemini_transcribe":
        return gemini_transcribe(engine, audio, glossary)
    if kind == "gemini_llm":
        return gemini_llm_transcribe(engine, audio, glossary)
    raise EngineFatal(f"知らない kind: {kind}")


def provider_of(engine):
    k = engine["kind"]
    return "groq" if k == "groq" else "nvidia" if k.startswith("riva") else "gemini"


def _fatal_on_api_error(e, engine):
    if isinstance(e, net.QuotaExhausted):
        raise e
    if e.status in (400, 401, 403, 404, 413, 422):
        raise EngineFatal(f"{engine['name']}: {e}") from e
    raise e


# ==========================================
# Groq(Whisper)
# ==========================================
def groq_transcribe(engine, audio, glossary):
    key = net.key("groq")
    if not key:
        raise EngineFatal("GROQ_API_KEY がありません")
    fields = [("model", engine["model"]), ("language", config.ASR_LANGUAGE),
              ("response_format", "verbose_json"), ("temperature", "0"),
              ("timestamp_granularities[]", "segment")]
    prompt = glossary.whisper_prompt() if engine.get("glossary") and glossary else ""
    if prompt:
        fields.append(("prompt", prompt))
    ext = os.path.splitext(audio.path)[1] or f".{audio.fmt}"
    body, ctype = net.multipart(fields, [("file", f"chunk{ext}", audio.read(), MIME[audio.fmt])])
    lim = net.limiter(f"groq:{engine['model']}", config.RPM["groq"])
    try:
        _, _, raw = net.request("POST", GROQ_URL, data=body, limit=lim, what=engine["name"],
                                headers={"Authorization": f"Bearer {key}", "Content-Type": ctype})
    except net.ApiError as e:
        _fatal_on_api_error(e, engine)
    j = json.loads(raw.decode("utf-8"))
    segs = j.get("segments") or []
    units = []
    for s in segs:
        units.append({"start": float(s.get("start", 0)), "end": float(s.get("end", 0)),
                      "text": s.get("text", ""), "avg_logprob": s.get("avg_logprob"),
                      "no_speech_prob": s.get("no_speech_prob"),
                      "compression_ratio": s.get("compression_ratio")})
    if not segs and j.get("text"):
        units.append({"start": 0.0, "end": audio.duration, "text": j["text"], "timed": False})
    return {"units": units, "prompt": prompt}


# ==========================================
# NVIDIA Riva(gRPC)
# ==========================================
# --- protobuf の最小限の読み書き(riva_asr.proto の必要な所だけ) ---
def _varint(n):
    out = bytearray()
    n &= (1 << 64) - 1
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def _key(field, wt):
    return _varint((field << 3) | wt)


def pb_int(field, n):
    return _key(field, 0) + _varint(int(n)) if n else b""


def pb_bool(field, v):
    return _key(field, 0) + b"\x01" if v else b""


def pb_bytes(field, b):
    return _key(field, 2) + _varint(len(b)) + b


def pb_str(field, s):
    return pb_bytes(field, s.encode("utf-8")) if s else b""


def pb_float(field, f):
    return _key(field, 5) + struct.pack("<f", f) if f else b""


def pb_parse(buf):
    """メッセージを {field: [値, ...]} にする。長さ付きの値は bytes のまま。"""
    out, i, n = {}, 0, len(buf)
    while i < n:
        key, i = _read_varint(buf, i)
        field, wt = key >> 3, key & 7
        if wt == 0:
            v, i = _read_varint(buf, i)
        elif wt == 1:
            v = struct.unpack_from("<d", buf, i)[0]
            i += 8
        elif wt == 2:
            ln, i = _read_varint(buf, i)
            v = bytes(buf[i:i + ln])
            i += ln
        elif wt == 5:
            v = struct.unpack_from("<f", buf, i)[0]
            i += 4
        else:
            raise ValueError(f"protobuf の型 {wt} は読めない")
        out.setdefault(field, []).append(v)
    return out


def _read_varint(buf, i):
    shift = result = 0
    while True:
        b = buf[i]
        i += 1
        result |= (b & 0x7F) << shift
        if not b & 0x80:
            return result, i
        shift += 7


def _signed32(v):
    v &= 0xFFFFFFFF
    return v - (1 << 32) if v & 0x80000000 else v


def riva_config(engine, glossary, encoding, phrases=True, punctuation=True):
    """RecognitionConfig を組む。"""
    msg = (pb_int(1, encoding) + pb_int(2, 16000) + pb_str(3, engine.get("language_code", ""))
           + pb_int(4, 1) + pb_int(7, 1) + pb_bool(8, True) + pb_bool(11, punctuation)
           + pb_str(13, engine.get("model_name", "")) + pb_bool(14, True))
    if phrases and engine.get("glossary") and glossary:
        vocab = glossary.vocab()
        if vocab:
            ctx = b"".join(pb_str(1, w) for w in vocab) + pb_float(4, float(config.RIVA_BOOST))
            msg += pb_bytes(6, ctx)
    for k, v in (engine.get("custom_configuration") or {}).items():
        msg += pb_bytes(24, pb_str(1, k) + pb_str(2, v))
    return msg


def parse_riva_results(results_raw, offset=0.0):
    """SpeechRecognitionResult の並びを units にする。"""
    units = []
    for rb in results_raw:
        r = pb_parse(rb)
        alts = r.get(1) or []
        if not alts:
            continue
        a = pb_parse(alts[0])
        text = (a.get(1) or [b""])[0].decode("utf-8", "replace")
        conf = (a.get(2) or [None])[0]
        words = []
        for wb in a.get(3) or []:
            w = pb_parse(wb)
            words.append((_signed32((w.get(1) or [0])[0]) / 1000.0,
                          _signed32((w.get(2) or [0])[0]) / 1000.0))
        if not text.strip():
            continue
        if words:
            start, end, timed = words[0][0] + offset, words[-1][1] + offset, True
        else:
            start, end, timed = offset, offset, False
        units.append({"start": start, "end": end, "text": text, "confidence": conf, "timed": timed})
    return units


def grpc_frame(msg):
    return b"\x00" + struct.pack(">I", len(msg)) + msg


def grpc_unframe(buf):
    out, i = [], 0
    while i + 5 <= len(buf):
        flag, ln = buf[i], struct.unpack(">I", buf[i + 1:i + 5])[0]
        if flag:
            raise ValueError("圧縮された gRPC メッセージは読めない")
        out.append(buf[i + 5:i + 5 + ln])
        i += 5 + ln
    return out


class GrpcError(Exception):
    def __init__(self, code, message):
        super().__init__(f"gRPC {code}: {message}")
        self.code, self.message = code, message


# grpc-status のうち、待っても直らないもの
_GRPC_FATAL = {3, 5, 7, 12, 16}          # INVALID_ARGUMENT NOT_FOUND PERMISSION_DENIED UNIMPLEMENTED UNAUTHENTICATED
_GRPC_RETRY = {1, 2, 4, 8, 10, 13, 14}   # CANCELLED UNKNOWN DEADLINE RESOURCE_EXHAUSTED ABORTED INTERNAL UNAVAILABLE

_transport = None
_transport_lock = threading.Lock()


def riva_transport():
    global _transport
    with _transport_lock:
        if _transport is None:
            want = config.RIVA_TRANSPORT
            if want in ("auto", "grpcio"):
                try:
                    import grpc  # noqa: F401
                    _transport = "grpcio"
                except ImportError:
                    if want == "grpcio":
                        raise EngineFatal("grpcio が入っていません(RIVA_TRANSPORT=grpcio)")
            if _transport is None:
                if not shutil.which("curl"):
                    raise EngineFatal("curl がありません(pkg install curl)")
                _transport = "curl"
        return _transport


def grpc_call(path, requests, metadata, timeout, streaming=False):
    """gRPC を呼び、応答メッセージ(bytes)の並びを返す。"""
    if riva_transport() == "grpcio":
        return _grpc_call_grpcio(path, requests, metadata, timeout, streaming)
    return _grpc_call_curl(path, requests, metadata, timeout)


_channels = {}


def _grpc_call_grpcio(path, requests, metadata, timeout, streaming):
    import grpc
    server = config.RIVA_SERVER
    with _transport_lock:
        ch = _channels.get(server)
        if ch is None:
            opts = [("grpc.max_send_message_length", 64 << 20), ("grpc.max_receive_message_length", 64 << 20)]
            ch = (grpc.secure_channel(server, grpc.ssl_channel_credentials(), options=opts)
                  if config.RIVA_USE_SSL else grpc.insecure_channel(server, options=opts))
            _channels[server] = ch
    md = [(k.lower(), v) for k, v in metadata.items()]
    try:
        if streaming:
            fn = ch.stream_stream(path)
            return list(fn(iter(requests), metadata=md, timeout=timeout))
        fn = ch.unary_unary(path)
        return [fn(requests[0], metadata=md, timeout=timeout)]
    except grpc.RpcError as e:
        code = e.code() if hasattr(e, "code") else None
        details = e.details() if hasattr(e, "details") else str(e)
        raise GrpcError(code.value[0] if code is not None else 2, details or "")


def _grpc_call_curl(path, requests, metadata, timeout):
    scheme = "https" if config.RIVA_USE_SSL else "http"
    url = f"{scheme}://{config.RIVA_SERVER}{path}"
    with tempfile.TemporaryDirectory(prefix="moji-grpc-") as td:
        req_f, hdr_f = os.path.join(td, "req"), os.path.join(td, "hdr")
        resp_f, dump_f = os.path.join(td, "resp"), os.path.join(td, "dump")
        with open(req_f, "wb") as f:
            for r in requests:
                f.write(grpc_frame(r))
        # キーをコマンドラインに出さないよう、ヘッダはファイルで渡す
        fd = os.open(hdr_f, os.O_WRONLY | os.O_CREAT, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write("content-type: application/grpc\nte: trailers\n")
            for k, v in metadata.items():
                f.write(f"{k}: {v}\n")
        cmd = ["curl", "-sS", "-X", "POST", url, "-H", f"@{hdr_f}", "-H", "Expect:",
               "--data-binary", f"@{req_f}", "-o", resp_f, "-D", dump_f,
               "--max-time", str(int(timeout))]
        cmd.insert(1, "--http2" if config.RIVA_USE_SSL else "--http2-prior-knowledge")
        cacert = os.environ.get("MOJI_CURL_CACERT")
        if cacert:
            cmd += ["--cacert", cacert]
        p = subprocess.run(cmd, capture_output=True, text=True)
        dump = open(dump_f, encoding="latin-1").read() if os.path.exists(dump_f) else ""
        body = open(resp_f, "rb").read() if os.path.exists(resp_f) else b""
    status_line = re.search(r"^HTTP/\S+\s+(\d+)", dump, re.M)
    http_status = int(status_line.group(1)) if status_line else 0
    gs = re.findall(r"^grpc-status:\s*(\d+)", dump, re.M | re.I)
    gm = re.findall(r"^grpc-message:\s*(.*?)\s*$", dump, re.M | re.I)
    err = (p.stderr or "").strip()
    if p.returncode != 0 and not body:
        if p.returncode == 4 or "doesn't support" in err or "not support" in err.lower():
            raise EngineFatal(f"この curl は HTTP/2 に対応していません(pkg upgrade curl): {err[:200]}")
        raise GrpcError(14, f"curl の終了コード {p.returncode}: {err[:300]}")
    if http_status in (401, 403):
        raise GrpcError(16, f"HTTP {http_status}(キーか function-id が違う)")
    if http_status == 404:
        raise GrpcError(5, "HTTP 404(function-id が違うか、そのモデルが無くなった)")
    if http_status == 429:
        raise GrpcError(8, "HTTP 429(混雑)")
    if http_status >= 500:
        raise GrpcError(14, f"HTTP {http_status}")
    if 400 <= http_status < 500 and not gs:
        raise GrpcError(3, f"HTTP {http_status}: {body[:200]!r}")
    if gs and int(gs[-1]) != 0:
        from urllib.parse import unquote
        raise GrpcError(int(gs[-1]), unquote(gm[-1]) if gm else "")
    msgs = grpc_unframe(body)
    if not msgs and not gs:
        raise GrpcError(2, f"応答が空(HTTP {http_status})")
    return msgs


def riva_transcribe(engine, audio, glossary):
    """NVIDIA に送る。一括(Recognize)を受け付けないモデルなら、ストリーミングに切り替える。"""
    key = net.key("nvidia")
    if not key:
        raise EngineFatal("NVIDIA_API_KEY がありません")
    fid = engine.get("function_id", "").strip()
    if not fid:
        raise EngineFatal(f"{engine['name']}: function_id が空です(config.py に build.nvidia.com の値を入れる)")
    md = {"function-id": fid, "authorization": f"Bearer {key}"}
    if config.RIVA_AUDIO == "flac" and audio.fmt == "flac":
        enc, payload = 2, audio.read()
    else:
        enc, payload = 1, audio.pcm
    modes = ["stream"] if engine["kind"] == "riva_stream" else ["offline", "stream"]
    if engine.get("_mode") in modes:
        modes = [engine["_mode"]]
    last = None
    for mode in modes:
        try:
            units = _riva_once(engine, glossary, md, enc, payload, mode == "stream")
            engine["_mode"] = mode
            return {"units": units}
        except GrpcError as e:
            last = e
            # 認証・function-id の誤りはストリーミングでも同じなので、そこで止める
            if e.code in (7, 16) or "HTTP 404" in e.message:
                break
    raise EngineFatal(f"{engine['name']}: {last}")


def _riva_once(engine, glossary, md, enc, payload, streaming):
    lim = net.limiter("nvidia", config.RPM["nvidia"])
    # 単語ブーストや句読点の指定を受け付けないモデルがあれば、外して送り直す
    variants = [dict(phrases=True, punctuation=True), dict(phrases=False, punctuation=True),
                dict(phrases=False, punctuation=False)]
    vi = engine.get("_variant", 0)
    attempt = 0
    while True:
        cfg = riva_config(engine, glossary, enc, **variants[vi])
        if streaming:
            reqs = [pb_bytes(1, pb_bytes(1, cfg))]       # streaming_config{config}
            step = 16000 * 2 // 5                         # 0.2 秒ずつ
            for i in range(0, len(payload), step):
                reqs.append(pb_bytes(2, payload[i:i + step]))
        else:
            reqs = [pb_bytes(1, cfg) + pb_bytes(2, payload)]
        lim.wait()
        try:
            msgs = grpc_call(RIVA_STREAM if streaming else RIVA_RECOGNIZE, reqs, md,
                             config.REQUEST_TIMEOUT, streaming)
            engine["_variant"] = vi
            break
        except GrpcError as e:
            if e.code == 3 and vi + 1 < len(variants):
                vi += 1
                continue
            if e.code in _GRPC_FATAL:
                raise
            attempt += 1
            if attempt > config.MAX_RETRIES:
                if e.code == 8:
                    raise net.QuotaExhausted(429, str(e), engine["name"])
                raise
            net.sleep(min(90, 3 * 2 ** attempt))
    units = []
    for m in msgs:
        results = pb_parse(m).get(1) or []
        if streaming:
            results = [rb for rb in results if (pb_parse(rb).get(2) or [0])[0]]   # is_final だけ
        units += parse_riva_results(results)
    return units


# ==========================================
# Gemini
# ==========================================
_INLINE_LIMIT = 14 * 1024 * 1024      # これより大きい音声は File API で送る


def _gemini_headers(extra=None):
    key = net.key("gemini")
    if not key:
        raise EngineFatal("GEMINI_API_KEY がありません")
    h = {"x-goog-api-key": key}
    h.update(extra or {})
    return h


def gemini_upload(path, mime, what=""):
    """File API に上げて (uri, name) を返す。"""
    size = os.path.getsize(path)
    h = _gemini_headers({"X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
                         "X-Goog-Upload-Header-Content-Length": str(size),
                         "X-Goog-Upload-Header-Content-Type": mime, "Content-Type": "application/json"})
    lim = net.limiter("gemini:files", 30)
    _, hdrs, _ = net.request("POST", f"{GEMINI_BASE}/upload/v1beta/files", headers=h, limit=lim,
                             data=json.dumps({"file": {"display_name": "mojiokoshi"}}).encode(), what=what)
    up = hdrs.get("x-goog-upload-url")
    if not up:
        raise net.ApiError(0, "アップロード先の URL が返らなかった", what)
    with open(path, "rb") as f:
        data = f.read()
    h = _gemini_headers({"Content-Length": str(size), "X-Goog-Upload-Offset": "0",
                         "X-Goog-Upload-Command": "upload, finalize"})
    _, _, body = net.request("POST", up, headers=h, data=data, limit=lim, what=what)
    info = json.loads(body.decode("utf-8")).get("file", {})
    name, uri = info.get("name"), info.get("uri")
    for _ in range(60):
        if info.get("state") in (None, "ACTIVE"):
            break
        net.sleep(2)
        info = net.request_json("GET", f"{GEMINI_BASE}/v1beta/{name}", headers=_gemini_headers(), what=what)
    return uri, name


def gemini_delete(name):
    try:
        net.request("DELETE", f"{GEMINI_BASE}/v1beta/{name}", headers=_gemini_headers(), retries=1)
    except Exception:
        pass


def _offset_seconds(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, dict):
        return float(v.get("seconds", 0)) + float(v.get("nanos", 0)) / 1e9
    try:
        return float(str(v).rstrip("s"))
    except ValueError:
        return None


def parse_interaction(j):
    """Interactions API の応答から (本文, 単語の並び[(start, end, text)])。

    単語の注記に本文での位置(start_index)があれば、句読点を含めて本文から切り出す。
    位置が文字数か UTF-8 のバイト数かは、注記の単語と照らして決める。
    """
    steps = j.get("steps")
    if steps is None:
        steps = [{"type": "model_output", "content": j.get("outputs") or []}]
    texts, words = [], []
    for st in steps:
        if st.get("type") not in ("model_output", None):
            continue
        for item in st.get("content") or []:
            if item.get("type") != "text":
                continue
            text = item.get("text") or ""
            anns = [a for a in item.get("annotations") or [] if a.get("type") == "word_info"]
            words += _words_from_annotations(text, anns)
            texts.append(text)
    return "".join(texts), words


def _words_from_annotations(text, anns):
    rows = []
    for a in anns:
        s, e = _offset_seconds(a.get("start_offset")), _offset_seconds(a.get("end_offset"))
        if s is None:
            continue
        rows.append([s, e if e is not None else s, a.get("text") or "", a.get("start_index")])
    if not rows:
        return []
    idx = [r[3] for r in rows]
    if all(isinstance(i, int) for i in idx) and idx == sorted(idx):
        raw = text.encode("utf-8")
        hit_c = sum(1 for r in rows if text[r[3]:r[3] + len(r[2])] == r[2])
        hit_b = sum(1 for r in rows if raw[r[3]:r[3] + len(r[2].encode())].decode("utf-8", "ignore") == r[2])
        if max(hit_c, hit_b) >= 0.8 * len(rows):
            use_bytes = hit_b > hit_c
            seq = raw if use_bytes else text
            out = []
            for k, r in enumerate(rows):
                a = 0 if k == 0 else r[3]
                b = rows[k + 1][3] if k + 1 < len(rows) else len(seq)
                piece = seq[a:b]
                if use_bytes:
                    piece = piece.decode("utf-8", "ignore")
                out.append((r[0], r[1], piece))
            return out
    return [(r[0], r[1], r[2]) for r in rows]


def _audio_part_interactions(audio, what):
    data = audio.read()
    mime = MIME[audio.fmt]
    if len(data) * 4 / 3 > _INLINE_LIMIT:
        uri, name = gemini_upload(audio.path, mime, what)
        return {"type": "audio", "uri": uri, "mime_type": mime}, name
    return {"type": "audio", "data": base64.b64encode(data).decode(), "mime_type": mime}, None


def gemini_transcribe(engine, audio, glossary):
    what = engine["name"]
    part, uploaded = _audio_part_interactions(audio, what)
    tc = {"language_codes": [config.ASR_LANGUAGE_BCP47]}
    if engine.get("glossary") and glossary and glossary.vocab():
        tc["custom_vocabulary"] = glossary.vocab()
    # 受け付けない項目があれば外して送り直す(上から順に試す)
    variants = [
        dict(tc, mode={"type": "verbatim", "timestamp_granularities": ["word"]}),
        dict(tc, timestamp_granularities=["word"]),
        dict(tc, mode={"type": "verbatim"}),
        {"language_codes": [config.ASR_LANGUAGE_BCP47]},
    ]
    lim = net.limiter(f"gemini:{engine['model']}", config.RPM["gemini"])
    try:
        i = engine.get("_variant", 0)
        while True:
            body = {"model": engine["model"], "input": [part], "store": False,
                    "generation_config": {"transcription_config": variants[i]}}
            try:
                j = net.request_json("POST", f"{GEMINI_BASE}/v1beta/interactions", body,
                                     headers=_gemini_headers(), limit=lim, what=what,
                                     timeout=max(config.REQUEST_TIMEOUT, 600))
                engine["_variant"] = i
                break
            except net.ApiError as e:
                if e.status == 400 and i + 1 < len(variants) and not isinstance(e, net.QuotaExhausted):
                    i += 1
                    continue
                _fatal_on_api_error(e, engine)
    finally:
        if uploaded:
            gemini_delete(uploaded)
    text, words = parse_interaction(j)
    if words:
        units = [{"start": s, "end": e, "text": t, "word": True} for s, e, t in words]
        return {"units": units, "text": text}
    return {"units": [{"start": 0.0, "end": audio.duration, "text": text, "timed": False}] if text.strip() else [],
            "text": text}


GEMINI_ASR_PROMPT = """この音声を日本語で、話されたとおりに一字一句書き起こしてください。
- 話されていない言葉を足さない。要約・言い換え・補完をしない。
- 聞き取れない所は推測せず〔聞き取れず〕と書く。
- 無音や雑音だけなら何も書かない。
- 書き起こしの本文だけを出力する(前置き・説明・時刻は書かない)。"""


def gemini_llm_transcribe(engine, audio, glossary):
    what = engine["name"]
    data = audio.read()
    mime = MIME[audio.fmt]
    uploaded = None
    if len(data) * 4 / 3 > _INLINE_LIMIT:
        uri, uploaded = gemini_upload(audio.path, mime, what)
        apart = {"file_data": {"mime_type": mime, "file_uri": uri}}
    else:
        apart = {"inline_data": {"mime_type": mime, "data": base64.b64encode(data).decode()}}
    prompt = GEMINI_ASR_PROMPT
    if engine.get("glossary") and glossary and glossary.terms:
        prompt += "\n\n出てくる可能性のある用語(音が合うときだけこの表記にする):\n" + "、".join(glossary.vocab())
    body = {"contents": [{"role": "user", "parts": [apart, {"text": prompt}]}],
            "generationConfig": {"maxOutputTokens": 16384}}
    lim = net.limiter(f"gemini:{engine['model']}", config.RPM["gemini"])
    try:
        j = net.request_json("POST", f"{GEMINI_BASE}/v1beta/models/{engine['model']}:generateContent",
                             body, headers=_gemini_headers(), limit=lim, what=what,
                             timeout=max(config.REQUEST_TIMEOUT, 600))
    except net.ApiError as e:
        _fatal_on_api_error(e, engine)
    finally:
        if uploaded:
            gemini_delete(uploaded)
    text = ""
    for c in j.get("candidates") or []:
        for p in (c.get("content") or {}).get("parts") or []:
            if not p.get("thought"):
                text += p.get("text") or ""
    text = text.strip()
    return {"units": [{"start": 0.0, "end": audio.duration, "text": text, "timed": False}] if text else []}
