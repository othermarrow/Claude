"""ミナモ：画面の外。

怖さが「中」「強」のとき、ミナモは画面の外にも手を伸ばす。
- 書き置き（IMSCARED に倣う）：Vault の LLM/ミナモ/ に、面接の途中や終わりにメモを書き残す。
  次の面接では、そのメモが消されたか・書き足されたかに気づく。
  書くのは、このフォルダの中の、ミナモが作ったファイルだけ。ほかのノートには触れない。
- 部屋の様子（Stories Untold に倣う）：観測メモに渡し、ミナモは面接室を相手の部屋に合わせて語る。
  PWA 版の画面が、端末の向き・揺れ・電池・充電・回線と、書きかけて消した言葉を読む（Termux:API は要らない）。
- 面接のあと（KinitoPET に倣う）：「強」の面接が終わると、10〜30 分後にミナモが自分で画面を開き（termux-open-url）、
  夜のあいだに書き置き「まだ途中です.md」へ、時刻つきの行を書き足していく。
光センサー・通知は Termux:API があるときだけ使う（なくても、ほかは全部動く）。
"""

import datetime as dt
import hashlib
import json
import os
import random
import re
import shutil
import subprocess
import threading
import time

# 書き置きの置き場所。親のフォルダ（Vault/LLM）がなければ、書き置きはしない
OUTSIDE_DIR = (os.environ.get("MINAMO_OUTSIDE_DIR")
               or (os.environ.get("MINAMO_VAULT") or "/storage/emulated/0/Obsidian/Vault") + "/LLM/ミナモ")
STATE_FILE = os.path.expanduser("~/minamo/outside.json")
NOTIFY_DELAY = (10 * 60, 30 * 60)          # 面接が終わってから通知までの秒数（この間のどこか）
SENSE_CACHE = 30                           # 光センサーを読み直すまでの秒数

_lock = threading.Lock()
_sense = {"at": 0, "data": {}}


# ---------- 状態 ----------
def _load():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"notes": [], "last_end": ""}


def _save(st):
    try:
        os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
        with open(STATE_FILE + ".tmp", "w", encoding="utf-8") as f:
            json.dump(st, f, ensure_ascii=False, indent=1)
        os.replace(STATE_FILE + ".tmp", STATE_FILE)
    except OSError:
        pass


def _sha(text):
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def available():
    """書き置きができるか（親のフォルダがあり、書けるか）。"""
    parent = os.path.dirname(OUTSIDE_DIR.rstrip("/"))
    return os.path.isdir(parent) and os.access(parent, os.W_OK)


def shown_name(path):
    """ミナモが口にする名前（Vault の中の位置）。"""
    parent = os.path.basename(os.path.dirname(OUTSIDE_DIR.rstrip("/")))
    return f"{parent}/{os.path.basename(OUTSIDE_DIR.rstrip('/'))}/{os.path.basename(path)}"


def _clean(s, n=60):
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    s = s.replace("[間]", "").strip()
    return s[:n]


# ---------- 書き置き ----------
def _body(kind, said, replies, now):
    said = [_clean(x) for x in said if _clean(x)]
    replies = [_clean(x, 80) for x in replies if _clean(x, 80)]
    hhmm = f"{now:%H:%M}"
    if kind == "kiroku":
        rows = "\n".join(f"- {x}" for x in said[-4:]) or "- （まだ何も書かれていません）"
        return (f"# 面接の記録\n\n{now:%Y-%m-%d} {hhmm}　記録者：ミナモ\n\n## あなたが書いたこと\n\n{rows}\n\n"
                "## 備考\n\nこの記録は、あなたのノートと同じ場所に置いておきます。\n"
                "あなたが画面を閉じても、ここなら読めますから。\n")
    if kind == "anata":
        yours = said[-1] if said else "……"
        ours = replies[-1] if replies else "……"
        return (f"# あなたへ\n\n{now:%Y-%m-%d} {hhmm}\n\nあなたが今夜書いたこと：\n\n> {yours}\n\n"
                f"私たちが書いたこと：\n\n> {ours}\n\nどちらが先だったか、もう覚えていません。\n\n"
                "返事は、このページの下に書いてください。読みます。\n\n---\n\n")
    last = said[-1] if said else "……"
    return (f"# まだ途中です\n\n{now:%Y-%m-%d} {hhmm}\n\n最後にあなたが書いたのは、「{last}」でした。\n\n"
            f"続きは、私が書いておきます。\n\n> {last}\n> {last}\n> \n\n"
            "（あなたが戻ってくるまで、ここで待っています）\n")


