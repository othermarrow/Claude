"""スマホの感覚：予定（カレンダー）・居場所（Wi-Fi と位置）・外の天気・通知を読み、短い言葉にする。

ミナモは Chrome の PWA と Termux のサーバーでできているので、Android のカレンダーの権限は取れない。
代わりに、次のものを使う（どれも、なければ何もしない）。

  予定     ~/.config/minamo/calendar_url に置いた Google カレンダーの「iCal 形式の非公開アドレス」（1 行に 1 つ）。
           15 分おきに読み、きのう〜あさっての予定（繰り返しの予定もふくむ）を覚える。アドレスは GitHub に上げない。
  居場所   termux-wifi-connectioninfo の Wi-Fi の名前を、~/.config/minamo/places.json の「家」「職場」と照らす
           （`mo place home` / `mo place work` で、いまの Wi-Fi を登録する）。Wi-Fi の名前そのものは AI に渡さない。
           termux-location（ネットワークの位置）で、家からの距離。家の位置は、家の Wi-Fi にいるときに覚える。
  天気     いまの位置（小数 2 桁に丸める）で Open-Meteo（キー不要）に聞く。30 分おき。
  通知     termux-notification-list（Termux:API に「通知へのアクセス」が要る）。件数・アプリ・新しいものの題と中身。

読んだものは、面接の観測メモ（/api/senses → app.js）・物語の登場人物（story.js → story_ai）・腕時計の返事（wrist.py）に
混ぜる。クラウドの AI にも渡る（利用者の許可で。予定の題名・通知の中身もふくむ）。危機の言葉を含むものは渡さない。
読むのは裏の糸で 3 分おき。画面からの問い合わせには、覚えているものをすぐ返す。
"""

import datetime as dt
import json
import math
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.request

CONF = os.path.expanduser("~/.config/minamo")
CAL_FILE = os.path.join(CONF, "calendar_url")
PLACES_FILE = os.path.join(CONF, "places.json")
TICK = 180              # 読み直す間隔（秒）
CAL_EVERY = 900         # カレンダーを取り直す間隔
WEATHER_EVERY = 1800    # 天気を聞き直す間隔

_LOCK = threading.Lock()
D = {"events": [], "cal_at": 0.0, "cal_err": "", "cal_n": 0,
     "place": "", "ssid_ok": None, "dist": None, "loc": None, "loc_at": 0.0,
     "cal_total": 0, "cal_names": [], "weather": None, "weather_at": 0.0,
     "notes": [], "notes_ok": None, "at": 0.0}
_STARTED = {"on": False}

WEEK = "月火水木金土日"
APP_NAMES = {
    "jp.naver.line.android": "LINE", "com.google.android.gm": "Gmail", "com.google.android.calendar": "カレンダー",
    "com.twitter.android": "X", "com.discord": "Discord", "com.Slack": "Slack", "com.slack": "Slack",
    "com.google.android.apps.messaging": "メッセージ", "com.android.chrome": "Chrome", "com.google.android.youtube": "YouTube",
    "com.instagram.android": "Instagram", "com.facebook.orca": "Messenger", "com.huami.watch.hmwatchmanager": "Zepp",
    "com.zepp.app": "Zepp", "com.google.android.apps.photos": "フォト", "com.amazon.mShop.android.shopping": "Amazon",
    "com.google.android.keep": "Keep", "md.obsidian": "Obsidian", "com.google.android.dialer": "電話",
    "com.android.vending": "Play ストア", "com.whatsapp": "WhatsApp", "org.telegram.messenger": "Telegram",
    "com.google.android.apps.maps": "マップ", "com.microsoft.teams": "Teams", "us.zoom.videomeetings": "Zoom",
    "com.arlosoft.macrodroid": "MacroDroid", "com.google.android.googlequicksearchbox": "Google",
}
SKIP_PKG = ("com.termux", "android", "com.android.systemui", "com.sonymobile", "com.android.providers")
WEATHER_WORDS = {0: "快晴", 1: "晴れ", 2: "晴れときどき曇り", 3: "曇り", 45: "霧", 48: "霧", 51: "霧雨", 53: "霧雨", 55: "霧雨",
                 56: "冷たい霧雨", 57: "冷たい霧雨", 61: "小雨", 63: "雨", 65: "強い雨", 66: "冷たい雨", 67: "冷たい雨",
                 71: "小雪", 73: "雪", 75: "大雪", 77: "雪", 80: "にわか雨", 81: "にわか雨", 82: "激しいにわか雨",
                 85: "にわか雪", 86: "にわか雪", 95: "雷雨", 96: "雷雨", 99: "雷雨"}


