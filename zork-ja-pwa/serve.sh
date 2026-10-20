#!/data/data/com.termux/files/usr/bin/sh
# ZORK I 日本語版（PWA）を Chrome で開くための、スマホの中だけのサーバー。
# 保存はポートごとに分かれる。階層目録（8080）とは別アプリにするため 8090 を使う。変えない。
cd "$(dirname "$0")" || exit 1
echo "Chrome で http://localhost:8090/ を開いてください（止めるときは Ctrl+C）"
exec python3 -m http.server 8090 --bind 127.0.0.1
