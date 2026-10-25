"""API キーの読み込みと、HTTP の送受信(送信間隔・再試行・1日の上限の見分け)。

標準ライブラリだけで書いてある(Termux で pip の追加が要らない)。
"""

import json
import os
import random
import re
import threading
import time
import urllib.error
import urllib.request

import config

# Ctrl-C で全スレッドを止めるときに立てる
STOP = threading.Event()


class ApiError(Exception):
    """待っても直らない失敗(キーの誤り・モデル名の誤り・形式の誤りなど)。"""

    def __init__(self, status, message, what=""):
        super().__init__(f"{what} HTTP {status}: {message}".strip())
        self.status = status
        self.message = message


class QuotaExhausted(ApiError):
    """回数・量の上限に達した(待つ時間が MAX_WAIT_SEC を超える)。今回の実行では使わない。"""


class Stopped(Exception):
    pass


# ------------------------------------------
# API キー
# ------------------------------------------
KEY_NAMES = {"groq": "GROQ_API_KEY", "nvidia": "NVIDIA_API_KEY", "gemini": "GEMINI_API_KEY"}
_keys = None


def _read_env_file(path):
    out = {}
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip().removeprefix("export ").strip()
                out[k] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return out


def keys():
    global _keys
    if _keys is None:
        found = {}
        for path in (config.KEYS_FILE,) + tuple(config.KEYS_FALLBACK_FILES):
            for k, v in _read_env_file(path).items():
                found.setdefault(k, v)
        for name in KEY_NAMES.values():
            if os.environ.get(name):
                found[name] = os.environ[name]
        # Gemini は GOOGLE_API_KEY の名前でも受け付ける
        if not found.get("GEMINI_API_KEY") and (os.environ.get("GOOGLE_API_KEY") or found.get("GOOGLE_API_KEY")):
            found["GEMINI_API_KEY"] = os.environ.get("GOOGLE_API_KEY") or found["GOOGLE_API_KEY"]
        _keys = found
    return _keys


def key(provider):
    v = keys().get(KEY_NAMES[provider], "")
    if not v or "ここに" in v:
        return ""
    return v


# ------------------------------------------
# 送信間隔
# ------------------------------------------
class RateLimiter:
    def __init__(self, rpm):
        self.interval = 60.0 / max(rpm, 0.1)
        self.next = 0.0
        self.lock = threading.Lock()

    def wait(self):
        with self.lock:
            now = time.monotonic()
            t = max(now, self.next)
            self.next = t + self.interval
        sleep(t - time.monotonic())


_limiters = {}
_lim_lock = threading.Lock()


def limiter(name, rpm):
    with _lim_lock:
        if name not in _limiters:
            _limiters[name] = RateLimiter(rpm)
        return _limiters[name]


def sleep(sec):
    """STOP が立ったらすぐ戻る sleep。"""
    if sec <= 0:
        return
    if STOP.wait(sec):
        raise Stopped()


# ------------------------------------------
# 429 の待ち時間の読み取り
# ------------------------------------------
_DUR_RE = re.compile(r"try again in\s+((?:\d+h)?(?:\d+m(?!s))?(?:[\d.]+s)?(?:[\d.]+ms)?)", re.I)


def _parse_duration(s):
    total = 0.0
    for num, unit in re.findall(r"([\d.]+)(ms|h|m|s)", s):
        total += float(num) * {"h": 3600, "m": 60, "s": 1, "ms": 0.001}[unit]
    return total


def retry_after(headers, body_text):
    """待つべき秒数(分からなければ None)と、1日の上限らしいか。"""
    wait = None
    ra = headers.get("retry-after") if headers else None
    if ra:
        try:
            wait = float(ra)
        except ValueError:
            pass
    m = _DUR_RE.search(body_text or "")
    if m:
        wait = max(wait or 0, _parse_duration(m.group(1)))
    m = re.search(r'"retryDelay"\s*:\s*"([\d.]+)s"', body_text or "")
    if m:
        wait = max(wait or 0, float(m.group(1)))
    low = (body_text or "").lower()
    daily = ("per day" in low or "perday" in low or "(rpd)" in low or "(tpd)" in low
             or "(asd)" in low or "daily" in low)
    return wait, daily


# ------------------------------------------
# 送受信
# ------------------------------------------
def request(method, url, *, headers=None, data=None, timeout=None, limit=None,
            what="", retries=None):
    """HTTP で送り、(status, headers(小文字のキー), body bytes) を返す。

    429・5xx・通信エラーは待って送り直す。4xx(429 以外)は ApiError を投げる。
    待つ時間が長すぎる 429 は QuotaExhausted を投げる。
    """
    timeout = timeout or config.REQUEST_TIMEOUT
    retries = config.MAX_RETRIES if retries is None else retries
    attempt = 0
    while True:
        if STOP.is_set():
            raise Stopped()
        if limit is not None:
            limit.wait()
        req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
                return r.status, {k.lower(): v for k, v in r.headers.items()}, body
        except urllib.error.HTTPError as e:
            body = e.read() or b""
            text = body.decode("utf-8", "replace")
            hdrs = {k.lower(): v for k, v in (e.headers or {}).items()}
            msg = _error_message(text)
            if e.code == 429:
                wait, daily = retry_after(hdrs, text)
                if (wait is not None and wait > config.MAX_WAIT_SEC) or (daily and (wait is None or wait > 60)):
                    raise QuotaExhausted(429, msg, what)
                attempt += 1
                if attempt > retries + 4:          # 混んでいるだけなら多めに待つ
                    raise QuotaExhausted(429, msg, what)
                sleep((wait if wait is not None else min(60, 5 * 2 ** min(attempt, 4))) + random.uniform(0.5, 2))
                continue
            if e.code in (408, 409, 500, 502, 503, 504, 529):
                attempt += 1
                if attempt > retries:
                    raise ApiError(e.code, msg, what)
                sleep(min(90, 3 * 2 ** attempt) + random.uniform(0, 2))
                continue
            raise ApiError(e.code, msg, what)
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            attempt += 1
            if attempt > retries:
                raise ApiError(0, f"通信エラー: {e}", what)
            sleep(min(90, 3 * 2 ** attempt) + random.uniform(0, 2))


def request_json(method, url, payload=None, *, headers=None, **kw):
    h = {"Content-Type": "application/json", "Accept": "application/json"}
    h.update(headers or {})
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    _, _, body = request(method, url, headers=h, data=data, **kw)
    try:
        return json.loads(body.decode("utf-8")) if body else {}
    except json.JSONDecodeError:
        raise ApiError(200, f"JSON として読めない応答: {body[:200]!r}", kw.get("what", ""))


def _error_message(text):
    try:
        j = json.loads(text)
        err = j.get("error", j)
        if isinstance(err, dict):
            return str(err.get("message") or err)[:500]
        return str(err)[:500]
    except Exception:
        return text[:500]


def multipart(fields, files):
    """multipart/form-data の本文と Content-Type。fields は [(名前, 値)]、files は [(名前, ファイル名, bytes, 型)]。"""
    boundary = "----mojiokoshi" + "".join(random.choice("0123456789abcdef") for _ in range(24))
    out = []
    for name, value in fields:
        out.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        out.append(str(value).encode("utf-8") + b"\r\n")
    for name, filename, data, ctype in files:
        out.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; '
                   f'filename="{filename}"\r\nContent-Type: {ctype}\r\n\r\n'.encode())
        out.append(data + b"\r\n")
    out.append(f"--{boundary}--\r\n".encode())
    return b"".join(out), f"multipart/form-data; boundary={boundary}"
