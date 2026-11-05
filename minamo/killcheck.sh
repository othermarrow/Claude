#!/data/data/com.termux/files/usr/bin/sh
# start.sh と stop.sh が読み込む。LOG が決まっていること。
# 前回、止めた印（stop）もなく、サーバーも動いていなければ、Android に強制終了されたらしい。時刻を残す（mo log で見える）
if [ -f "$LOG" ] && [ ! -f "$HOME/minamo/stop" ] && ! pgrep -f "minamo/[s]erver.py" >/dev/null \
   && ! tail -n 1 "$LOG" | grep -q "止めました"; then
  last=$(cat "$HOME/minamo/alive" 2>/dev/null)          # サーバーが最後に生きていた時刻（1 分ごとに書く）
  [ -n "$last" ] || last=$(grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9:]{8} ' "$LOG" | tail -n 1 | cut -c1-19)
  echo "$(date '+%F %T') 前回は、止めていないのに止まっていました（強制終了のおそれ。最後に動いていた時刻 ${last:-不明}）" >> "$LOG"
  mem=$(tail -n 5 "$HOME/minamo/mem.log" 2>/dev/null | awk '{printf "%s%s", (NR>1?" / ":""), $0}')   # 直前 5 分の空きメモリ
  echo "$(date '+%F %T') ${last:-不明}${mem:+  直前のメモリ: $mem}" >> "$HOME/minamo/kills.log"
fi
