#!/data/data/com.termux/files/usr/bin/sh
# start.sh で起動したミナモのサーバーと端末の中の AI を止める（MacroDroid からも使える）。
pkill -f "minamo/[s]erver.py"
pkill -f "[l]lama-server"
command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock
echo "$(date '+%F %T') 止めました" >> "$HOME/minamo/server.log"
exit 0
