#!/data/data/com.termux/files/usr/bin/sh
# 階層目録を Chrome で開くための、スマホの中だけのサーバー。
# 自分のスマホからだけ見えるように 127.0.0.1 で待つ。
# 既定のポートは 8095（8080 はほかのアプリと重なったので変えた）。sh serve.sh 8097 のように別の番号も選べる。
# 保存（localStorage）はポートごとに分かれるので、いつも同じ番号で開く。
PORT="${1:-${PORT:-8095}}"
cd "$(dirname "$0")" || exit 1
echo "Chrome で http://localhost:$PORT/ を開いてください（止めるときは Ctrl+C）"
exec python3 -m http.server "$PORT" --bind 127.0.0.1