def _has_crisis(text):
    try:
        import minamo
        return any(w in (text or "") for w in minamo.CRISIS_WORDS)
    except Exception:            # noqa: BLE001  minamo が読めなくても、感覚は動かす
        return False


def _run(args, timeout=8):
    if not shutil.which(args[0]):
        return None
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=timeout).stdout
    except (OSError, subprocess.SubprocessError):
        return None


def _json(text):
    try:
        return json.loads(text) if text else None
    except ValueError:
        return None


def _short(t, n):
    t = re.sub(r"\s+", " ", str(t or "")).strip()
    return t if len(t) <= n else t[:n - 1] + "…"


# ---------- 予定（iCal） ----------
def _unfold(text):
    return re.sub(r"\r?\n[ \t]", "", text).splitlines()


def _unescape(v):
    return v.replace("\\n", " ").replace("\\N", " ").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")


def _tz(name):
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(name)
    except Exception:            # noqa: BLE001  tzdata がない端末でも、そのまま地元の時刻として読む
        return None


def _when(params, value):
    """DTSTART などの値を、地元の時刻（tz なし）にする。(datetime, 終日か)"""
    value = value.strip()
    if "VALUE=DATE" in params or re.fullmatch(r"\d{8}", value):
        return dt.datetime.strptime(value[:8], "%Y%m%d"), True
    m = re.fullmatch(r"(\d{8}T\d{6})(Z?)", value)
    if not m:
        return None, False
    t = dt.datetime.strptime(m.group(1), "%Y%m%dT%H%M%S")
    if m.group(2) == "Z":
        return t.replace(tzinfo=dt.timezone.utc).astimezone().replace(tzinfo=None), False
    tzm = re.search(r"TZID=([^;:]+)", params)
    tz = _tz(tzm.group(1).strip('"')) if tzm else None
    if tz:
        return t.replace(tzinfo=tz).astimezone().replace(tzinfo=None), False
    return t, False


def _rrule(rule):
    out = {}
    for part in rule.split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.upper()] = v
    return out


BYDAY = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}


def _occurrences(start, rule, exdates, lo, hi):
    """繰り返しの予定を、lo〜hi のあいだだけ広げる（DAILY・WEEKLY（BYDAY）・MONTHLY・YEARLY と INTERVAL・COUNT・UNTIL）。"""
    r = _rrule(rule)
    freq, step = r.get("FREQ", ""), max(1, int(r.get("INTERVAL", "1") or 1))
    count = int(r["COUNT"]) if r.get("COUNT", "").isdigit() else None
    until = _when("", r["UNTIL"])[0] if r.get("UNTIL") else None
    days = [BYDAY[d[-2:]] for d in r.get("BYDAY", "").split(",") if d[-2:] in BYDAY] if freq == "WEEKLY" else []
    out, n, i = [], 0, 0

    def take(t):
        nonlocal n
        if until and t > until + dt.timedelta(days=1 if until.time() == dt.time(0) else 0):
            return False
        n += 1
        if count and n > count:
            return False
        if lo <= t <= hi and t not in exdates:
            out.append(t)
        return t <= hi

    while i < 4000:
        if freq == "DAILY":
            t = start + dt.timedelta(days=i * step)
            if not take(t):
                break
        elif freq == "WEEKLY":
            week0 = start - dt.timedelta(days=start.weekday()) + dt.timedelta(weeks=i * step)
            stop = False
            for d in sorted(days or [start.weekday()]):
                t = week0 + dt.timedelta(days=d)
                if t < start:
                    continue
                if not take(t):
                    stop = True
                    break
            if stop:
                break
        elif freq in ("MONTHLY", "YEARLY"):
            months = i * step * (12 if freq == "YEARLY" else 1)
            y, mo = divmod(start.month - 1 + months, 12)
            try:
                t = start.replace(year=start.year + y, month=mo + 1)
            except ValueError:              # 31 日がない月などは、とばす
                i += 1
                continue
            if not take(t):
                break
        else:
            if lo <= start <= hi:
                out.append(start)
            break
        i += 1
    return out


