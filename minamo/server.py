#!/usr/bin/env python3
"""ミナモ（PWA 版）のサーバー。Termux の中だけで動かす。

  - web/ の画面を配る（Chrome で開いて「アプリをインストール」）
  - 画面から受け取った会話に、システムプロンプトと紹介状を付けて API に送る
  - APIキーはこのサーバーだけが持つ。画面（ブラウザ）には渡さない
  - 面接記録を RECORD_DIR に Markdown で保存する

自分のスマホからだけ見えるように 127.0.0.1 で待つ。
ほかのサイトから勝手に呼ばれないように、/api/ は Host と専用のヘッダーを確かめる。
"""

import argparse
import datetime as dt
import http.server
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import minamo  # noqa: E402

PORT = 8082
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
MAX_BODY = 2 * 1024 * 1024

STATE = {}


def info():
    return {
        "ready": STATE["llm"] is not None,
        "error": STATE["error"],
        "backend": STATE["backend"],
        "model": getattr(STATE["llm"], "model", ""),
        "mode": getattr(STATE["llm"], "mode", "cloud"),
        "karte": getattr(STATE["llm"], "karte", False),
        "env": STATE["env"],
        "silence": STATE["silence"],
        "max_unprompted": minamo.MAX_UNPROMPTED,
        "phases": minamo.PHASES,
        "crisis_words": minamo.CRISIS_WORDS,
        "exit_words": minamo.EXIT_WORDS,
        "records": minamo.RECORD_DIR,
        "library": STATE["library"].counts() if STATE["library"] else [0, 0],
    }


def clean_contents(raw):
    """画面から来た会話を、決まった形だけに揃える。"""
    out = []
    for m in raw if isinstance(raw, list) else []:
        role = "model" if m.get("role") == "model" else "user"
        text = "".join(str(p.get("text", "")) for p in m.get("parts", [])
                       if isinstance(p, dict))
        if text:
            out.append({"role": role, "parts": [{"text": text}]})
    return out


def save_record(markdown):
    os.makedirs(minamo.RECORD_DIR, exist_ok=True)
    path = os.path.join(minamo.RECORD_DIR, f"{dt.datetime.now():%Y%m%d-%H%M%S}.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(markdown)
    return path


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB_DIR, **kw)

    def log_message(self, fmt, *args):
        pass                                  # 画面のファイル取得のたびに出さない

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _trusted(self):
        host = (self.headers.get("Host") or "").split(":")[0]
        return host in ("localhost", "127.0.0.1") and self.headers.get("X-Minamo") == "1"

    def do_GET(self):
        if self.path.startswith("/api/"):
            if not self._trusted():
                return self._json(403, {"error": "forbidden"})
            if self.path == "/api/info":
                return self._json(200, info())
            return self._json(404, {"error": "not found"})
        return super().do_GET()

    def do_POST(self):
        if not self._trusted():
            return self._json(403, {"error": "forbidden"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > MAX_BODY:
                return self._json(413, {"error": "too large"})
            data = json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            return self._json(400, {"error": "bad json"})

        if self.path == "/api/ask":
            if STATE["llm"] is None:
                return self._json(503, {"error": STATE["error"]})
            contents = clean_contents(data.get("contents"))
            if data.get("findings"):
                contents.append({"role": "user",
                                 "parts": [{"text": minamo.FINDINGS_PROMPT}]})
            if not contents:
                return self._json(400, {"error": "empty"})
            # 蔵書の一節は、その回の最後の発言にだけ添える（画面には返さない）
            try:
                phase = max(0, min(int(data.get("phase") or 0), len(minamo.PHASES) - 1))
            except (TypeError, ValueError):
                phase = 0
            note = minamo.library_note(STATE["library"], str(data.get("lib_query") or ""), phase)
            if note and contents[-1]["role"] == "user":
                contents[-1]["parts"][0]["text"] += "\n\n" + note
                print("蔵書: " + note.splitlines()[0])
            try:
                text = STATE["llm"].ask(contents)
            except RuntimeError as e:
                return self._json(502, {"error": str(e)})
            mode = getattr(STATE["llm"], "mode", "cloud")
            if mode != STATE.get("mode"):
                print(minamo.MODE_NOTE.get(mode, ""), getattr(STATE["llm"], "model", ""))
                STATE["mode"] = mode
            return self._json(200, {"text": text, "mode": mode})

        if self.path == "/api/record":
            md = str(data.get("markdown") or "")
            if not md.strip():
                return self._json(400, {"error": "empty"})
            try:
                return self._json(200, {"path": save_record(md)})
            except OSError as e:
                return self._json(500, {"error": str(e)})

        return self._json(404, {"error": "not found"})


def main():
    ap = argparse.ArgumentParser(description="ミナモ（PWA 版）のサーバー")
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--backend", choices=["gemini", "nvidia"])
    ap.add_argument("--model")
    ap.add_argument("--silence", type=int, default=minamo.SILENCE_SEC)
    ap.add_argument("--no-env", action="store_true")
    ap.add_argument("--no-karte", action="store_true")
    ap.add_argument("--library", action="append")
    ap.add_argument("--no-library", action="store_true")
    ap.add_argument("--records", default=minamo.RECORD_DIR)
    ap.add_argument("--fake", action="store_true")
    ap.add_argument("--offline", action="store_true", help="クラウドの AI を使わない")
    ap.add_argument("--no-local", action="store_true", help="端末の中の AI を試さない")
    a = ap.parse_args()
    minamo.RECORD_DIR = os.path.expanduser(a.records)

    if not a.no_library:
        print("蔵書を開いています……")
    library = None if a.no_library else minamo.load_library(a.library or minamo.LIBRARY_DIRS)
    STATE.update(llm=None, error="", silence=a.silence, library=library,
                 backend="fake" if a.fake else a.backend,
                 env={} if a.no_env else minamo.gather_env())
    llm = minamo.make_llm(a.backend, a.model, a.no_karte, a.fake, a.offline, not a.no_local)
    STATE["llm"] = llm
    first = llm.tiers[0]
    STATE["mode"] = first[0]
    if a.fake:
        STATE["backend"] = "fake"
    elif first[0] == "cloud":
        STATE["backend"] = type(first[1]).__name__.lower()
    else:
        STATE["backend"] = "旧式のみ"
        print("クラウドの AI は使いません（APIキーがないか --offline）。旧式エンジンで話します。")

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    print(f"API: {STATE['backend']} / {llm.model}　（つながらないときは "
          + " → ".join(n for n, _ in llm.tiers[1:]) + "）")
    if library:
        print(minamo.library_status(library))
    print(f"Chrome で http://localhost:{a.port}/ を開いてください（止めるときは Ctrl+C）")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print()


if __name__ == "__main__":
    main()