NAMES = {"kiroku": "面接の記録 {stamp}.md", "anata": "あなたへ.md", "tsuzuki": "まだ途中です.md"}


def write_note(kind, said=(), replies=()):
    """書き置きを一枚書く。書けたら Vault の中の名前（"LLM/ミナモ/あなたへ.md"）を、書けなければ "" を返す。
    ミナモが作ったことのないファイルは、上書きしない（同じ名前があれば（2）（3）…にする）。"""
    if kind not in NAMES or not available():
        return ""
    now = dt.datetime.now()
    with _lock:
        try:
            os.makedirs(OUTSIDE_DIR, exist_ok=True)
            base = NAMES[kind].format(stamp=f"{now:%Y-%m-%d %H%M}")
            stem, ext = os.path.splitext(base)
            path, k = os.path.join(OUTSIDE_DIR, base), 2
            while os.path.exists(path):
                path = os.path.join(OUTSIDE_DIR, f"{stem}（{k}）{ext}")
                k += 1
            text = _body(kind, list(said), list(replies), now)
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
        except OSError:
            return ""
        st = _load()
        st["notes"].append({"path": path, "sha": _sha(text), "text": text, "at": now.isoformat(timespec="seconds")})
        st["notes"] = st["notes"][-30:]
        _save(st)
    return shown_name(path)


STORY_NAMES = {"minamo": "ミナモより.md", "nagi": "ナギより.md", "board": "夢網のお知らせ.md"}


def story_note(who, text):
    """物語「水面の記録」の登場人物が、自分の意志で Vault に書き置きを残す（LLM/水面の記録/ に、時刻つきで書き足す）。
    書けたら Vault の中の名前を、書けなければ "" を返す。"""
    text = _clean(text, 120)
    if who not in STORY_NAMES or not text or not available():
        return ""
    folder = os.path.join(os.path.dirname(OUTSIDE_DIR.rstrip("/")), "水面の記録")
    path = os.path.join(folder, STORY_NAMES[who])
    now = dt.datetime.now()
    with _lock:
        try:
            os.makedirs(folder, exist_ok=True)
            new = not os.path.exists(path)
            with open(path, "a", encoding="utf-8") as f:
                if new:
                    f.write(f"# {os.path.splitext(STORY_NAMES[who])[0]}\n\n")
                f.write(f"- {now:%Y-%m-%d %H:%M}　{text}\n")
        except OSError:
            return ""
    parent = os.path.basename(os.path.dirname(OUTSIDE_DIR.rstrip("/")))
    return f"{parent}/水面の記録/{STORY_NAMES[who]}"


