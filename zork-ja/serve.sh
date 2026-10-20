#!/data/data/com.termux/files/usr/bin/sh
# ZORK I 日本語版を Chrome で開くための、スマホの中だけのサーバー。
# 保存はポートごとに分かれる。階層目録（8080）とは別アプリにするため 8081 を使う。変えない。
cd "$(dirname "$0")" || exit 1
echo "Chrome で http://localhost:8081/ を開いてください（止めるときは Ctrl+C）"
exec python3 -m http.server 8081 --bind 127.0.0.1
