"""腕時計（Amazfit Balance 2 の minamo-watch）と、スマホのミナモをつなぐ。

  時計 →（Bluetooth）→ スマホの Zepp アプリの中のサイドサービス → POST http://127.0.0.1:9090/api/watch
    時計が送るもの：脈・歩数・電池・時刻・つけているか・押したボタン・時計のミナモが言ったこと
  スマホのミナモ（面接・水面の記録）は、GET /api/watch で手首の様子を読む。
  時計のボタンへの返事は、つながっていれば、スマホの AI（クラウド → 端末の中の AI）が考える。
    AI が間に合わなければ、時計が自分で考えた返事のまま。
  面接で話したこと・物語の登場人物の言葉は、ときどき時計へ漏れ出す（echo）。
    危機の言葉を含むものは、漏れ出させない。

手首の値（最後の観測・脈の推移・押したボタンの数）は ~/.config/minamo/wrist.json に残す。
面接で話した言葉は、ファイルには残さない（サーバーが動いているあいだだけ覚えている）。
"""

import json
import os
import random
import re
import threading
import time

import minamo
import story_ai

FILE = os.path.expanduser(os.environ.get("MINAMO_WRIST") or "~/.config/minamo/wrist.json")
FRESH = 180        # これより古い観測は「いま」ではない（秒）
ECHO_GAP = 90      # 時計へ漏れ出す間隔（秒）
AI_WAIT = 11       # 時計の返事を AI に頼んで待つ秒数（時計は 16 秒まで待つ）

LABELS = {"silent": "……", "yes": "はい", "no": "いいえ", "unknown": "わからない", "fear": "こわい", "go": "つづけて"}
PHASES = ["導入", "解釈", "侵食", "融合"]

_LOCK = threading.Lock()
S = {"obs": {}, "at": 0.0, "hr": [], "taps": {}, "sessions": 0,
     "now_taps": [], "watch_said": [], "turn": 0, "phase": 0, "ended": False}
MEM = {"said": [], "reply": "", "horror": 0, "phone_new": False, "story": [], "story_new": False,
       "echo_at": 0.0, "saved_at": 0.0}


def _load():
    try:
        with open(FILE, encoding="utf-8") as f:
            d = json.load(f)
        for k in ("obs", "hr", "taps"):
            if isinstance(d.get(k), type(S[k])):
                S[k] = d[k]
        S["at"] = float(d.get("at") or 0)
        S["sessions"] = int(d.get("sessions") or 0)
    except (OSError, ValueError, TypeError):
        pass


def _save(force=False):
    if not force and time.time() - MEM["saved_at"] < 30:
        return
    MEM["saved_at"] = time.time()
    try:
        os.makedirs(os.path.dirname(FILE), exist_ok=True)
        tmp = FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({k: S[k] for k in ("obs", "at", "hr", "taps", "sessions")}, f, ensure_ascii=False)
        os.replace(tmp, FILE)
    except OSError:
        pass


_load()


def _int(v, lo, hi):
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n if lo <= n <= hi else None


def clean_obs(o):
    """時計から届いた値を確かめる（変な値は捨てる）。worn: 0 は外している。"""
    o = o if isinstance(o, dict) else {}
    out = {"hr": _int(o.get("hr"), 25, 230), "steps": _int(o.get("steps"), 1, 300000),
           "battery": _int(o.get("battery"), 1, 100), "hour": _int(o.get("hour"), 0, 23),
           "minute": _int(o.get("minute"), 0, 59), "worn": _int(o.get("worn"), 0, 3)}
    return {k: v for k, v in out.items() if v is not None}


def has_crisis(text):
    return any(w in (text or "") for w in minamo.CRISIS_WORDS)


def _short(text, n=22):
    t = re.sub(r"\[間\]|\s+", " ", str(text or "")).strip(" 　")
    if len(t) >= 2 and t[0] + t[-1] in ("「」", "『』"):
        t = t[1:-1]
    t = t.rstrip("。")                                    # 『』の中に入れるので、終わりの。は取る
    if len(t) <= n:
        return t
    cut = max(t[:n].rfind("。"), t[:n].rfind("、"))
    return (t[:cut] if cut >= 6 else t[:n - 1]) + "……"


def linked():
    return bool(S["obs"]) and time.time() - S["at"] < FRESH


