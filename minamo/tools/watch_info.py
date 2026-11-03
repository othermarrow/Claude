"""動いているミナモのサーバーに、腕時計（minamo-watch の minamo）の様子を聞いて表示する（open.sh が使う）。
  python3 tools/watch_info.py [ポート]
前に手首から届いたのはいつか・いまつながっているか・サーバーが起きてから時計がつながったか・
届かなかったあいだに押したボタンを、短く出す。"""
import json
import sys
import time
import urllib.request

port = sys.argv[1] if len(sys.argv) > 1 else "9090"
try:
    req = urllib.request.Request(f"http://localhost:{port}/api/watch", headers={"X-Minamo": "1"})
    with urllib.request.urlopen(req, timeout=4) as res:
        w = json.load(res)
except (OSError, ValueError) as e:
    print(f"  腕時計（minamo）：サーバーに聞けませんでした（{e}）")
    sys.exit(0)


def dur(sec):
    m = int(sec // 60)
    if m < 1:
        return "1分たらず"
    if m < 60:
        return f"{m}分"
    if m < 1440:
        return f"{m // 60}時間{m % 60}分" if m % 60 else f"{m // 60}時間"
    return f"{m // 1440}日"


o = w.get("obs") or {}
since = w.get("since")
vals = "・".join(v for v in (f"脈 {o['hr']}" if o.get("hr") else "", f"電池 {o['battery']}%" if o.get("battery") else "",
                              "外している" if o.get("worn") == 0 else "") if v)
if since is None:
    print("  腕時計（minamo）：まだ一度も届いていません。時計で minamo を開くと、Zepp アプリを通してつながります。")
elif w.get("linked"):
    print(f"  腕時計（minamo）：つながっています（{dur(since)}前に届いた" + (f"・{vals}" if vals else "") + "）")
else:
    print(f"  腕時計（minamo）：前に届いたのは {dur(since)}前" + (f"（{vals}）" if vals else "") + "。"
          "時計で minamo を開くか、次の予約（独り言・毎時 59 分）で時計が起きたときに、つながります。")
GEO = {"fix": "位置が取れています", "on": "いま測っています（外で、空が見える場所で、数分かかります）",
       "none": "取れませんでした（屋内では取れません。外で時計の minamo を開いてください）",
       "off": "使えません（時計の許可「位置情報」がない？ 時計に minamo を入れ直して、許可してください）"}
if o.get("geo") in GEO:
    age = f"（{o['gpsAge']}分前に測った位置）" if o.get("lat") is not None and o.get("gpsAge") is not None else ""
    print(f"  腕時計の GPS：{GEO[o['geo']]}{age}")
elif since is not None:
    print("  腕時計の GPS：まだ届いていません（時計の minamo が 1.6.3 より古い？ 入れ直してください）")
b = w.get("boot") or {}
if b.get("first_at"):
    t = time.strftime("%H:%M", time.localtime(b["first_at"] / 1000))
    extra = f"。届かなかったあいだに押したボタン {b['away_n']} こを受け取りました" if b.get("away_n") else ""
    print(f"  サーバーが起きてから、{t} に時計とつながりました（minamo に起動を伝えました{extra}）")
elif since is not None:
    print("  サーバーが起きたことは、時計が次につながったときに、minamo が知らせます。")
if w.get("days"):
    print(f"  minamo は、手首の上で生まれて {w['days']} 日目です。")