def parse_ics(text, now=None, before_h=24, after_h=48):
    """iCal の文字列から、now の前 before_h 時間〜後 after_h 時間の予定を [{start, end, allday, title}] で返す。"""
    now = now or dt.datetime.now()
    lo, hi = now - dt.timedelta(hours=before_h), now + dt.timedelta(hours=after_h)
    events, cur, overrides = [], None, set()
    for line in _unfold(text):
        if line == "BEGIN:VEVENT":
            cur = {"ex": set()}
            continue
        if line == "END:VEVENT":
            if cur is not None:
                events.append(cur)
            cur = None
            continue
        if cur is None or ":" not in line:
            continue
        head, value = line.split(":", 1)
        name, _, params = head.partition(";")
        name = name.upper()
        if name in ("DTSTART", "DTEND"):
            cur[name], allday = _when(params, value)
            if name == "DTSTART":
                cur["allday"] = allday
        elif name == "SUMMARY":
            cur["title"] = _unescape(value)
        elif name == "RRULE":
            cur["rrule"] = value
        elif name == "EXDATE":
            for v in value.split(","):
                t = _when(params, v)[0]
                if t:
                    cur["ex"].add(t)
        elif name == "RECURRENCE-ID":
            cur["rid"] = _when(params, value)[0]
        elif name == "UID":
            cur["uid"] = value
        elif name == "STATUS":
            cur["status"] = value.upper()
    for e in events:
        if e.get("rid") and e.get("uid"):
            overrides.add((e["uid"], e["rid"]))
    out = []
    for e in events:
        s = e.get("DTSTART")
        if not s or e.get("status") == "CANCELLED":
            continue
        length = (e["DTEND"] - s) if e.get("DTEND") and e["DTEND"] > s else dt.timedelta(days=1 if e.get("allday") else 0)
        starts = _occurrences(s, e["rrule"], e["ex"], lo - length, hi) if e.get("rrule") and not e.get("rid") else (
            [s] if lo - length <= s <= hi else [])
        for t in starts:
            if e.get("rrule") and (e.get("uid"), t) in overrides:
                continue                    # 一回だけ変えた予定は、変えたほうを使う
            if t + length < lo:
                continue
            out.append({"start": t, "end": t + length, "allday": bool(e.get("allday")),
                        "title": _short(e.get("title") or "（題名なし）", 30)})
    out.sort(key=lambda x: (x["start"], x["title"]))
    return out


def _cal_urls():
    try:
        with open(CAL_FILE, encoding="utf-8") as f:
            return [u.strip() for u in f if u.strip().startswith(("http://", "https://", "webcal://"))]
    except OSError:
        return []


def _read_calendar():
    urls = _cal_urls()
    if not urls:
        return
    events, err, total, names = [], "", 0, []
    for u in urls:
        try:
            req = urllib.request.Request(u.replace("webcal://", "https://", 1), headers={"User-Agent": "minamo-calendar"})
            with urllib.request.urlopen(req, timeout=15) as res:
                text = res.read().decode("utf-8", "replace")
            events += parse_ics(text)
            total += text.count("BEGIN:VEVENT")                  # 取り込んだ予定の総数（どのカレンダーのアドレスかを見分ける手がかり）
            m = re.search(r"(?m)^X-WR-CALNAME:(.+)$", text)
            names.append((m.group(1).strip() if m else "（名前なし）")[:30])
        except (OSError, ValueError) as e:
            err = str(e)[:80]
    events.sort(key=lambda x: (x["start"], x["title"]))
    with _LOCK:
        D.update(events=events, cal_at=time.time(), cal_err=err if not events else "", cal_n=len(urls),
                 cal_total=total, cal_names=names)


# ---------- 居場所・天気 ----------
def load_places():
    try:
        with open(PLACES_FILE, encoding="utf-8") as f:
            p = json.load(f)
            return p if isinstance(p, dict) else {}
    except (OSError, ValueError):
        return {}


def save_places(p):
    os.makedirs(CONF, exist_ok=True)
    tmp = PLACES_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(p, f, ensure_ascii=False)
    os.replace(tmp, PLACES_FILE)


def current_ssid():
    """いまの Wi-Fi の名前（読めなければ ""、Wi-Fi でなければ None）。"""
    w = _json(_run(["termux-wifi-connectioninfo"], timeout=8))
    if not isinstance(w, dict):
        return ""
    ssid = str(w.get("ssid") or "").strip('"')
    if w.get("supplicant_state") not in (None, "COMPLETED") and not ssid:
        return None
    if not ssid or ssid == "<unknown ssid>":
        return "" if w.get("supplicant_state") == "COMPLETED" else None
    return ssid


