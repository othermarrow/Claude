#!/data/data/com.termux/files/usr/bin/sh
# start.sh で起動したミナモのサーバーと端末の中の AI を止める（MacroDroid からも使える）。
mkdir -p "$HOME/minamo"
LOG="$HOME/minamo/server.log"
. "$(dirname "$0")/killcheck.sh"   # 止める前に、前回が強制終了だったかを記録（mo update・mo restart でも取れるように）
touch "$HOME/minamo/stop"   # 見張り役に、起こし直さないよう知らせる
pkill -f "minamo/[w]atch.sh"
pkill -f "minamo/[s]erver.py"
pkill -f "[l]lama-server"
command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock
echo "$(date '+%F %T') 止めました" >> "$HOME/minamo/server.log"
exit 0
