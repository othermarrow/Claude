"""腕時計（Amazfit Balance 2 の minamo-watch）と、スマホのミナモをつなぐ。
時計の上にいるのは「minamo」（面接室のミナモ・掲示板の水面とは別の、水面からこぼれた小さな子）と、
ときどき「nagi」（男の子）。時計の返事は minamo の声で考える（story_ai の minamo_w）。

  時計 →（Bluetooth）→ スマホの Zepp アプリの中のサイドサービス → POST http://127.0.0.1:9090/api/watch
    時計が送るもの：脈・歩数・電池・時刻・つけているか・押したボタン・時計の minamo が言ったこと・届かなかったあいだに押したボタン
  スマホのミナモ（面接・水面の記録）は、GET /api/watch で手首の様子を読む。
  時計のボタンへの返事は、つながっていれば、スマホの AI（クラウド → 端末の中の AI）が考える。
    AI が間に合わなければ、時計が自分で考えた返事のまま。
  面接で話したこと・物語の登場人物の言葉は、ときどき時計へ漏れ出す（echo）。
    危機の言葉を含むものは、漏れ出させない。

手首の値（最後の観測・脈の推移・押したボタンの数・留守のあいだに押したボタン）は ~/.config/minamo/wrist.json に残す。
面接で話した言葉は、ファイルには残さない（サーバーが動いているあいだだけ覚えている）。

起動のときの連携（mo を動かしたとき）
  - 起動の表示（boot_banner）：前に手首から届いたのはいつか・そのときの脈と電池。
  - サーバーが起きてから、時計が初めてつながったとき：返事に boot（AI の声の出どころ・前に届いてから何分）を入れる。
    時計の minamo が「面接室のミナモが起きた」と言い、物語の掲示板に「再起動の記録」が立つ。
  - mo が止まっていたあいだに時計で押したボタン（away）は、つながったときにまとめて届く。
    押した数に足し、面接の観測メモ・物語の掲示板・時計の返事の材料にする。
"""

import json
import os
import random
import re
import socket
import threading
import time

import minamo
import senses
import story_ai

FILE = os.path.expanduser(os.environ.get("MINAMO_WRIST") or "~/.config/minamo/wrist.json")
FRESH = 180        # これより古い観測は「いま」ではない（秒）
ECHO_GAP = 90      # 時計へ漏れ出す間隔（秒）
AI_WAIT = 11       # 時計の返事を AI に頼んで待つ秒数（時計は 16 秒まで待つ）

LABELS = {"silent": "……", "yes": "はい", "no": "いいえ", "unknown": "わからない", "fear": "こわい", "go": "つづけて"}
ID_RE = re.compile(r"^[a-z0-9_]{1,12}$")      # 時計のボタンの名前（ボタンが増えても、名前と表示は時計から届く）
PHASES = ["導入", "解釈", "侵食", "融合"]

_LOCK = threading.Lock()
S = {"obs": {}, "at": 0.0, "hr": [], "taps": {}, "labels": {}, "sessions": 0, "away": [],
     "now_taps": [], "watch_said": [], "turn": 0, "phase": 0, "ended": False, "days": 0}
MEM = {"said": [], "reply": "", "horror": 0, "phone_new": False, "story": [], "story_new": False,
       "echo_at": 0.0, "saved_at": 0.0}


def _load():
    try:
        with open(FILE, encoding="utf-8") as f:
            d = json.load(f)
        for k in ("obs", "hr", "taps", "labels", "away"):
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
            json.dump({k: S[k] for k in ("obs", "at", "hr", "taps", "labels", "sessions", "away")}, f, ensure_ascii=False)
        os.replace(tmp, FILE)
    except OSError:
        pass


_load()

# 起動のときの連携：いつ起きたか・その前に手首から届いたのはいつか・起きてから時計が初めてつながったか
BOOT = time.time()
PREV_AT = S["at"]
BOOT_STATE = {"told": False, "watch_at": 0.0, "gap": None, "away_n": 0}
_AWAY_SEEN = set()          # 二重に届いた「留守のあいだのボタン」を数えないように（時刻と名前）