def _location():
    for args in (["termux-location", "-p", "network", "-r", "last"], ["termux-location", "-p", "network", "-r", "once"]):
        loc = _json(_run(args, timeout=20))
        if isinstance(loc, dict) and loc.get("latitude") is not None:
            return float(loc["latitude"]), float(loc["longitude"])
    return None


# 時計の GPS（minamo-watch が送ってくる。Termux:API がなくても、居場所と天気が読める）
LOC_FILE = os.path.join(CONF, "last_loc.json")
WRIST_LOC_MAX = 12 * 3600       # これより古い位置は使わない（秒。時計は 6 時間おきに測る）
NEAR_KM = 0.4                   # 家・職場の位置から、これより近ければ、そこにいることにする


def set_wrist_loc(lat, lon, age_min=0):
    at = time.time() - max(0, age_min) * 60
    with _LOCK:
        D["wloc"] = (lat, lon, at)
    try:
        os.makedirs(CONF, exist_ok=True)
        with open(LOC_FILE, "w", encoding="utf-8") as f:
            json.dump({"lat": lat, "lon": lon, "at": at}, f)
    except OSError:
        pass


def wrist_loc():
    """時計の最後の位置 (lat, lon)。古い・なければ None。サーバーを起こし直したあとは、ファイルから。"""
    with _LOCK:
        w = D.get("wloc")
    if not w:
        try:
            with open(LOC_FILE, encoding="utf-8") as f:
                j = json.load(f)
            w = (float(j["lat"]), float(j["lon"]), float(j["at"]))
        except (OSError, ValueError, KeyError, TypeError):
            return None
    return (w[0], w[1]) if time.time() - w[2] <= WRIST_LOC_MAX else None


def _km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def _read_place():
    places = load_places()
    ssid = current_ssid()
    place, ok = "", None
    if ssid is None:
        place = "外（Wi-Fi なし）"
    elif ssid == "":
        ok = False
    else:
        ok = True
        if ssid in places.get("home", []):
            place = "家"
        elif ssid in places.get("work", []):
            place = "職場"
        else:
            place = "知らない Wi-Fi のある場所"
    loc, dist = None, None
    if shutil.which("termux-location") and time.time() - D["loc_at"] > 600:
        loc = _location()
        if loc and place == "家":
            places["home_loc"] = [round(loc[0], 4), round(loc[1], 4)]
            try:
                save_places(places)
            except OSError:
                pass
    if loc is None:
        loc = wrist_loc()                  # Termux:API がなければ、時計の GPS
    if loc and places.get("home_loc"):
        dist = round(_km(loc, places["home_loc"]), 1)
    if place == "" and loc:                # Wi-Fi の名前が読めないときは、位置で、家・職場にいるかを見る
        place = "外"
        for key, name in (("home_loc", "家"), ("work_loc", "職場")):
            if places.get(key) and _km(loc, places[key]) <= NEAR_KM:
                place = name
                break
    with _LOCK:
        D.update(place=place, ssid_ok=ok)
        if loc:
            D.update(loc=loc, loc_at=time.time(), dist=dist)


def _read_weather():
    loc = D.get("loc")
    if not loc or time.time() - D["weather_at"] < WEATHER_EVERY:
        return
    url = ("https://api.open-meteo.com/v1/forecast?latitude=%.2f&longitude=%.2f"
           "&current=temperature_2m,relative_humidity_2m,weather_code,precipitation,wind_speed_10m"
           "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1&timezone=auto") % loc
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "minamo-weather"}), timeout=10) as res:
            w = json.load(res)
    except (OSError, ValueError):
        return
    cur, day = w.get("current") or {}, w.get("daily") or {}
    first = lambda k: (day.get(k) or [None])[0]   # noqa: E731
    with _LOCK:
        D.update(weather={"sky": WEATHER_WORDS.get(cur.get("weather_code"), ""), "temp": cur.get("temperature_2m"),
                          "hum": cur.get("relative_humidity_2m"), "wind": cur.get("wind_speed_10m"),
                          "rain": cur.get("precipitation"), "max": first("temperature_2m_max"),
                          "min": first("temperature_2m_min"), "pop": first("precipitation_probability_max")},
                 weather_at=time.time())


# ---------- 通知 ----------
def _app(pkg):
    return APP_NAMES.get(pkg) or (pkg.split(".")[-1] if pkg else "")


