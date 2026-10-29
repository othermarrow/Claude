#!/data/data/com.termux/files/usr/bin/sh
# start.sh が裏で動かす見張り役。ミナモのサーバーが止まっていたら、起こし直す。
# ~/minamo/stop があれば（stop.sh が置く）、何もせずに終わる。
cd "$(dirname "$0")" || exit 1
LOG="$HOME/minamo/server.log"
STOP="$HOME/minamo/stop"
up() { curl -s -o /dev/null --max-time 3 http://127.0.0.1:8082/ 2>/dev/null; }
while [ ! -f "$STOP" ]; do
  sleep 15
  [ -f "$STOP" ] && break
  if ! up && ! pgrep -f "minamo/[s]erver.py" >/dev/null; then
    echo "$(date '+%F %T') サーバーが止まっていたので、起こし直します" >> "$LOG"
    nohup python3 "$PWD/server.py" --no-probe "$@" >> "$LOG" 2>&1 &
  fi
done