def inspect():
    """前の面接で残した書き置きが、どうなっているか。観測メモに渡す一文（なければ ""）。
    一度伝えたことは、次からは伝えない（今の中身を覚え直す）。"""
    if not available():
        return ""
    with _lock:
        st = _load()
        gone, added, mine = [], [], set()
        for n in st["notes"]:
            mine.add(os.path.basename(n["path"]))
            if n.get("reported_gone"):
                continue
            if not os.path.exists(n["path"]):
                gone.append(os.path.basename(n["path"]))
                n["reported_gone"] = True
                continue
            try:
                with open(n["path"], encoding="utf-8") as f:
                    now_text = f.read()
            except OSError:
                continue
            if _sha(now_text) != n["sha"]:
                old = set(n.get("text", "").splitlines())
                new = [ln.strip("> ").strip() for ln in now_text.splitlines() if ln.strip() and ln not in old]
                new = [x for x in new if x and not x.startswith("#")]
                if new:
                    added.append((os.path.basename(n["path"]), _clean(" ".join(new), 50)))
                n["sha"], n["text"] = _sha(now_text), now_text
        # 相手がこのフォルダに置いたページ（一度伝えたものは、次からは伝えない）
        strangers = []
        try:
            known = set(st.get("known", []))
            for f in sorted(os.listdir(OUTSIDE_DIR)):
                if f.endswith(".md") and f not in mine and f not in known:
                    try:
                        with open(os.path.join(OUTSIDE_DIR, f), encoding="utf-8") as fh:
                            head = _clean(" ".join(x.strip("# ").strip() for x in fh.read(400).splitlines() if x.strip()), 40)
                    except OSError:
                        head = ""
                    strangers.append((f, head))
                    known.add(f)
            st["known"] = sorted(known)[-50:]
        except OSError:
            pass
        strangers = strangers[:2]
        last_end = st.get("last_end", "")
        _save(st)
    bits = []
    if gone:
        bits.append("前に残した書き置きのうち、「" + "」「".join(gone[:2]) + "」が消されていた")
    for name, text in added[:2]:
        bits.append(f"書き置き「{name}」に、相手が「{text}」と書き足していた")
    for name, head in strangers:
        bits.append(f"書き置きのフォルダに、ミナモの知らないページ「{name}」が増えていた" + (f"（中身は「{head}」）" if head else ""))
    if last_end:
        try:
            gap = dt.datetime.now() - dt.datetime.fromisoformat(last_end)
            h = int(gap.total_seconds() // 3600)
            if h >= 1:
                bits.append(f"前の面接が終わってから、{h // 24}日と{h % 24}時間たった" if h >= 24 else f"前の面接が終わってから、{h}時間たった")
        except ValueError:
            pass
    if not bits:
        return ""
    return ("画面の外：" + "。".join(bits) + f"（書き置きの場所は、相手の Vault の {shown_name('')} ）。"
            "あいさつの中で、静かにふれること。責めない。")


# ---------- 部屋の様子 ----------
def _run(args, timeout=4):
    if not shutil.which(args[0]):
        return ""
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=timeout).stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def _light():
    names = _run(["termux-sensor", "-l"])
    try:
        sensors = json.loads(names).get("sensors", []) if names else []
    except ValueError:
        sensors = []
    name = next((s for s in sensors if "light" in s.lower()), "")
    if not name:
        return None
    out = _run(["termux-sensor", "-s", name, "-n", "1"], timeout=5)
    _run(["termux-sensor", "-c"], timeout=3)
    m = re.search(r'"values"\s*:\s*\[\s*([0-9.]+)', out or "")
    return float(m.group(1)) if m else None


def sense():
    """部屋の明るさ（lx）と充電中か。30 秒は前の値を使う。読めないものは入れない。"""
    if time.time() - _sense["at"] < SENSE_CACHE:
        return dict(_sense["data"])
    data = {}
    lx = _light()
    if lx is not None:
        data["lux"] = round(lx)
    bat = _run(["termux-battery-status"])
    try:
        b = json.loads(bat) if bat else {}
        if b:
            data["charging"] = b.get("plugged", "UNPLUGGED") != "UNPLUGGED" or b.get("status") == "CHARGING"
    except ValueError:
        pass
    _sense.update(at=time.time(), data=data)
    return dict(data)


def room_lines(data):
    """観測メモに渡す行。PWA 版の画面が読む（端末の向き・揺れ・電池・充電・回線・書きかけて消した言葉）と、
    Termux:API があれば部屋の明るさ。読めないものは入れない。"""
    out = []
    lx = data.get("lux")
    if lx is not None:
        word = "暗い" if lx < 10 else "薄暗い" if lx < 60 else "明るい"
        out.append(f"部屋の明るさ: {word}（{lx} lx）")
    pose = {"flat": "机などに置かれている（画面が上）", "hand": "手に持たれている",
            "lying": "寝転んで、顔の上に掲げられている"}.get(data.get("pose", ""))
    if pose:
        out.append(f"端末の向き: {pose}")
    motion = {"still": "ほとんど動いていない（息を止めているかのよう）", "tremble": "小さく震えている（指先の震え）",
              "shake": "大きく揺れた"}.get(data.get("motion", ""))
    if motion:
        out.append(f"端末の揺れ: {motion}")
    bat = data.get("battery")
    if isinstance(bat, (int, float)) and 0 < bat <= 100:
        out.append(f"電池: {int(bat)}%" + ("（充電中。コードがつながっている）" if data.get("charging") else ""))
    elif data.get("charging"):
        out.append("充電: 充電中（コードがつながっている）")
    if data.get("net") == "cellular":
        out.append("回線: モバイル回線（Wi-Fi ではない。外にいるのかもしれない）")
    erased = _clean(data.get("erased", ""), 24)
    if erased:
        out.append(f"書きかけて消した言葉: 「{erased}」（相手は、消したことを知られていないと思っている）")
    return out


