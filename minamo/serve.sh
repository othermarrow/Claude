#!/data/data/com.termux/files/usr/bin/sh
# ミナモ（PWA 版）を Chrome で開くための、スマホの中だけのサーバー。
# 自分のスマホからだけ見えるように 127.0.0.1 で待つ。保存はポートごとに分かれるので、8082 を変えない。
# 付けた引数（--backend nvidia など）は、そのまま server.py に渡す。
cd "$(dirname "$0")" || exit 1
exec python3 server.py "$@"
