"""動いているミナモのサーバーに、起動時の AI の一括チェックの結果を聞いて表示する（open.sh が使う）。
  python3 tools/probe_info.py [ポート]
一括チェックをしていないサーバー（見張り役が起こし直したもの・--no-probe）なら、そう言う。"""
import json
import sys
import urllib.request

port = sys.argv[1] if len(sys.argv) > 1 else "8082"
try:
    req = urllib.request.Request(f"http://localhost:{port}/api/info", headers={"X-Minamo": "1"})
    with urllib.request.urlopen(req, timeout=4) as res:
        info = json.load(res)
except (OSError, ValueError) as e:
    print(f"  （サーバーに聞けませんでした：{e}）")
    sys.exit(0)
probe = info.get("probe") or []
if not probe:
    print("  （このサーバーは、起動時の一括チェックをしていません。やり直すなら：mo restart）")
for k, r in enumerate(probe, 1):
    # probe.line と同じ形で
    mark = "✓" if r.get("ok") else ("△" if r.get("sec") is not None else "×")
    sec = f"{r['sec']:5.1f}秒" if r.get("sec") is not None else "   ── "
    why = "" if r.get("ok") else f"  （{r.get('why', '')}）"
    print(f"  [{k}/{len(probe)}] {mark} {sec}  {r.get('backend', ''):<6} {r.get('model', '')}{why}")
print(f"  → いま使っている AI：{info.get('backend', '')} / {info.get('model', '')}")
