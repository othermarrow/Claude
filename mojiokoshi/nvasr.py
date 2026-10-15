"""NVIDIA API(Riva)の音声認識と BNR を呼ぶ。

公式の nvidia-riva-client は grpcio-tools などに依存し、Termux では入れるのに
ビルドが要る。ここでは Termux のパッケージ(python-grpcio)だけで動くように、
必要なメッセージ(riva_asr.proto の一部)を自前で組み立て・読み取る。
フィールド番号は nvidia-riva/common の riva/proto/riva_asr.proto に合わせてある。
"""

import json
import random
import struct
import threading
import time
import urllib.error
import urllib.request

RECOGNIZE = "/nvidia.riva.asr.RivaSpeechRecognition/Recognize"
STREAMING_RECOGNIZE = "/nvidia.riva.asr.RivaSpeechRecognition/StreamingRecognize"
GET_CONFIG = "/nvidia.riva.asr.RivaSpeechRecognition/GetRivaSpeechRecognitionConfig"
BNR_ENHANCE = "/nvidia.ai4m.bnr.v1.BNR/EnhanceAudio"

LINEAR_PCM = 1


class FatalAPIError(Exception):
    """続けても無駄な失敗(キー・function-id・言語コードの誤りなど)。"""


class SegmentAPIError(Exception):
    """その区間だけの失敗(再試行を使い切った、など)。"""


