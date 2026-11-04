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
import outside  # noqa: E402
import story_ai  # noqa: E402
import wrist  # noqa: E402
import senses  # noqa: E402

PORT = 9090
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
MAX_BODY = 2 * 1024 * 1024

STATE = {}


def build_info():
    """いまのファイルの版：画面（sw.js の VERSION）と、git のコミット（端末で更新できたかを見分けるため）。"""
    import re
    import subprocess
    web = commit = ""
    try:
        with open(os.path.join(WEB_DIR, "sw.js"), encoding="utf-8") as f:
            m = re.search(r'VERSION = "([^"]+)"', f.read())
            web = m.group(1) if m else ""
    except OSError:
        pass
    try:
        commit = subprocess.run(["git", "-C", os.path.dirname(WEB_DIR), "log", "-1", "--format=%h（%cd）",
                                 "--date=format:%m/%d %H:%M"], capture_output=True, text=True, timeout=3).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return web, commit


def info():
    web, commit = build_info()
    return {
        "web_version": web, "commit": commit,
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
        # 終わりの合図の見分け方（minamo.is_exit と同じもの）と、怖さの段階
        "exit_re": minamo.EXIT_RE_SRC, "exit_strip": minamo.EXIT_STRIP, "exit_split": minamo.EXIT_SPLIT,
        "exit_block": minamo.EXIT_BLOCK_SRC, "exit_memo": minamo.EXIT_MEMO,
        "horror_levels": minamo.HORROR_LEVELS, "horror": minamo.HORROR,
        "horror_tricks": minamo.HORROR_TRICKS, "trick_note": minamo.TRICK_NOTE,
        # 画面の外（Vault への書き置き・部屋の様子・あとから届く通知）
        "outside_available": minamo.OUTSIDE and outside.available(), "outside_dir": outside.shown_name(""),
        "outside_notes": [lv["notes"] for lv in minamo.HORROR_LEVELS],
        "records": minamo.RECORD_DIR,
        "library": STATE["library"].counts() if STATE["library"] else [0, 0],
        "library_own": STATE["library"].own_counts() if STATE["library"] else [0, 0],
        # 起動時の一括チェックの結果（返事の中身は渡さない）
        "probe": [{k: r[k] for k in ("backend", "model", "sec", "ok", "why")} for r in STATE.get("probe") or []],
    }


def models_info():
    """GET /api/models：一括チェックで合格した AI と、いま選んでいるもの。"""
    llm = STATE.get("llm")
    c = llm.cloud() if llm is not None and hasattr(llm, "cloud") else None
    picked = getattr(c, "picked", None)
    first = minamo.Relay.name(c.llms[0]) if isinstance(c, minamo.Relay) and c.llms else None
    choices = [{"backend": r["backend"], "model": r["model"], "sec": r.get("sec")}
               for r in STATE.get("probe") or [] if r.get("ok")]
    return {"choices": choices, "auto": picked is None,
            "current": {"backend": first[0], "model": first[1]} if first else None,
            "mode": getattr(llm, "mode", ""), "probing": bool(STATE.get("probing"))}


