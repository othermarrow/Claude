#!/data/data/com.termux/files/usr/bin/sh
# Termux から一発で：サーバーを裏で起動して（start.sh。動いていれば何もしない）、ミナモを開く。
# インストールした PWA があれば、たいていそちらで開く。記録庫・水底は、引数で選べる。
#   sh ~/Claude/minamo/open.sh            # ミナモ（面接）
#   sh ~/Claude/minamo/open.sh archive    # 記録庫
#   sh ~/Claude/minamo/open.sh mina       # 水底（minasoko でも開く）
#   sh ~/Claude/minamo/open.sh stop       # 止める（stop.sh と同じ）
#   sh ~/Claude/minamo/open.sh log        # 様子を見る（ログの最後の 20 行）
cd "$(dirname "$0")" || exit 1
case "$1" in
  stop) sh "$PWD/stop.sh"; echo "止めました。"; exit 0 ;;
  log)  tail -20 "$HOME/minamo/server.log"; exit 0 ;;
  archive)  PAGE="archive.html"; shift ;;
  mina|minasoko) PAGE="minasoko.html"; shift ;;
  *)        PAGE="" ;;
esac
echo "ミナモのサーバーを起動しています（初回は AI の一括チェックで少し待ちます）……"
if ! sh "$PWD/start.sh" "$@"; then
  echo "開けませんでした。tail -20 ~/minamo/server.log で様子を見てください。"
  exit 1
fi
URL="http://localhost:8082/$PAGE"
if command -v termux-open-url >/dev/null 2>&1; then
  termux-open-url "$URL"
else
  am start -a android.intent.action.VIEW -d "$URL" >/dev/null 2>&1
fi
echo "開きました：$URL（止めるときは sh ~/Claude/minamo/stop.sh）"
