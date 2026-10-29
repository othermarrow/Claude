#!/data/data/com.termux/files/usr/bin/sh
# MacroDroid などから一発でミナモを起動する（画面を出さずに、裏で動かす）。
#   1. 端末の中の AI（モデルがあり、まだ動いていなければ）を 8090 番で
#   2. ミナモのサーバー（まだ動いていなければ）を 8082 番で
# すでに動いていれば、何もしない（何度押してもよい）。止めるのは stop.sh。
# 様子は ~/minamo/server.log・~/minamo/llama.log に残る。
cd "$(dirname "$0")" || exit 1
mkdir -p "$HOME/minamo"
LOG="$HOME/minamo/server.log"
rm -f "$HOME/minamo/stop"
MODEL="${MINAMO_MODEL:-$HOME/models/qwen2.5-3b-instruct-q4_k_m.gguf}"

up() { curl -s -o /dev/null --max-time 2 "$1" 2>/dev/null; }

# 画面が消えても止まらないように（termux-wake-unlock で外す。stop.sh が外す）
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock

if [ -f "$MODEL" ] && command -v llama-server >/dev/null 2>&1 && ! up http://127.0.0.1:8090/health; then
  nohup sh "$PWD/local.sh" "$MODEL" > "$HOME/minamo/llama.log" 2>&1 &
fi

# 見張り役（サーバーが止まったら起こし直す）。一つだけ動かす
pgrep -f "minamo/[w]atch.sh" >/dev/null || nohup sh "$PWD/watch.sh" "$@" >/dev/null 2>&1 &

if up http://127.0.0.1:8082/; then
  echo "$(date '+%F %T') すでに動いています" >> "$LOG"
  exit 0
fi
echo "$(date '+%F %T') 起動します" >> "$LOG"
nohup python3 "$PWD/server.py" "$@" >> "$LOG" 2>&1 &

# 開けるようになるまで待つ（最大 60 秒。AI の一括チェックと蔵書の読み込みのぶん）
i=0
while [ $i -lt 60 ]; do
  up http://127.0.0.1:8082/ && exit 0
  sleep 1; i=$((i + 1))
done
echo "$(date '+%F %T') 60 秒たっても開けません（上の表示を見てください）" >> "$LOG"
exit 1