# ==========================================
# protobuf の最小限の組み立てと読み取り
# ==========================================
def _varint(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def _key(field, wtype):
    return _varint((field << 3) | wtype)


def _f_int(field, v):
    return _key(field, 0) + _varint(int(v)) if v else b""


def _f_bool(field, v):
    return _key(field, 0) + b"\x01" if v else b""


def _f_bytes(field, b):
    return _key(field, 2) + _varint(len(b)) + bytes(b)


def _f_str(field, s):
    return _f_bytes(field, s.encode("utf-8")) if s else b""


def _f_float(field, v):
    return _key(field, 5) + struct.pack("<f", float(v))


def _read_varint(buf, i):
    shift = 0
    out = 0
    while True:
        b = buf[i]
        i += 1
        out |= (b & 0x7F) << shift
        if not b & 0x80:
            return out, i
        shift += 7
        if shift > 63:
            raise ValueError("varint が長すぎます")


def _fields(buf):
    """(フィールド番号, 値) を順に返す。長さ付きの値は bytes のまま。"""
    i, n = 0, len(buf)
    while i < n:
        key, i = _read_varint(buf, i)
        field, wt = key >> 3, key & 7
        if wt == 0:
            v, i = _read_varint(buf, i)
        elif wt == 1:
            v, i = buf[i:i + 8], i + 8
        elif wt == 2:
            ln, i = _read_varint(buf, i)
            v, i = buf[i:i + ln], i + ln
        elif wt == 5:
            v, i = buf[i:i + 4], i + 4
        else:
            raise ValueError(f"未対応の wire type {wt}")
        yield field, v


def _float(v):
    return struct.unpack("<f", v)[0] if isinstance(v, (bytes, bytearray)) and len(v) == 4 else 0.0


def _int32(v):
    v = int(v)
    return v - (1 << 64) if v >= 1 << 63 else v


def recognition_config(language, sample_rate=16000, punctuation=True,
                       word_time_offsets=False, verbatim=True, model="", custom=None,
                       encoding=LINEAR_PCM, channels=1):
    """RecognitionConfig(riva_asr.proto)。0 の項目は送らない(サーバー側の既定になる)。"""
    b = _f_int(1, encoding)                   # encoding
    b += _f_int(2, sample_rate)               # sample_rate_hertz
    b += _f_str(3, language)                  # language_code
    b += _f_int(4, 1)                         # max_alternatives
    b += _f_int(7, channels)                  # audio_channel_count
    b += _f_bool(8, word_time_offsets)        # enable_word_time_offsets
    b += _f_bool(11, punctuation)             # enable_automatic_punctuation
    b += _f_str(13, model)                    # model
    b += _f_bool(14, verbatim)                # verbatim_transcripts
    for k, v in (custom or {}).items():       # custom_configuration(map)
        b += _f_bytes(24, _f_str(1, k) + _f_str(2, v))
    return b


def _wav(pcm16, sample_rate):
    import io
    import wave
    bio = io.BytesIO()
    with wave.open(bio, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(pcm16)
    return bio.getvalue()


def recognize_request(config, audio):
    return _f_bytes(1, config) + _f_bytes(2, audio)


def streaming_config_request(config, interim_results=False):
    return _f_bytes(1, _f_bytes(1, config) + _f_bool(2, interim_results))


def streaming_audio_request(chunk):
    return _f_bytes(2, chunk)


def _parse_alternative(buf):
    alt = {"transcript": "", "confidence": 0.0, "words": [], "language_code": []}
    for f, v in _fields(buf):
        if f == 1:
            alt["transcript"] = v.decode("utf-8", "replace")
        elif f == 2:
            alt["confidence"] = _float(v)
        elif f == 3:
            w = {}
            for wf, wv in _fields(v):
                if wf == 1:
                    w["start_ms"] = _int32(wv)
                elif wf == 2:
                    w["end_ms"] = _int32(wv)
                elif wf == 3:
                    w["word"] = wv.decode("utf-8", "replace")
                elif wf == 4:
                    w["confidence"] = _float(wv)
            alt["words"].append(w)
        elif f == 4:
            alt["language_code"].append(v.decode("utf-8", "replace"))
    return alt


def parse_recognize_response(buf):
    """RecognizeResponse → [{"transcript", "confidence", ...}](結果ごとの第1候補)。"""
    results = []
    for f, v in _fields(buf):
        if f != 1:
            continue
        alts = [_parse_alternative(av) for af, av in _fields(v) if af == 1]
        if alts:
            results.append(alts[0])
    return results


def parse_streaming_response(buf):
    """StreamingRecognizeResponse → [(is_final, 第1候補)]。"""
    out = []
    for f, v in _fields(buf):
        if f != 1:
            continue
        is_final = False
        alt = None
        for rf, rv in _fields(v):
            if rf == 1 and alt is None:
                alt = _parse_alternative(rv)
            elif rf == 2:
                is_final = bool(rv)
        if alt is not None:
            out.append((is_final, alt))
    return out


def parse_config_response(buf):
    """RivaSpeechRecognitionConfigResponse → [(モデル名, {パラメータ})]。"""
    out = []
    for f, v in _fields(buf):
        if f != 1:
            continue
        name, params = "", {}
        for cf, cv in _fields(v):
            if cf == 1:
                name = cv.decode("utf-8", "replace")
            elif cf == 2:
                k = val = ""
                for mf, mv in _fields(cv):
                    if mf == 1:
                        k = mv.decode("utf-8", "replace")
                    elif mf == 2:
                        val = mv.decode("utf-8", "replace")
                params[k] = val
        out.append((name, params))
    return out


def join_results(results):
    texts = [r["transcript"].strip() for r in results if r.get("transcript", "").strip()]
    conf = [r["confidence"] for r in results if r.get("transcript", "").strip()]
    langs = [c for r in results for c in r.get("language_code", [])]
    return {
        "text": " ".join(texts),
        "confidence": round(sum(conf) / len(conf), 3) if conf else None,
        "language": langs[0] if langs else "",
    }


# ==========================================
# 送信間隔(全スレッド共通)
# ==========================================
class RateLimiter:
    def __init__(self, rpm, floor=6):
        self.max_rpm = float(rpm)
        self.rpm = float(rpm)
        self.floor = float(floor)
        self.next_slot = 0.0
        self.last_cut = 0.0
        self.lock = threading.Lock()
        self.stop = threading.Event()

    def wait(self):
        with self.lock:
            now = time.monotonic()
            wait = self.next_slot - now
            self.next_slot = max(now, self.next_slot) + 60.0 / max(1.0, self.rpm)
        if wait > 0:
            self.stop.wait(wait)
        return not self.stop.is_set()

    def slow_down(self):
        with self.lock:
            now = time.monotonic()
            if now - self.last_cut < 10:
                return None
            self.last_cut = now
            old = self.rpm
            self.rpm = max(self.floor, self.rpm * 0.7)
            return (old, self.rpm) if round(self.rpm) < round(old) else None

    def speed_up(self):
        with self.lock:
            self.rpm = min(self.max_rpm, self.rpm + 0.5)


# ==========================================
# Riva(gRPC)
# ==========================================
_RETRY_CODES = ("UNAVAILABLE", "DEADLINE_EXCEEDED", "RESOURCE_EXHAUSTED",
                "INTERNAL", "UNKNOWN", "ABORTED")


class RivaClient:
    def __init__(self, server, api_key, limiter, timeout=120, max_retries=5,
                 insecure=False, log=print):
        try:
            import grpc
        except ImportError:
            raise FatalAPIError("grpcio がありません。Termux で "
                                "`pkg install python-grpcio` を実行してください。")
        self.grpc = grpc
        opts = [("grpc.max_receive_message_length", 64 << 20),
                ("grpc.max_send_message_length", 64 << 20)]
        if insecure:                           # 試験用(手元の偽サーバー)
            self.channel = grpc.insecure_channel(server, options=opts)
        else:
            creds = grpc.ssl_channel_credentials(root_certificates=_system_roots())
            self.channel = grpc.secure_channel(server, creds, options=opts)
        self.api_key = api_key
        self.limiter = limiter
        self.timeout = timeout
        self.max_retries = max_retries
        self.log = log
        self._recognize = self.channel.unary_unary(RECOGNIZE)
        self._streaming = self.channel.stream_stream(STREAMING_RECOGNIZE)
        self._get_config = self.channel.unary_unary(GET_CONFIG)
        self._bnr = self.channel.stream_stream(BNR_ENHANCE)

    def close(self):
        self.channel.close()

    def _metadata(self, function_id):
        return (("function-id", function_id),
                ("authorization", f"Bearer {self.api_key}"))

    # ---------- 失敗の扱い ----------
    def _call(self, what, fn):
        """fn() を、送信間隔を守り、一時的な失敗は待ってやり直して呼ぶ。"""
        grpc = self.grpc
        last = ""
        for attempt in range(self.max_retries + 1):
            if not self.limiter.wait():
                raise SegmentAPIError("中断しました")
            try:
                out = fn()
                self.limiter.speed_up()
                return out
            except grpc.RpcError as e:
                code = e.code().name if e.code() else "UNKNOWN"
                detail = (e.details() or "").strip()
                last = f"{code}: {detail[:300]}"
                if code in ("UNAUTHENTICATED", "PERMISSION_DENIED"):
                    raise FatalAPIError(
                        f"{what}: API キーが通りません({last})。\n"
                        "  NVIDIA_API_KEY が正しいか、build.nvidia.com でキーが有効か確かめてください。")
                if code == "NOT_FOUND":
                    raise FatalAPIError(
                        f"{what}: function-id が見つかりません({last})。\n"
                        "  `python mojiokoshi.py models` で今の function-id を探してください。")
                if code == "INVALID_ARGUMENT" and _looks_like_config_error(detail):
                    raise FatalAPIError(
                        f"{what}: このモデルは指定の条件を受け付けません({last})。\n"
                        "  言語コードやモードが合っていない可能性があります。"
                        "`python mojiokoshi.py models` で確かめてください。")
                if code == "UNAVAILABLE" and _looks_like_tls_error(detail):
                    raise FatalAPIError(
                        f"{what}: 暗号化通信(TLS)を確立できません({last})。\n"
                        "  Termux で `pkg install ca-certificates` を実行してから試してください。")
                if code not in _RETRY_CODES:
                    raise SegmentAPIError(last)
                if code == "RESOURCE_EXHAUSTED" or "429" in detail:
                    cut = self.limiter.slow_down()
                    if cut:
                        self.log(f"  [送信間隔] 混雑の応答が返ったため、送信上限を"
                                 f" {cut[0]:.0f} → {cut[1]:.0f} 回/分に下げます。")
                if attempt < self.max_retries:
                    wait = min(60.0, 2.0 * (2 ** attempt)) * (0.8 + 0.4 * random.random())
                    if self.limiter.stop.wait(wait):
                        raise SegmentAPIError("中断しました")
        raise SegmentAPIError(f"再試行を使い切りました({last})")

    # ---------- 音声認識 ----------
    def recognize(self, function_id, pcm16, language, mode="offline",
                  punctuation=True, sample_rate=16000, style="pcm", what="認識"):
        """16bit モノラルの生データを認識して {"text", "confidence", "language"} を返す。

        style:
          pcm … 生データに、形式(LINEAR_PCM・16kHz・1ch)を明示して送る(既定)
          wav … WAV のヘッダを付け、形式は書かずに送る(公式の
                transcribe_file_offline.py と同じ送り方。オフライン方式のみ)
        """
        if style == "wav" and mode != "streaming":
            cfg = recognition_config(language, sample_rate=0, punctuation=punctuation,
                                     encoding=0, channels=0)
            pcm16 = _wav(pcm16, sample_rate)
        else:
            cfg = recognition_config(language, sample_rate=sample_rate, punctuation=punctuation)
        md = self._metadata(function_id)
        if mode == "streaming":
            def fn():
                return self._recognize_streaming(cfg, pcm16, md, sample_rate)
        else:
            req = recognize_request(cfg, pcm16)

            def fn():
                return join_results(parse_recognize_response(
                    self._recognize(req, metadata=md, timeout=self.timeout)))
        return self._call(what, fn)

    def _recognize_streaming(self, cfg, pcm16, md, sample_rate):
        chunk = sample_rate * 2 // 10            # 0.1秒ずつ

        def requests():
            yield streaming_config_request(cfg)
            for i in range(0, len(pcm16), chunk):
                yield streaming_audio_request(pcm16[i:i + chunk])

        finals = []
        last_partial = None
        for resp in self._streaming(requests(), metadata=md, timeout=self.timeout):
            for is_final, alt in parse_streaming_response(resp):
                if is_final:
                    finals.append(alt)
                    last_partial = None
                else:
                    last_partial = alt
        if last_partial is not None and last_partial.get("transcript", "").strip():
            finals.append(last_partial)
        return join_results(finals)

    def list_models(self, function_id):
        """その function が持つ認識モデルと、そのパラメータ(言語コードなど)。"""
        md = self._metadata(function_id)
        return parse_config_response(
            self._get_config(b"", metadata=md, timeout=min(30, self.timeout)))

    # ---------- BNR(雑音除去) ----------
    def bnr(self, function_id, samples48k, intensity=1.0, what="BNR"):
        """48kHz の float32(-1〜1)を送り、雑音を除いた float32 を返す。

        NVIDIA-Maxine/nim-clients の bnr.py のストリーミング方式(10ms ずつ
        float32 を送る)に合わせてある。
        """
        import numpy as np
        md = self._metadata(function_id)
        step = 480                                 # 10ms

        def requests():
            if intensity is not None:
                yield _f_bytes(2, _f_float(1, intensity))
            x = np.asarray(samples48k, dtype="<f4")
            pad = (-len(x)) % step
            if pad:
                x = np.pad(x, (0, pad))
            for i in range(0, len(x), step):
                yield _f_bytes(1, x[i:i + step].tobytes())

        def fn():
            out = bytearray()
            for resp in self._bnr(requests(), metadata=md, timeout=self.timeout):
                for f, v in _fields(resp):
                    if f == 1:
                        out.extend(v)
            return np.frombuffer(bytes(out), dtype="<f4")[:len(samples48k)]

        return self._call(what, fn)


def _system_roots():
    """端末の証明書の束(Termux の ca-certificates など)。無ければ None(grpc 内蔵のもの)。"""
    import os
    cands = [os.environ.get("SSL_CERT_FILE", "")]
    prefix = os.environ.get("PREFIX", "")
    if prefix:
        cands.append(os.path.join(prefix, "etc", "tls", "cert.pem"))
    cands += ["/etc/ssl/certs/ca-certificates.crt", "/etc/ssl/cert.pem"]
    for c in cands:
        if c and os.path.isfile(c):
            try:
                with open(c, "rb") as f:
                    return f.read()
            except OSError:
                continue
    return None


def _looks_like_tls_error(detail):
    low = detail.lower()
    return any(w in low for w in ("ssl", "handshake", "certificate", "tls"))


def _looks_like_config_error(detail):
    low = detail.lower()
    return any(w in low for w in ("language", "unavailable model", "model is not",
                                  "no model", "not supported", "sample rate",
                                  "sample_rate", "invalid model"))


# ==========================================
# function-id を探す(NVCF の一覧)
# ==========================================
def list_functions(api_key, url, timeout=20):
    """NVCF の関数一覧。取れなければ (None, 理由)。"""
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {api_key}", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}"
    except (urllib.error.URLError, OSError, ValueError) as e:
        return None, f"{type(e).__name__}: {e}"
    funcs = data.get("functions") or []
    return funcs, ""


def match_functions(funcs, tokens):
    """名前に tokens をすべて含む ACTIVE な関数。"""
    out = []
    for fn in funcs:
        name = (fn.get("name") or "").lower()
        if fn.get("status", "ACTIVE") != "ACTIVE":
            continue
        if all(t.lower() in name for t in tokens):
            out.append(fn)
    return out