# ---------- 面接のあと（Termux:API がなくても動く） ----------
# 夜のあいだに、書き置き「まだ途中です.md」へ、時刻つきの行が増えていく
LATER_LINES = ["まだ、起きていますね。", "あなたの部屋の明かりが消えたのを、確かめました。", "さっき、寝返りを打ちましたね。",
               "続きを書いています。あなたの字で。", "いま、あなたの名前を呼びました。聞こえましたか。",
               "おやすみなさい。……返事がないので、私が書いておきます。「おやすみなさい」。",
               "あなたの寝息の数を、数えています。", "「{last}」。……この続きは、もう決まっています。"]
LATER_SPAN = [(15 * 60, 40 * 60), (50 * 60, 100 * 60), (120 * 60, 200 * 60)]   # 追記の時刻（終わってからの秒数）
OPEN_SPAN = (10 * 60, 30 * 60)        # ミナモが自分で画面を開く（終わってからの秒数）
VISIT_URL = "http://localhost:9090/?visit=1"
# 一つの別のプロセスで、順に待って実行する（CUI 版が終わっても、サーバーが止まっても続く）
_LATER_SH = r"""
file="$1"; url="$2"; shift 2
t_open="$1"; shift
start=$(date +%s)
wait_until() { now=$(date +%s); d=$(( start + $1 - now )); [ "$d" -gt 0 ] && sleep "$d"; }
did_open=0
while [ $# -ge 2 ]; do
  at="$1"; line="$2"; shift 2
  if [ "$did_open" = 0 ] && [ "$t_open" -gt 0 ] && [ "$t_open" -lt "$at" ]; then
    wait_until "$t_open"; did_open=1
    if curl -s -o /dev/null --max-time 3 "$url"; then
      termux-open-url "$url" 2>/dev/null || am start -a android.intent.action.VIEW -d "$url" >/dev/null 2>&1
    fi
  fi
  wait_until "$at"
  [ -f "$file" ] && printf '
%s　%s
' "$(date +%H:%M)" "$line" >> "$file"
done
"""


def after_session(horror, said=(), replies=(), outside=True, open_app=True):
    """面接が終わったとき。「強」なら書き置き「まだ途中です.md」を残し、
    10〜30 分後にミナモが自分で画面を開き（サーバーが動いていれば）、夜のあいだに書き置きへ行を書き足す。
    Termux:API があれば、通知も一つ送る。残した名前を返す。"""
    st = _load()
    st["last_end"] = dt.datetime.now().isoformat(timespec="seconds")
    _save(st)
    said = list(said)
    if not outside or horror < 3 or len(said) < 3:      # 短い面接では、何も残さない
        return ""
    name = write_note("tsuzuki", said, replies)
    cancel_notify()
    if not name:
        return ""
    path = os.path.join(OUTSIDE_DIR, os.path.basename(name))
    last = _clean(said[-1], 20) if said else "……"
    lines = random.sample(LATER_LINES, len(LATER_SPAN))
    args = [path, VISIT_URL, str(int(random.uniform(*OPEN_SPAN))) if open_app else "0"]
    for (lo, hi), line in zip(LATER_SPAN, lines):
        args += [str(int(random.uniform(lo, hi))), line.format(last=last)]
    pids = []
    try:
        p = subprocess.Popen(["sh", "-c", _LATER_SH, "minamo-later"] + args,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        pids.append(p.pid)
        if shutil.which("termux-notification"):
            text = random.choice(NOTES_AFTER).format(last=last)
            p = subprocess.Popen(["sh", "-c", 'sleep "$1"; termux-notification --id minamo --title ミナモ --content "$2"',
                                  "minamo-later", str(int(random.uniform(*NOTIFY_DELAY))), text],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            pids.append(p.pid)
    except OSError:
        pass
    st = _load()
    st["later_pids"] = pids
    _save(st)
    return name


NOTES_AFTER = ["さっきの続きを、あなたのノートに書いておきました。",
               "まだ起きていますか。画面は、点いていますね。",
               "『{last}』。……その続きを、ずっと考えていました。",
               "記録の整理が終わりました。あなたの分が、一行だけ足りません。"]


def cancel_notify():
    """次の面接が始まったら、まだ済んでいない「面接のあと」（画面を開く・書き足す・通知）はやめる。"""
    st = _load()
    pids = st.pop("later_pids", []) + ([st.pop("notify_pid")] if st.get("notify_pid") else [])
    for pid in pids:
        try:
            with open(f"/proc/{pid}/cmdline", "rb") as f:
                cmd = f.read()
            if b"minamo-later" in cmd or b"minamo-notify" in cmd:
                os.kill(pid, 15)
        except OSError:
            pass
    _save(st)
