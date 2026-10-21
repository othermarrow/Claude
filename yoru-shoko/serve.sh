#!/data/data/com.termux/files/usr/bin/sh
# 夜の書庫を Chrome で開くための、スマホの中だけのサーバー。
# 自分のスマホからだけ見えるように 127.0.0.1 で待つ。保存はポートごとに分かれるので、8081 を変えない。
cd "$(dirname "$0")" || exit 1
echo "Chrome で http://localhost:8081/ を開いてください（止めるときは Ctrl+C）"
exec python3 -m http.server 8081 --bind 127.0.0.1