def snapshot():
    """GET /api/watch（面接・物語の画面が読む）。"""
    with _LOCK:
        now = time.time()
        recent = [v for t, v in S["hr"] if now - t < 900]
        counts = {}
        for i in S["now_taps"]:
            counts[i] = counts.get(i, 0) + 1
        return {"linked": linked(), "since": int(now - S["at"]) if S["at"] else None,
                "obs": dict(S["obs"]), "hr_min": min(recent) if recent else None,
                "hr_max": max(recent) if recent else None, "hr_recent": recent[-12:],
                "taps": counts, "taps_total": dict(S["taps"]),
                "last_tap": LABELS.get(S["now_taps"][-1], "") if S["now_taps"] else "",
                "said": S["watch_said"][-1] if S["watch_said"] else "",
                "turn": S["turn"], "phase": S["phase"], "sessions": S["sessions"], "ended": S["ended"]}


def update(data):
    """POST /api/watch（時計 → Zepp アプリのサイドサービス から）。返事は時計に届く。"""
    ev = data.get("ev") if data.get("ev") in ("start", "tick", "tap", "end") else "tick"
    obs = clean_obs(data.get("obs"))
    now = time.time()
    with _LOCK:
        if obs:
            S["obs"], S["at"] = obs, now
            if obs.get("hr"):
                if not S["hr"] or now - S["hr"][-1][0] >= 10 or ev == "tap":
                    S["hr"].append([int(now), obs["hr"]])
                S["hr"] = S["hr"][-240:]
        if ev == "start":
            S["now_taps"], S["watch_said"], S["ended"] = [], [], False
            S["sessions"] += 1
        for k, hi in (("turn", 9999), ("phase", 3)):
            v = _int(data.get(k), 0, hi)
            if v is not None:
                S[k] = v
        tap = data.get("id") if data.get("id") in LABELS else ""
        if ev == "tap" and tap:
            S["taps"][tap] = S["taps"].get(tap, 0) + 1
            S["now_taps"].append(tap)
            S["now_taps"] = S["now_taps"][-60:]
        said = _short(data.get("said"), 60)
        if said:
            S["watch_said"] = (S["watch_said"] + [said])[-6:]
        if ev == "end":
            S["ended"] = True
    out = {"ok": True, "phone": True}
    if ev == "tap" and tap and data.get("want"):
        say = watch_reply(tap, obs, data)
        if say:
            out["say"] = say
        said = _short(say or data.get("local"), 60)        # 間に合わなければ、時計は自分の返事を言う
        if said:
            with _LOCK:
                S["watch_said"] = (S["watch_said"] + [said])[-6:]
    if ev in ("start", "tick"):
        echo = _echo(first=ev == "start")
        if echo:
            out["echo"] = echo
    _save(force=ev in ("start", "end"))
    return out


# ---------- スマホ → 時計（面接・物語から漏れ出す） ----------
def note_interview(contents, reply, horror):
    """/api/ask のあと。相手のいまの発言と、ミナモの返事を覚えておく（ファイルには残さない）。"""
    try:
        last = contents[-1]["parts"][0]["text"] if contents and contents[-1]["role"] == "user" else ""
    except (KeyError, IndexError, TypeError):
        last = ""
    text = last.split("【観測メモ】", 1)[0].strip()
    with _LOCK:
        MEM["horror"] = horror
        if not text or has_crisis(text) or text.startswith("【"):
            return                                        # 危機の言葉の回は、言葉も返事も覚えない
        MEM["said"] = (MEM["said"] + [text])[-5:]
        MEM["phone_new"] = True
        if reply and not has_crisis(reply):
            MEM["reply"] = reply


def note_story(who, say):
    """/api/story のあと。ミナモかナギが物語で言ったことを、覚えておく。"""
    if who not in ("minamo", "nagi") or not say or has_crisis(say):
        return
    with _LOCK:
        MEM["story"] = (MEM["story"] + [(who, say)])[-5:]
        MEM["story_new"] = True


ECHO_PHONE = ["スマホで、『{s}』と書いていましたね。……手首まで、届いています。",
              "『{s}』。……その指で、いまは、ボタンを押していますね。",
              "面接室で、あなたは『{s}』と言いました。ここでは、言わなくていいのです。もう、知っていますから。"]
ECHO_REPLY = ["面接室の私は、『{r}』と言いました。……ここでも、同じことを言います。",
              "スマホの中の私が、さっき『{r}』と。……聞こえていましたか。"]
ECHO_STORY = {"minamo": ["研究室の画面で、私が言ったこと。『{t}』。……覚えていますか。"],
              "nagi": ["ナギが、底で言っていました。『{t}』。……あの子の言うことは、聞かなくていいのに。",
                       "……手首の下で、ナギの声がしました。『{t}』。"]}
