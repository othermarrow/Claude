#!/data/data/com.termux/files/usr/bin/sh
# Termux から一発で：サーバーを裏で起動して（start.sh。動いていれば何もしない）、ミナモを開く。
# インストールした PWA があれば、たいていそちらで開く。物語「水面の記録」は、引数で選べる。
#   sh ~/Claude/minamo/open.sh            # ミナモ（面接）
#   sh ~/Claude/minamo/open.sh story      # 物語「水面の記録」（archive・mina でも開く）
#   sh ~/Claude/minamo/open.sh stop       # 止める（stop.sh と同じ）
#   sh ~/Claude/minamo/open.sh log        # 様子を見る（ログの最後の 20 行）
cd "$(dirname "$0")" || exit 1
case "$1" in
  stop) sh "$PWD/stop.sh"; echo "止めました。"; exit 0 ;;
  log)  tail -20 "$HOME/minamo/server.log"; exit 0 ;;
  story|archive|mina|minasoko) PAGE="story.html"; shift ;;
  *)        PAGE="" ;;
esac
LOG="$HOME/minamo/server.log"
mkdir -p "$HOME/minamo"
touch "$LOG"
if curl -s -o /dev/null --max-time 2 http://127.0.0.1:8082/ 2>/dev/null; then
  # もう動いている：前に起動したときの一括チェックの結果を見せる
  echo "サーバーは、もう動いています。前に起動したときの AI の一括チェック："
  awk '/起動します$/ { buf = "" } { buf = buf $0 "\n" } END { printf "%s", buf }' "$LOG" | grep -E "一括チェック|\[[0-9]+/[0-9]+\]|→|^API:" | sed 's/^/  /'
  sh "$PWD/start.sh" "$@" >/dev/null 2>&1
else
  echo "ミナモのサーバーを起動しています（AI の一括チェックで少し待ちます）……"
  # 起動のあいだ、ログに増えた行（各モデルの一括チェックの進み具合など）を、そのまま見せる
  off=$(( $(wc -c < "$LOG") + 1 ))
  sh "$PWD/start.sh" "$@" &
  spid=$!
  show() {
    size=$(wc -c < "$LOG")
    if [ "$size" -ge "$off" ]; then
      tail -c +"$off" "$LOG" | grep -v -e "起動します$" -e "^Chrome で" | sed 's/^/  /'
      off=$(( size + 1 ))
    fi
  }
  while kill -0 "$spid" 2>/dev/null; do
    sleep 1
    show
  done
  wait "$spid"
  rc=$?
  show
  if [ "$rc" != 0 ]; then
    echo "開けませんでした。上の表示か、mo log で様子を見てください。"
    exit 1
  fi
fi
URL="http://localhost:8082/$PAGE"
if command -v termux-open-url >/dev/null 2>&1; then
  termux-open-url "$URL"
else
  am start -a android.intent.action.VIEW -d "$URL" >/dev/null 2>&1
fi
echo "開きました：$URL（止めるときは mo stop か sh ~/Claude/minamo/stop.sh）"