def reprobe():
    """一括チェックをやり直して、合格した AI で、面接と物語・時計の AI を作り直す。"""
    STATE["probing"] = True
    try:
        args = STATE.get("args")
        ranked, probed = minamo.probe_models(getattr(args, "backend", None), getattr(args, "no_karte", False))
    finally:
        STATE["probing"] = False
    STATE["probe"] = probed
    llm = STATE["llm"]
    system = llm.system or minamo.SYSTEM_PROMPT

    def make(b, m):
        key = minamo.load_key(minamo.KEY_NAMES[b])
        if not key:
            return None
        x = minamo.make_cloud(b, key, m, system)
        if b != "gemini":
            x.candidates = [m]
        return x
    llm.set_cloud(ranked, make)
    c = story_ai._CONF
    story_ai.setup(ranked, offline=c["offline"], local=c["local"], fake=c["fake"])
    print(f"AI の一括チェックをやり直しました：合格 {len(ranked)} 個")
    return models_info()


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
    path = minamo.record_path(f"{dt.datetime.now():%Y%m%d-%H%M%S}.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(markdown)
    return path


class Server(http.server.ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        # 起動の途中（一括チェックのさいちゅう）に待ちきれずに切れた接続は、ログを汚さない
        if isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


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
            if self.path == "/api/outside":
                # 面接の始まり：前の書き置きのその後（届いていない通知はやめる）
                if not minamo.OUTSIDE:
                    return self._json(200, {"finding": ""})
                outside.cancel_notify()
                return self._json(200, {"finding": outside.inspect()})
            if self.path == "/api/own":
                # 物語の掲示板に紛れ込ませる、自分の文章の短い一節（題名・名前・サイト名は伏せたもの）
                lib = STATE["library"]
                return self._json(200, {"lines": lib.quote() if lib and hasattr(lib, "quote") else []})
            if self.path == "/api/watch":
                # 腕時計（minamo-watch）から届いた、手首の様子
                return self._json(200, wrist.snapshot())
            if self.path == "/api/models":
                return self._json(200, models_info())
            if self.path == "/api/senses":
                # スマホの感覚（予定・居場所・天気・通知）。裏の糸で 3 分おきに読んだもの
                return self._json(200, senses.snapshot())
            if self.path == "/api/memory":
                mem = STATE["llm"].engines["2026"].memory
                return self._json(200, {"items": mem.data["items"], "sessions": mem.data["sessions"]})
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
            try:
                horror = max(0, min(3, int(data.get("horror") or 0)))
            except (TypeError, ValueError):
                horror = 0
            note = minamo.library_note(STATE["library"], str(data.get("lib_query") or ""), phase, horror)
            if note and contents[-1]["role"] == "user":
                contents[-1]["parts"][0]["text"] += "\n\n" + note
                print("蔵書: " + note.splitlines()[0])
            version = "1996" if str(data.get("version")) == "1996" else "2026"
            try:
                text = STATE["llm"].ask(contents, version=version, offline=bool(data.get("offline")))
            except RuntimeError as e:
                return self._json(502, {"error": str(e)})
            text = minamo.japanese_only(minamo.strip_leak(text))          # 写り込んだ観測メモと、混ざった韓国語・英単語を取り除く
            if not data.get("findings"):
                wrist.note_interview(contents, text, horror)     # 時計へ漏れ出す材料（ファイルには残さない）
            mode = getattr(STATE["llm"], "mode", "cloud")
            if mode != STATE.get("mode"):
                print(minamo.MODE_NOTE.get(mode, ""), getattr(STATE["llm"], "model", ""))
                STATE["mode"] = mode
            return self._json(200, {"text": text, "mode": mode,
                                    "events": getattr(STATE["llm"], "events", [])})

        if self.path == "/api/outside":
            # 書き置きを一枚残す（種類は決まったものだけ。名前と中身はサーバーが決める）
            if not minamo.OUTSIDE:
                return self._json(200, {"name": ""})
            said = [str(x)[:200] for x in (data.get("said") or [])][-20:]
            replies = [str(x)[:300] for x in (data.get("replies") or [])][-20:]
            name = outside.write_note(str(data.get("kind") or ""), said, replies)
            if name:
                print("画面の外：書き置き " + name)
            return self._json(200, {"name": name, "line": minamo.NOTE_MEMO.format(name=name) if name else ""})

        if self.path == "/api/room":
            # 部屋の様子：画面が読んだ端末の向き・充電と、Termux が読んだ明るさ
            room = outside.sense() if minamo.OUTSIDE else {}
            pose = str(data.get("pose") or "")
            if pose in ("flat", "hand", "lying"):
                room["pose"] = pose
            motion = str(data.get("motion") or "")
            if motion in ("still", "tremble", "shake"):
                room["motion"] = motion
            if data.get("charging") is not None and "charging" not in room:
                room["charging"] = bool(data.get("charging"))
            try:
                room["battery"] = int(data.get("battery"))
            except (TypeError, ValueError):
                pass
            if data.get("net") in ("wifi", "cellular"):
                room["net"] = data["net"]
            room["erased"] = str(data.get("erased") or "")[:40]
            return self._json(200, {"lines": outside.room_lines(room) if minamo.OUTSIDE else []})

        if self.path == "/api/model":
            # アプリから AI を選ぶ（backend なしなら自動＝速い順）。物語・時計の AI も同じ順にする
            llm = STATE.get("llm")
            if llm is None or not hasattr(llm, "choose"):
                return self._json(503, {"error": "not ready"})
            b = data.get("backend") if data.get("backend") in minamo.KEY_NAMES else None
            m = str(data.get("model") or "")[:120]
            ok = llm.choose(b, m) if b else llm.choose()
            if ok:
                ranked = [(r["backend"], r["model"], r.get("sec") or 0) for r in STATE.get("probe") or [] if r.get("ok")]
                if b:
                    ranked = [x for x in ranked if (x[0], x[1]) == (b, m)] + [x for x in ranked if (x[0], x[1]) != (b, m)]
                c = story_ai._CONF
                story_ai.setup(ranked or c["ranked"], offline=c["offline"], local=c["local"], fake=c["fake"])
                print("AI を選びました：" + (f"{b} / {m}" if b else "自動（速い順）"))
            return self._json(200, dict(models_info(), ok=ok))
        if self.path == "/api/reconnect":
            # 切れたあと、すぐにクラウドを試し直す
            if STATE.get("llm") is not None and hasattr(STATE["llm"], "reconnect"):
                STATE["llm"].reconnect()
            return self._json(200, models_info())
        if self.path == "/api/reprobe":
            if STATE.get("llm") is None or STATE.get("probing"):
                return self._json(409, {"error": "busy"})
            return self._json(200, reprobe())
        if self.path == "/api/memory/clear":
            STATE["llm"].engines["2026"].memory.clear()
            print("メモリを消去しました")
            return self._json(200, {"ok": True})

        if self.path == "/api/story":
            # 物語「水面の記録」の登場人物の声と行動（クラウド → 端末の中の AI。だめなら ok: false）
            out = story_ai.handle(data)
            if out.get("ok"):
                print(f"物語：{data.get('who')}／{data.get('mode')}（{out.get('source')}）")
                wrist.note_story(data.get("who"), out.get("say"))
            return self._json(200, out)

        if self.path == "/api/story/note":
            # 登場人物の書き置き（Vault の LLM/水面の記録/）。画面の外を使わない設定なら、書かない
            name = outside.story_note(str(data.get("who") or ""), str(data.get("text") or "")) if minamo.OUTSIDE else ""
            return self._json(200, {"name": name})

        if self.path == "/api/watch":
            # 腕時計 →（Bluetooth）→ Zepp アプリのサイドサービス → ここ。返事は時計に届く
            return self._json(200, wrist.update(data))

        if self.path == "/api/record":
            md = str(data.get("markdown") or "")
            if not md.strip():
                return self._json(400, {"error": "empty"})
            try:
                path = save_record(md)
            except OSError as e:
                return self._json(500, {"error": str(e)})
            if minamo.OUTSIDE and data.get("outside"):
                try:
                    horror = max(0, min(3, int(data.get("horror") or 0)))
                except (TypeError, ValueError):
                    horror = 0
                said = [str(x)[:200] for x in (data.get("said") or [])][-20:]
                replies = [str(x)[:300] for x in (data.get("replies") or [])][-20:]
                name = outside.after_session(horror, said, replies)
                if name:
                    print("画面の外：書き置き " + name)
            return self._json(200, {"path": path})

        return self._json(404, {"error": "not found"})


def main():
    ap = argparse.ArgumentParser(description="ミナモ（PWA 版）のサーバー")
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--backend", choices=["gemini", "nvidia", "groq"])
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
    ap.add_argument("--local-share", type=float, metavar="0〜1",
                    help="端末の中の AI にひとことを頼む割合（既定 0.8〜0.9。1 ならいつも頼む）")
    ap.add_argument("--local-mode", choices=["assist", "full"],
                    help="端末の中の AI の使い方（既定 assist：ひとことだけ頼む。full：全部話させる）")
    ap.add_argument("--no-outside", action="store_true",
                    help="画面の外（Vault への書き置き・部屋の明るさ・あとから届く通知）を使わない")
    ap.add_argument("--no-probe", action="store_true",
                    help="起動時の AI の一括チェックをしない（いつもの設定のモデルを使う）")
    ap.add_argument("--probe-timeout", type=int, metavar="秒",
                    help=f"起動時の AI の一括チェックで待つ秒数（既定 {minamo.PROBE_TIMEOUT}）")
    a = ap.parse_args()
    if a.probe_timeout:
        minamo.PROBE_TIMEOUT = max(1, a.probe_timeout)
    minamo.RECORD_DIR = os.path.expanduser(a.records)

    # 先にポートを取る（前のサーバーが動いていたら、蔵書の読み込みや AI の一括チェックの前に知らせる）
    try:
        srv = Server(("127.0.0.1", a.port), Handler)
    except OSError as e:
        if e.errno in (98, 48):          # Address already in use
            print(f"ポート {a.port} は、もう使われています（前に起動したミナモのサーバーが動いたままかもしれません）。\n"
                  "そのまま Chrome で開けば、前のサーバーで遊べます。新しく起動し直すなら、止めてからもう一度：\n"
                  "  pkill -f \"minamo/server.py\"")
            sys.exit(1)
        raise

    if not a.no_library:
        print("蔵書を開いています……")
    library = None if a.no_library else minamo.load_library(a.library or minamo.LIBRARY_DIRS)
    STATE.update(llm=None, error="", silence=a.silence, library=library,
                 backend="fake" if a.fake else a.backend,
                 env={} if a.no_env else minamo.gather_env())
    minamo.set_local_share(a.local_share)
    if a.no_outside:
        minamo.OUTSIDE = False
    outside.VISIT_URL = f"http://localhost:{a.port}/?visit=1"
    ranked, probed = None, []
    if minamo.PROBE_ON_START and not (a.no_probe or a.model or a.fake or a.offline):
        ranked, probed = minamo.probe_models(a.backend, a.no_karte)
    STATE["probe"] = probed
    STATE["args"] = a
    story_ai.setup(ranked, offline=a.offline, local=not a.no_local, fake=a.fake)
    llm = minamo.make_llm(a.backend, a.model, a.no_karte, a.fake, a.offline, not a.no_local,
                          library=library, ranked=ranked, local_mode=a.local_mode)
    STATE["llm"] = llm
    STATE["mode"] = llm.mode
    if a.fake:
        STATE["backend"] = "fake"
    elif llm.tiers and llm.tiers[0][0] == "cloud":
        cloud = llm.tiers[0][1]
        STATE["backend"] = type(cloud.llms[0] if isinstance(cloud, minamo.Relay) else cloud).__name__.lower()
    else:
        STATE["backend"] = "端末内のみ"
        print("クラウドの AI は使いません（APIキーがないか --offline）。端末内のエンジンで話します。")

    print(f"API: {STATE['backend']} / {llm.model}　（つながらないときは "
          + " → ".join([n for n, _ in llm.tiers[1:]] + ["端末内のエンジン（2026 / 1996）"
            + ("。端末の中の AI が動いていれば、ひとことを添える" if getattr(llm.engines["2026"].talk, "helper", None) else "")])
          + "）")
    if library:
        print(minamo.library_status(library))
    print(wrist.boot_banner())                # 前に手首（腕時計の minamo）から届いたのはいつか
    senses.start()                            # スマホの感覚（予定・居場所・天気・通知）を、裏で 3 分おきに読む
    print(f"Chrome で http://localhost:{a.port}/ を開いてください（止めるときは Ctrl+C）")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print()


if __name__ == "__main__":
    main()