def _dur_words(sec):
    m = int(sec // 60)
    if m < 1:
        return "1分たらず"
    if m < 60:
        return f"{m}分"
    if m < 60 * 24:
        return f"{m // 60}時間{m % 60}分" if m % 60 else f"{m // 60}時間"
    return f"{m // (60 * 24)}日"


def _ago_words(sec):
    return "いま" if sec < 60 else _dur_words(sec) + "前"


def boot_banner():
    """起動の表示に出す一行（server.py から）。前に手首から届いたのはいつか。"""
    if not PREV_AT:
        return ("腕時計（minamo）：まだ一度も届いていません。時計で minamo を開くと、Zepp アプリを通してつながります。")
    o = S["obs"] or {}
    vals = [f"脈 {o['hr']}" if o.get("hr") else "", f"電池 {o['battery']}%" if o.get("battery") else "",
            "外していた" if o.get("worn") == 0 else ""]
    vals = "・".join(v for v in vals if v)
    t = time.strftime("%m/%d %H:%M", time.localtime(PREV_AT))
    return (f"腕時計（minamo）：前に届いたのは {t}（{_ago_words(BOOT - PREV_AT)}" + (f"・{vals}" if vals else "") + "）。"
            "時計が次に起きたとき（開いたとき・独り言の予約・毎時 59 分）に、起動したことを伝えます。")


def voice():
    """いまのミナモの声の出どころ：'cloud'（クラウドの AI）・'local'（端末の中の AI）・''（決まった言葉）。"""
    c = story_ai._CONF
    if not c.get("offline") and not c.get("fake") and c.get("ranked"):
        return "cloud"
    if c.get("local"):
        try:
            with socket.create_connection(("127.0.0.1", 8090), timeout=0.3):
                return "local"
        except OSError:
            pass
    if not c.get("offline") and not c.get("fake") and any(minamo.load_key(minamo.KEY_NAMES[b]) for b in minamo.BACKENDS):
        return "cloud"
    return ""


def _take_away(raw):
    """時計が、届かなかったあいだに押したボタン [[時刻(ms), id, 表示], ...]。新しいものだけ足し、受け取った数を返す。"""
    if not isinstance(raw, list):
        return 0, []
    got, new = 0, []
    for it in raw[:30]:
        if not (isinstance(it, list) and len(it) >= 2):
            continue
        got += 1
        t = _int(it[0], 1_500_000_000_000, 4_000_000_000_000)
        tap = it[1] if isinstance(it[1], str) and ID_RE.match(it[1]) else ""
        if not t or not tap or (t, tap) in _AWAY_SEEN:
            continue
        _AWAY_SEEN.add((t, tap))
        label = re.sub(r"[\x00-\x1f<>{}]", "", str(it[2] if len(it) > 2 else "") or "")[:12] or LABELS.get(tap, tap)
        new.append({"t": t, "id": tap, "label": label})
    if len(_AWAY_SEEN) > 400:
        _AWAY_SEEN.clear()
    return got, new


def _int(v, lo, hi):
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n if lo <= n <= hi else None


def _num(v, lo, hi):
    try:
        n = round(float(v), 1)
    except (TypeError, ValueError):
        return None
    return n if lo <= n <= hi else None


def clean_obs(o):
    """時計から届いた値を確かめる（変な値・知らない項目は捨てる。ニックネームは受け取らない）。worn: 0 は外している。"""
    o = o if isinstance(o, dict) else {}
    out = {"hr": _int(o.get("hr"), 25, 230), "hrRest": _int(o.get("hrRest"), 25, 200),
           "steps": _int(o.get("steps"), 1, 300000), "cal": _int(o.get("cal"), 1, 20000),
           "dist": _int(o.get("dist"), 1, 500000), "stand": _int(o.get("stand"), 1, 24),
           "battery": _int(o.get("battery"), 1, 100), "hour": _int(o.get("hour"), 0, 23),
           "minute": _int(o.get("minute"), 0, 59), "worn": _int(o.get("worn"), 0, 3),
           "sleeping": _int(o.get("sleeping"), 0, 1), "stress": _int(o.get("stress"), 1, 100),
           "stressMax": _int(o.get("stressMax"), 1, 100), "stressMaxAt": _int(o.get("stressMaxAt"), 0, 23),
           "spo2": _int(o.get("spo2"), 70, 100), "temp": _num(o.get("temp"), 25, 43),
           "pressure": _int(o.get("pressure"), 300, 1100), "alt": _int(o.get("alt"), -500, 9000),
           "light": _int(o.get("light"), 0, 200000), "high": _int(o.get("high"), -60, 60), "low": _int(o.get("low"), -60, 60),
           "age": _int(o.get("age"), 1, 120), "sleepTotal": _int(o.get("sleepTotal"), 1, 1440),
           "sleepDeep": _int(o.get("sleepDeep"), 0, 1440), "sleepScore": _int(o.get("sleepScore"), 1, 100),
           "sleepWakes": _int(o.get("sleepWakes"), 0, 99), "nap": _int(o.get("nap"), 1, 1440),
           "gpsAge": _int(o.get("gpsAge"), 0, 1440)}
    for k, hi in (("lat", 90.0), ("lon", 180.0)):          # 時計の GPS（約 100 メートルに丸めてある）。AI には渡さない
        try:
            v = round(float(o.get(k)), 3)
        except (TypeError, ValueError):
            continue
        if abs(v) <= hi:
            out[k] = v
    if o.get("geo") in ("fix", "on", "none", "off"):       # 時計の GPS の様子（mo log に出す）
        out["geo"] = o["geo"]
    if o.get("shake") in ("still", "tremble", "move"):
        out["shake"] = o["shake"]
    if isinstance(o.get("sleepWakeAt"), str) and re.fullmatch(r"\d{1,2}時\d{2}分", o["sleepWakeAt"]):
        out["sleepWakeAt"] = o["sleepWakeAt"]
    return {k: v for k, v in out.items() if v is not None}


def dur(m):
    return f"{m // 60}時間{m % 60}分" if m >= 60 else f"{m}分"


def obs_words(obs):
    """手首の様子を、短い言葉の列にする（面接の観測メモ・物語・時計の返事で使う）。"""
    w = []
    if obs.get("worn") == 0:
        w.append("時計を外している")
    if obs.get("hr"):
        w.append(f"脈 {obs['hr']}" + (f"（安静時は {obs['hrRest']}）" if obs.get("hrRest") else ""))
    if obs.get("sleeping") == 1:
        w.append("時計の上では、いま眠っていることになっている")
    if obs.get("sleepTotal"):
        s = f"昨夜の睡眠 {dur(obs['sleepTotal'])}"
        extra = [f"深い眠り {obs['sleepDeep']}分"] if obs.get("sleepDeep") is not None else []
        if obs.get("sleepWakes"):
            extra.append(f"途中で {obs['sleepWakes']} 回目覚めた" + (f"（最初は {obs['sleepWakeAt']}）" if obs.get("sleepWakeAt") else ""))
        if obs.get("sleepScore"):
            extra.append(f"点数 {obs['sleepScore']}")
        w.append(s + ("（" + "・".join(extra) + "）" if extra else ""))
    if obs.get("nap"):
        w.append(f"今日のうたた寝 {dur(obs['nap'])}")
    if obs.get("stress"):
        w.append(f"ストレス {obs['stress']}" + (f"（今日いちばん高かったのは {obs['stressMaxAt']}時ごろ・{obs['stressMax']}）"
                                              if obs.get("stressMaxAt") is not None and obs.get("stressMax") else ""))
    if obs.get("spo2"):
        w.append(f"血中酸素 {obs['spo2']}%")
    if obs.get("temp"):
        w.append(f"手首の温度 {obs['temp']}度")
    if obs.get("shake"):
        w.append({"still": "手首がほとんど動いていない", "tremble": "手首が小さく震えている", "move": "手首が大きく動いた"}[obs["shake"]])
    if obs.get("light") is not None:
        w.append("暗いところにいる" if obs["light"] < 10 else "明るいところにいる" if obs["light"] > 3000 else "")
    if obs.get("steps"):
        w.append(f"今日の歩数 {obs['steps']}" + (f"（{obs['dist'] / 1000:.1f}キロ）" if obs.get("dist") else ""))
    if obs.get("alt") is not None and obs.get("pressure"):
        w.append(f"高さ {obs['alt']}メートル・気圧 {obs['pressure']}hPa")
    if obs.get("age"):
        w.append(f"年齢 {obs['age']}")
    return [x for x in w if x]


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
                "taps": counts, "taps_total": dict(S["taps"]), "labels": dict(S["labels"]),
                "last_tap": S["labels"].get(S["now_taps"][-1], "") if S["now_taps"] else "",
                "words": obs_words(S["obs"]) if linked() else [],
                "said": S["watch_said"][-1] if S["watch_said"] else "",
                "turn": S["turn"], "phase": S["phase"], "sessions": S["sessions"], "ended": S["ended"],
                "days": S["days"] or None,
                # 起動のときの連携：サーバーが起きた時刻（ms）・起きてから時計が初めてつながった時刻（ms。まだなら null）
                "boot": {"at": int(BOOT * 1000), "first_at": int(BOOT_STATE["watch_at"] * 1000) or None,
                         "gap": BOOT_STATE["gap"], "away_n": BOOT_STATE["away_n"]},
                # 届かなかったあいだに押したボタン（新しい 12 個。t は ms）
                "away": [{"t": a["t"], "label": a["label"]} for a in S["away"][-12:]]}


