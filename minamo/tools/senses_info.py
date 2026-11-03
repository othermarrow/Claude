"""スマホの感覚（予定・居場所・天気・通知）が読めているかを出す。いまの Wi-Fi を家・職場として登録する（open.sh が使う）。
  python3 tools/senses_info.py [ポート]          # 動いているサーバーに聞いて、読めているものと足りない設定を出す
  python3 tools/senses_info.py --place home      # いまの Wi-Fi を「家」にする（work なら「職場」）
"""
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import senses  # noqa: E402

if len(sys.argv) > 2 and sys.argv[1] == "--place":
    kind = sys.argv[2]
    if kind not in ("home", "work"):
        print("mo place home か mo place work で使います。")
        sys.exit(1)
    ssid = senses.current_ssid()
    w = senses.wrist_loc()
    if not ssid and w:                     # Wi-Fi の名前が読めない（Termux:API がない）：時計の GPS の位置を、家・職場にする
        p = senses.load_places()
        p[kind + "_loc"] = [w[0], w[1]]
        senses.save_places(p)
        print(f"腕時計の GPS の位置（約 100 メートルに丸めたもの）を、「{'家' if kind == 'home' else '職場'}」に登録しました。")
        print("近く（400 メートル以内）にいると、そこにいることになります。位置は端末の中だけ。AI には渡しません。")
        sys.exit(0)
    if ssid is None:
        print("いまは Wi-Fi につながっていません。登録したい場所の Wi-Fi につないでから、もう一度。")
        sys.exit(1)
    if not ssid:
        print("Wi-Fi の名前が読めません。Termux:API を入れて、位置情報を「許可」にするか、腕時計の minamo を外で開いて（時計の GPS で位置が届くと）、もう一度。")
        sys.exit(1)
    p = senses.load_places()
    p[kind] = sorted(set(p.get(kind, [])) | {ssid})
    other = "work" if kind == "home" else "home"
    p[other] = [x for x in p.get(other, []) if x != ssid]
    if w:
        p[kind + "_loc"] = [w[0], w[1]]
    senses.save_places(p)
    print(f"いまの Wi-Fi を「{'家' if kind == 'home' else '職場'}」に登録しました（名前は端末の中だけ。AI には渡しません）。")
    sys.exit(0)

port = sys.argv[1] if len(sys.argv) > 1 else "9090"
try:
    req = urllib.request.Request(f"http://localhost:{port}/api/senses", headers={"X-Minamo": "1"})
    with urllib.request.urlopen(req, timeout=4) as res:
        snap = json.load(res)
except (OSError, ValueError) as e:
    print(f"  スマホの感覚：サーバーに聞けませんでした（{e}）")
    sys.exit(0)
for line in senses.status_lines(snap.get("status") or {}):
    print("  " + line)