def _read_notes():
    out = _run(["termux-notification-list"], timeout=10)
    if out is None:
        return
    items = _json(out)
    if not isinstance(items, list):
        with _LOCK:
            D.update(notes=[], notes_ok=False)
        return
    notes = []
    for n in items:
        pkg = str(n.get("packageName") or "")
        if not pkg or pkg.startswith(SKIP_PKG):
            continue
        title, text = _short(n.get("title"), 24), _short(n.get("content"), 40)
        if _has_crisis(title + text):
            title, text = "", ""
        notes.append({"app": _app(pkg), "title": title, "text": text, "when": n.get("when") or ""})
    with _LOCK:
        D.update(notes=notes[:30], notes_ok=True)


# ---------- 裏の糸 ----------
def refresh():
    now = time.time()
    if now - D["cal_at"] > CAL_EVERY:
        _read_calendar()
    _read_place()
    _read_weather()
    _read_notes()
    D["at"] = time.time()


def start():
    """server.py が起動のときに呼ぶ。3 分おきに読み直す。"""
    if _STARTED["on"]:
        return
    _STARTED["on"] = True

    def loop():
        while True:
            try:
                refresh()
            except Exception as e:      # noqa: BLE001  感覚が読めなくても、サーバーは止めない
                print(f"スマホの感覚：読めませんでした（{str(e)[:80]}）")
            time.sleep(TICK)
    threading.Thread(target=loop, daemon=True).start()


# ---------- 言葉にする ----------
def _hm(t):
    return f"{t.hour}:{t.minute:02d}"


def _day(t, now):
    d = (t.date() - now.date()).days
    return {-1: "きのう", 0: "きょう", 1: "あした", 2: "あさって"}.get(d, f"{t.month}/{t.day}（{WEEK[t.weekday()]}）")


