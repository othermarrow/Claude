#!/data/data/com.termux/files/usr/bin/sh
# 夜の書庫を Chrome で開くための、スマホの中だけのサーバー。
# 自分のスマホからだけ見えるように 127.0.0.1 で待つ。保存はポートごとに分かれる。既定は 7070（ミナモの 9090・端末の AI の 8090 と離した）。
# 番号を付けると、その番号で動く（前の番号 8081 から記録を引っ越すとき：sh serve.sh 8081）。
cd "$(dirname "$0")" || exit 1
PORT="${1:-7070}"
echo "Chrome で http://localhost:$PORT/ を開いてください（止めるときは Ctrl+C）"
exec python3 -m http.server "$PORT" --bind 127.0.0.1