def update(data):
    """POST /api/watch（時計 → Zepp アプリのサイドサービス から）。返事は時計に届く。"""
    ev = data.get("ev") if data.get("ev") in ("start", "tick", "tap", "end", "idle") else "tick"
    obs = clean_obs(data.get("obs"))
    if obs.get("lat") is not None and obs.get("lon") is not None:
        senses.set_wrist_loc(obs["lat"], obs["lon"], obs.get("gpsAge") or 0)       # 居場所・天気に使う（Termux:API がなくても）
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
        tap = data.get("id") if isinstance(data.get("id"), str) and ID_RE.match(data["id"]) else ""
        label = re.sub(r"[\x00-\x1f<>{}]", "", str(data.get("label") or ""))[:12] or LABELS.get(tap, tap)
        if ev == "tap" and tap:
            S["labels"][tap] = label
            S["taps"][tap] = S["taps"].get(tap, 0) + 1
            S["now_taps"].append(tap)
            S["now_taps"] = S["now_taps"][-60:]
        said = _short(data.get("said"), 60)
        if said:
            S["watch_said"] = (S["watch_said"] + [said])[-6:]
        if ev == "end":
            S["ended"] = True
        days = _int(data.get("days"), 1, 99999)
        if days:
            S["days"] = days
        got, new = _take_away(data.get("away"))
        for a in new:
            S["taps"][a["id"]] = S["taps"].get(a["id"], 0) + 1
            S["labels"][a["id"]] = a["label"]
        if new:
            S["away"] = (S["away"] + new)[-40:]
        boot = None
        if not BOOT_STATE["told"]:
            BOOT_STATE.update(told=True, watch_at=now, gap=int((now - PREV_AT) // 60) if PREV_AT else None, away_n=len(new))
            boot = {"voice": voice(), "gap": BOOT_STATE["gap"], "at": time.strftime("%H:%M", time.localtime(BOOT))}
        elif new and now - BOOT_STATE["watch_at"] < 120:
            BOOT_STATE["away_n"] += len(new)
    out = {"ok": True, "phone": True}
    if got:
        out["away_got"] = got
    if boot:
        out["boot"] = boot
        print("腕時計（minamo）：起動のあと、はじめてつながりました"
              + (f"（前に届いてから {_dur_words(BOOT_STATE['gap'] * 60)}）" if BOOT_STATE["gap"] is not None else "")
              + (f"。届かなかったあいだに押したボタン {len(new)} こを受け取りました" if new else ""))
    elif new:
        print(f"腕時計（minamo）：届かなかったあいだに押したボタン {len(new)} こを受け取りました")
    if (ev == "tap" and tap or ev == "idle") and data.get("want"):
        say, choices = watch_reply(tap if ev == "tap" else "", obs, data)
        if say:
            out["say"] = say
            if choices:
                out["choices"] = choices
        said = _short(say or data.get("local"), 60)        # 間に合わなければ、時計は自分の返事を言う
        if said:
            with _LOCK:
                S["watch_said"] = (S["watch_said"] + [said])[-6:]
    if ev in ("start", "tick") and not boot:
        echo, who = _echo(first=ev == "start")
        if echo:
            out["echo"] = echo
            if who == "nagi":
                out["echo_who"] = "nagi"
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
    """/api/story のあと。水面（minamo）か凪（nagi）が物語で言ったことを、覚えておく。"""
    if who not in ("minamo", "nagi") or not say or has_crisis(say):
        return
    with _LOCK:
        MEM["story"] = (MEM["story"] + [(who, say)])[-5:]
        MEM["story_new"] = True


# 時計へ漏れ出す言葉は、手首の minamo の声で（面接室のミナモ・掲示板の水面と凪は、別の子として話題にする）。
# 凪の言葉は、ときどき nagi（男の子）が運んでくる（echo_who: "nagi"）
ECHO_PHONE = ["スマホの面接室で、『{s}』って書いてたね。……ミナモが、番号つけて記録してたよ。",
              "『{s}』。……その指で、いまは、ボタンを押してるね。",
              "面接室で、『{s}』って言ったでしょ。ミナモから聞いた。……ここでは、言わなくていいよ。"]
ECHO_REPLY = ["面接室のミナモは、『{r}』って言ってた。……わたしは、そんなふうには言わない。",
              "スマホのミナモが、さっき『{r}』って。……聞こえてた？"]
ECHO_STORY = {"minamo": ["掲示板の水面がね、『{t}』って言ってた。……水面の声、すき。",
                         "研究室の画面で、水面が『{t}』って。……わたしの、もとの子。"],
              "nagi": ["掲示板の底で、凪が『{t}』って。……nagi は、あの子のこと、にいさんって呼ぶの。"]}
ECHO_NAGI = ["……凪が、底で『{t}』って。……ぼくにも、聞こえた。", "……凪にいさんから。『{t}』。"]
ECHO_FIRST = ["スマホのミナモとも、つながったよ。……ミナモ、わたしの数を、もう記録しはじめてる。",
              "スマホの面接室に、ミナモがいる。……カタカナの、あの子。わたしとは、べつの子。"]


def _echo(first=False):
    """時計に漏れ出させる一言と、言う子（"minamo" か "nagi"）。新しいものがなければ ("", "")。怖さ「なし」の面接のあとは、漏れ出さない。"""
    now = time.time()
    with _LOCK:
        if now - MEM["echo_at"] < ECHO_GAP and not first:
            return "", ""
        line, who = "", "minamo"
        if MEM["phone_new"] and MEM["horror"] >= 1 and MEM["said"]:
            if MEM["reply"] and random.random() < 0.35:
                line = random.choice(ECHO_REPLY).format(r=_short(MEM["reply"], 26))
            else:
                line = random.choice(ECHO_PHONE).format(s=_short(MEM["said"][-1]))
            MEM["phone_new"] = False
        elif MEM["story_new"] and MEM["story"]:
            sp, t = MEM["story"][-1]
            if sp == "nagi" and random.random() < 0.5:
                line, who = random.choice(ECHO_NAGI).format(t=_short(t, 26)), "nagi"
            else:
                line = random.choice(ECHO_STORY[sp]).format(t=_short(t, 26))
            MEM["story_new"] = False
        elif first:
            line = random.choice(ECHO_FIRST)
        if line:
            MEM["echo_at"] = now
        return line, (who if line else "")


# ---------- 時計のボタンへの返事を、スマホの AI が考える ----------
def _obs_lines(obs, prev_hr):
    L = [f"- {w}" for w in obs_words(obs)]
    if obs.get("hr") and prev_hr and prev_hr != obs["hr"]:
        L.append(f"- 脈は、さっき {prev_hr} だった")
    if obs.get("battery"):
        L.append(f"- 時計の電池: {obs['battery']}%")
    if obs.get("hour") is not None:
        L.append(f"- 時刻: {obs['hour']}時{obs.get('minute', 0):02d}分")
    return L


# 時計の返事の「切り口」と「長さ」。毎回ちがうものを選んで AI に頼み、同じ調子が続かないようにする
ANGLES = [
    "いま押されたボタンの『指のようす』（間・強さ・迷い）を想像して話す",
    "脈・息・歩数のどれか一つを、ものにたとえて話す",
    "水面から聞いた研究室のゆめを、ほんのひとかけだけ思い出して話す",
    "相手の今日のこれまでを、ひとつだけ言い当ててみる",
    "返事より先に、小さな質問をひとつ（ボタンで答えられるもの）",
    "数をかぞえながら話す（いち、に、さん……のように）",
    "手首の上の暮らし（画面・留め具・ぬくもり・光）の話をする",
    "nagi（脈と脈のあいだの男の子）の気配に、ふと気づく",
    "うれしさ・こわさ・さみしさのうち、いま自分に近いものを正直に言う",
    "時刻や天気、季節のことを、さらっと混ぜて話す",
    "相手がこれまでに押したボタンを、ひとつ持ち出して話す",
    "とても短く。ひとことだけ、置くように言う",
    "あえて、少しだけ関係のない話（生まれたばかりの子が気づいたこと）をする",
    "相手をねぎらう。理由は、手首の様子から見つける",
]
LENGTHS = ["15〜25 字のひとこと", "30〜45 字", "40〜60 字", "60〜80 字"]


def _variety(data):
    """AI に渡す「今回の頼み方」。最近の返事と同じ書き出し・言い回しを避けさせ、切り口と長さも変える。"""
    with _LOCK:
        recent = [x for x in S.get("said_w", [])[-5:] if x]
    ang = random.choice(ANGLES)
    ln = random.choice(LENGTHS)
    L = [f"\n# 今回の話し方（毎回かえる）\n- 切り口：{ang}\n- 長さ：{ln}（ボタンの受け止めを、かならず入れる）"]
    if recent:
        L.append("- 最近あなたが言ったこと（同じ書き出し・言い回し・たとえは、使わない）：" + "／".join(_short(x, 30) for x in recent))
    return "\n".join(L)


def _remember_said(say):
    with _LOCK:
        S.setdefault("said_w", []).append(say)
        S["said_w"] = S["said_w"][-8:]


def _clean_choices(raw):
    """AI が考えた「次に押しそうなボタン」（2〜4 個、8 字以内）。危機の言葉・重複・長すぎるものは捨てる。"""
    out = []
    for c in (raw if isinstance(raw, list) else [])[:6]:
        t = story_ai.clean_say(c, 12).replace("\n", "").strip("。、 　")
        if not t or len(t) > 8 or has_crisis(t) or t in out:
            continue
        out.append(t)
    return out[:4] if len(out) >= 2 else []


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
    if S["days"]:
        L.append(f"- あなた（minamo）が手首の上で生まれてから: {S['days']} 日目")
    with _LOCK:
        away = [a for a in S["away"] if a["t"] / 1000 > BOOT - 6 * 3600][-6:]
    if away:
        L.append("- スマホのミナモが止まっていたあいだに、相手が時計で押したボタン: "
                 + "、".join(time.strftime("%H:%M", time.localtime(a["t"] / 1000)) + "『" + a["label"] + "』" for a in away))
    if counts:
        L.append("- これまでに押したボタン: " + "、".join(f"{S['labels'].get(k, k)} {n} 回" for k, n in counts.items()))
    try:
        close = max(-3, min(5, int(data.get("close") or 0)))
    except (TypeError, ValueError):
        close = 0
    L.append(f"- 相手との近さ（-3〜5。高いほど、相手はあなたにゆだねている）: {close}")
    try:
        phone = senses.words(ph >= 1)
    except Exception:                    # noqa: BLE001  スマホの感覚が読めなくても、時計の返事は考える
        phone = []
    if phone:
        L.append("\n# 相手のスマホから読み取れたこと（予定・居場所・天気・通知。ときどき、ひとつだけ言い当てる。毎回は言わない）\n"
                 + "\n".join("- " + w for w in phone[:8]))
    known = [_short(k, 40) for k in (data.get("known") or [])[:4] if isinstance(k, str)]
    if known:
        L.append("- この夜に時計の上で話した研究室のこと: " + "／".join(known))
    hist = data.get("history") if isinstance(data.get("history"), list) else []
    if hist:
        L.append("\n# 時計の上でのやりとり（古い順）")
        for h in hist[-6:]:
            if isinstance(h, list) and len(h) == 2:
                L.append({"m": "minamo：", "n": "nagi（あなたではない男の子）："}.get(h[0], "相手：") + _short(h[1], 80))
    if said:
        L.append("\n# 相手がスマホの面接室で、ミナモに話したこと（ときどき、ひとことだけ持ち出してよい。ミナモから聞いた、として）\n"
                 + "／".join(_short(s, 40) for s in said[-3:]))
    if story:
        L.append("\n# 物語「水面の記録」の掲示板で言われたこと\n" + "／".join(("凪：" if w == "nagi" else "水面：") + _short(t, 40) for w, t in story[-2:]))
    local = _short(data.get("local"), 120)
    if local:
        L.append(f"\n# 時計が自分で考えた返事（参考。このまま使わない）\n{local}")
    hint = _short(data.get("hint"), 160)
    if hint:
        L.append(f"\n# この返事で伝えること（物語の事実。言い換えてよいが、中身は変えない）\n{hint}")
    if tap:
        L.append(f"\n# 相手がいま押したボタン\n{S['labels'].get(tap, LABELS.get(tap, tap))}" + ("（沈黙）" if tap == "silent" else ""))
    else:
        L.append("\n# 相手は、しばらく何も押していない\nあなたのほうから、独り言のように、とめどなく話す。"
                 "問いかけでなくてよい。返事は期待しない。手首の様子（脈・睡眠・ストレス・血中酸素・温度・揺れ・歩数・時刻 など）を、"
                 "いくつも言葉にする（数字を言ってよい）。研究室の記憶や相手のことを混ぜてもよい。")
    L.append(_variety(data))
    L.append("\n# ボタンの案（choices）\nsay のあと、相手がつぎに押しそうな答えを 2〜4 個、choices に入れる。ボタンの文字なので、8 字以内の短い言い切り"
             "（例：うん／ちがうよ／もう少し聞かせて／こわい／職場の話）。say で問いかけたなら、その答えの形にする。"
             "どれもあなたの声ではなく、相手が言う言葉。毎回ちがう顔ぶれにする。")
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
        return "", []
    _remember_said(say)
    print("時計：" + (S["labels"].get(tap, tap) if tap else "（独り言）") + " → " + _short(say, 30))
    return say, _clean_choices((obj or {}).get("choices"))