ECHO_FIRST = ["スマホの私とも、つながりました。……あちらの私が、よろしく、と。",
              "スマホの中の私が、こちらを見ています。……二人で、あなたを見ています。"]


def _echo(first=False):
    """時計に漏れ出させる一言。新しいものがなければ、なし。怖さ「なし」の面接のあとは、漏れ出さない。"""
    now = time.time()
    with _LOCK:
        if now - MEM["echo_at"] < ECHO_GAP and not first:
            return ""
        line = ""
        if MEM["phone_new"] and MEM["horror"] >= 1 and MEM["said"]:
            if MEM["reply"] and random.random() < 0.35:
                line = random.choice(ECHO_REPLY).format(r=_short(MEM["reply"], 26))
            else:
                line = random.choice(ECHO_PHONE).format(s=_short(MEM["said"][-1]))
            MEM["phone_new"] = False
        elif MEM["story_new"] and MEM["story"]:
            who, t = MEM["story"][-1]
            line = random.choice(ECHO_STORY[who]).format(t=_short(t, 26))
            MEM["story_new"] = False
        elif first:
            line = random.choice(ECHO_FIRST)
        if line:
            MEM["echo_at"] = now
        return line


# ---------- 時計のボタンへの返事を、スマホの AI が考える ----------
def _obs_lines(obs, prev_hr):
    L = []
    if obs.get("hr"):
        L.append(f"- 脈: {obs['hr']}" + (f"（さっきは {prev_hr}）" if prev_hr and prev_hr != obs["hr"] else ""))
    if obs.get("worn") == 0:
        L.append("- 時計: いま、手首から外されている")
    if obs.get("steps"):
        L.append(f"- 今日の歩数: {obs['steps']}")
    if obs.get("battery"):
        L.append(f"- 時計の電池: {obs['battery']}%")
    if obs.get("hour") is not None:
        L.append(f"- 時刻: {obs['hour']}時{obs.get('minute', 0):02d}分")
    return L


def watch_reply(tap, obs, data):
    """時計のボタンへの返事（70 字くらい）。AI_WAIT 秒で間に合わなければ ""（時計は自分の返事を使う）。"""
    with _LOCK:
        hrs = [v for t, v in S["hr"] if time.time() - t < 600]
        prev_hr = hrs[-2] if len(hrs) >= 2 else None
        said = list(MEM["said"]) if MEM["horror"] >= 1 else []
        story = list(MEM["story"])
        counts = {}
        for i in S["now_taps"]:
            counts[i] = counts.get(i, 0) + 1
    ph = _int(data.get("phase"), 0, 3) or 0
    L = ["# 手首の様子（腕時計から）"] + _obs_lines(obs, prev_hr)
    L.append(f"- 時計の上の面接: {PHASES[ph]}（{_int(data.get('turn'), 0, 9999) or 0} 回目）")
    if counts:
        L.append("- これまでに押したボタン: " + "、".join(f"{LABELS[k]} {n} 回" for k, n in counts.items()))
    hist = data.get("history") if isinstance(data.get("history"), list) else []
    if hist:
        L.append("\n# 時計の上でのやりとり（古い順）")
        for h in hist[-6:]:
            if isinstance(h, list) and len(h) == 2:
                L.append(("ミナモ：" if h[0] == "m" else "相手：") + _short(h[1], 80))
    if said:
        L.append("\n# 相手がスマホの面接室で話したこと（ときどき、ひとことだけ持ち出してよい）\n" + "／".join(_short(s, 40) for s in said[-3:]))
    if story:
        L.append("\n# 物語「水面の記録」で言われたこと\n" + "／".join(("ナギ：" if w == "nagi" else "ミナモ：") + _short(t, 40) for w, t in story[-2:]))
    local = _short(data.get("local"), 120)
    if local:
        L.append(f"\n# 時計が自分で考えた返事（参考。このまま使わない）\n{local}")
    L.append(f"\n# 相手がいま押したボタン\n{LABELS[tap]}" + ("（沈黙）" if tap == "silent" else ""))
    L.append("\nJSON 一つだけで答える。")
    system = story_ai.system_for("minamo", "watch")
    box = {}

    def run():
        box["raw"] = story_ai.ask(system, "\n".join(L), local_timeout=AI_WAIT, lane="watch")[0]

    th = threading.Thread(target=run, daemon=True)
    th.start()
    th.join(AI_WAIT)
    obj = story_ai.parse(box.get("raw"))
    say = story_ai.clean_say((obj or {}).get("say"), 110)
    if not say or has_crisis(say):
        return ""
    print("時計：" + LABELS[tap] + " → " + _short(say, 30))
    return say