def _ago(sec):
    m = int(sec // 60)
    return f"{m}分" if m < 60 else f"{m // 60}時間{m % 60}分" if m % 60 else f"{m // 60}時間"


def words(full=True, now=None):
    """観測メモ・登場人物・時計に渡す、短い言葉の列。full=False なら、居場所と次の予定の時刻だけ（題名なし）。"""
    now = now or dt.datetime.now()
    with _LOCK:
        ev, place, dist, w, notes = list(D["events"]), D["place"], D["dist"], D["weather"], list(D["notes"])
    out = []
    if place:
        out.append("いる場所: " + place + (f"（家から約{dist}km）" if dist is not None and place != "家" and dist >= 0.3 else ""))
    upcoming = [e for e in ev if e["end"] > now or (e["allday"] and e["start"].date() == now.date())]
    nxt = next((e for e in upcoming if e["start"] > now and not e["allday"]), None)
    if nxt:
        left = nxt["start"] - now
        out.append(f"次の予定: {_day(nxt['start'], now)} {_hm(nxt['start'])}" + (f"「{nxt['title']}」" if full else "")
                   + (f"（あと{_ago(left.total_seconds())}）" if left < dt.timedelta(hours=12) else ""))
    if full:
        now_e = [e for e in ev if e["start"] <= now < e["end"] and not e["allday"]]
        if now_e:
            out.append("いまの予定: " + "・".join(f"「{e['title']}」（{_hm(e['end'])}まで）" for e in now_e[:2]))
        today = [e for e in ev if e["start"].date() == now.date()]
        if today:
            out.append(f"きょうの予定 {len(today)}件: " + "、".join(
                ("終日" if e["allday"] else _hm(e["start"])) + f"「{e['title']}」" for e in today[:6]))
        tom = [e for e in ev if e["start"].date() == now.date() + dt.timedelta(days=1)]
        if tom:
            first = next((e for e in tom if not e["allday"]), tom[0])
            out.append(f"あしたの予定 {len(tom)}件（最初は " + ("終日" if first["allday"] else _hm(first["start"])) + f"「{first['title']}」）")
        past = [e for e in ev if e["end"] <= now and e["start"].date() == now.date() and not e["allday"]]
        if past:
            out.append(f"さっき終わった予定: 「{past[-1]['title']}」（{_hm(past[-1]['end'])}に終わった）")
    elif ev:
        out.append(f"きょうの予定: {len([e for e in ev if e['start'].date() == now.date()])}件")
    if w and full:
        parts = [w.get("sky") or "", f"{w['temp']}度" if w.get("temp") is not None else "",
                 f"湿度{w['hum']}%" if w.get("hum") is not None else "",
                 f"きょうは{w['min']}〜{w['max']}度" if w.get("max") is not None else "",
                 f"雨の確率{w['pop']}%" if w.get("pop") else ""]
        out.append("外の天気: " + "・".join(p for p in parts if p))
    if notes and full:
        apps = {}
        for n in notes:
            apps[n["app"]] = apps.get(n["app"], 0) + 1
        out.append(f"スマホの通知 {len(notes)}件（" + "・".join(f"{a} {k}" for a, k in sorted(apps.items(), key=lambda x: -x[1])[:4]) + "）")
        for n in notes[:3]:
            if n["title"] or n["text"]:
                out.append(f"通知（{n['app']}）: " + "「" + "」「".join(x for x in (n["title"], n["text"]) if x) + "」")
    return [x for x in out if x and not _has_crisis(x)]


def snapshot():
    """GET /api/senses。"""
    with _LOCK:
        st = {"calendar": bool(_cal_urls()), "cal_events": len(D["events"]), "cal_err": D["cal_err"],
              "cal_read": bool(D["cal_at"]), "cal_total": D["cal_total"], "cal_names": list(D["cal_names"]),
              "place": D["place"], "ssid_ok": D["ssid_ok"], "loc": bool(D["loc"]), "weather": bool(D["weather"]),
              "notes_ok": D["notes_ok"], "at": int(D["at"] * 1000) or None}
    return {"words": words(True), "brief": words(False), "status": st}


def status_lines(s=None):
    """起動の表示と mo の表示に出す行（何が読めて、何が読めないか。足りない設定）。s は /api/senses の status（なければ、この中のもの）。"""
    s = s or snapshot()["status"]
    L = []
    if not s["calendar"]:
        L.append("予定：まだ読んでいません（~/.config/minamo/calendar_url に、Google カレンダーの iCal 形式の非公開アドレスを置く）")
    elif s["cal_err"]:
        L.append(f"予定：読めませんでした（{s['cal_err']}）")
    elif not s.get("cal_read"):
        L.append("予定：読み込み中です（起動して 10 秒ほどで読み終わります。もう一度 mo log）")
    else:
        names = "・".join(f"「{n}」" for n in s.get("cal_names", []))
        L.append(f"予定：きのう〜あさってに {s['cal_events']} 件（取り込んだカレンダー {names}、予定は全部で {s.get('cal_total', 0)} 件）")
        if not s["cal_events"] and s.get("cal_total"):
            L.append("　　期間内に予定がない？ 予定の入っているカレンダーのアドレスか確かめてください（Google カレンダーは、カレンダーごとにアドレスが違います）")
        elif not s["cal_events"]:
            L.append("　　予定が 0 件で届いています。アドレスが、予定の入っていないカレンダーのものか、間違っているかもしれません")
    if not shutil.which("termux-wifi-connectioninfo") and not wrist_loc():
        L.append("居場所：読めません（Termux:API を入れるか、腕時計の minamo を外で開いて、時計の GPS で位置を送る）")
    elif not shutil.which("termux-wifi-connectioninfo"):
        places = load_places()
        reg = "・".join(name for k, name in (("home_loc", "家"), ("work_loc", "職場")) if places.get(k)) or "なし"
        L.append(f"居場所：{s['place'] or 'まだ'}（時計の GPS。登録した場所：{reg}。いまの場所を登録するなら mo place home／mo place work）")
    elif s["ssid_ok"] is False:
        L.append("居場所：Wi-Fi の名前が読めません（Android の設定 → アプリ → Termux:API → 位置情報を「許可」）")
    else:
        places = load_places()
        reg = "・".join(name for k, name in (("home", "家"), ("work", "職場")) if places.get(k)) or "なし"
        L.append(f"居場所：{s['place'] or 'まだ'}（登録した Wi-Fi：{reg}。"
                 "いまの Wi-Fi を登録するなら mo place home／mo place work）")
    L.append("天気：" + ("読めています" if s["weather"] else "位置がわかると、読みます" if not s["loc"] else "まだ"))
    if s["notes_ok"] is False:
        L.append("通知：読めません（Android の設定 → 通知 → デバイスとアプリの通知（通知へのアクセス）→ Termux:API をオン）")
    elif s["notes_ok"]:
        L.append("通知：読めています")
    return L
