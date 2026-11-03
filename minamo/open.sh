#!/data/data/com.termux/files/usr/bin/sh
# Termux から一発で：サーバーを裏で起動して（start.sh。動いていれば何もしない）、ミナモを開く。
# インストールした PWA があれば、たいていそちらで開く。物語「水面の記録」は、引数で選べる。
#   sh ~/Claude/minamo/open.sh            # ミナモ（面接）
#   sh ~/Claude/minamo/open.sh story      # 物語「水面の記録」（archive・mina でも開く）
#   sh ~/Claude/minamo/open.sh stop       # 止める（stop.sh と同じ）
#   sh ~/Claude/minamo/open.sh restart    # 止めて、AI の一括チェックからやり直して開く
#   sh ~/Claude/minamo/open.sh log        # 様子を見る（ログの最後の 20 行と、AI の一括チェックの結果と、腕時計の様子）
#   sh ~/Claude/minamo/open.sh update     # GitHub から最新にして（git pull）、起動し直して開く
#   sh ~/Claude/minamo/open.sh place home # いまの Wi-Fi を「家」として登録する（work なら「職場」。ミナモが居場所にふれる）
#   sh ~/Claude/minamo/open.sh reset      # はじめからやり直す（ミナモのメモリ・手首の記録・書き置きの控えを消す。面接記録は残す）
cd "$(dirname "$0")" || exit 1
case "$1" in
  stop) sh "$PWD/stop.sh"; echo "止めました。"; exit 0 ;;
  restart) sh "$PWD/stop.sh"; sleep 1; shift; PAGE=""
           if curl -s -o /dev/null --max-time 2 http://127.0.0.1:9090/ 2>/dev/null; then
             echo "止められないサーバーが動いています（start.sh 以外の方法で起動したもの？）。そのサーバーの画面で Ctrl+C を押してから、もう一度 mo restart"
             exit 1
           fi
           echo "止めました。起動し直します。" ;;
  place) python3 "$PWD/tools/senses_info.py" --place "$2"; exit $? ;;
  reset)
    echo "はじめからやり直します。消すもの：ミナモのメモリ（~/minamo/memory.json）・手首の記録（~/.config/minamo/wrist.json）・"
    echo "  書き置きの控え（~/minamo/outside.json）。面接記録（記録のフォルダ）と Vault のノートは消しません。"
    printf "消してよければ yes と打ってください: "
    read ans
    [ "$ans" = "yes" ] || { echo "やめました。"; exit 0; }
    sh "$PWD/stop.sh" >/dev/null 2>&1
    rm -f "$HOME/minamo/memory.json" "$HOME/.config/minamo/wrist.json" "$HOME/minamo/outside.json"
    echo "消しました。あと二つ、画面の側で消してください："
    echo "  1. 物語「水面の記録」：最初の画面のいちばん下の「記録を消す」（掲示板・チャット・夜の数）"
    echo "  2. 時計の minamo：「終わる」→「はじめから」を二度押す"
    echo "起動し直すときは：mo"
    exit 0 ;;
  log)  tail -20 "$HOME/minamo/server.log"; echo "AI の一括チェック："
        python3 "$PWD/tools/probe_info.py" 9090
        python3 "$PWD/tools/watch_info.py" 9090
        python3 "$PWD/tools/senses_info.py" 9090; exit 0 ;;
  update)
    # 端末の main に、GitHub で取り込んだもの（マージ）があっても止まらないように --no-rebase --no-edit
    ROOT=$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null) || { echo "git のフォルダが見つかりません。"; exit 1; }
    BR="${2:-ccr-94656590-3g47vm}"
    before=$(git -C "$ROOT" log -1 --format=%h)
    echo "GitHub から最新にしています（$BR）……"
    if git -C "$ROOT" pull --no-rebase --no-edit origin "$BR"; then
      after=$(git -C "$ROOT" log -1 --format=%h)
      if [ "$before" = "$after" ]; then echo "もう最新でした（$after）。"
      else echo "更新しました：$before → $after"; fi
      exec sh "$PWD/open.sh" restart
    fi
    echo "更新できませんでした。上の英語のメッセージを、そのまま Claude に見せてください。"
    exit 1 ;;
  story|archive|mina|minasoko) PAGE="story.html"; shift ;;
  *)        PAGE="" ;;
esac
LOG="$HOME/minamo/server.log"
# いまのファイルの版（更新できたかは、ここと起動画面のいちばん下でわかる）
echo "ミナモ：更新 $(git -C "$PWD" log -1 --format='%h（%cd）' --date=format:'%m/%d %H:%M' 2>/dev/null)"
mkdir -p "$HOME/minamo"
touch "$LOG"
if curl -s -o /dev/null --max-time 2 http://127.0.0.1:9090/ 2>/dev/null; then
  # もう動いている：そのサーバーに、起動時の一括チェックの結果を聞いて見せる
  echo "サーバーは、もう動いています。起動したときの AI の一括チェック："
  python3 "$PWD/tools/probe_info.py" 9090
  python3 "$PWD/tools/watch_info.py" 9090
  python3 "$PWD/tools/senses_info.py" 9090
  sh "$PWD/start.sh" "$@" >/dev/null 2>&1
else
  # 起動のあいだ、ログに増えた行（各モデルの一括チェックの進み具合など）を、そのまま見せる
  off=$(( $(wc -c < "$LOG") + 1 ))
  if pgrep -f "minamo/[s]erver.py" >/dev/null; then
    # 起動の途中（一括チェックのさいちゅう）：その起動の最初から見せる
    echo "ミナモのサーバーは、起動の途中です（AI の一括チェックで少し待ちます）……"
    b=$(grep -b "起動します$" "$LOG" | tail -1 | cut -d: -f1)
    [ -n "$b" ] && off=$((b + 1))
  else
    echo "ミナモのサーバーを起動しています（AI の一括チェックで少し待ちます）……"
  fi
  sh "$PWD/start.sh" "$@" &
  spid=$!
  seen=0
  show() {
    size=$(wc -c < "$LOG")
    if [ "$size" -ge "$off" ]; then
      new=$(tail -c +"$off" "$LOG" | grep -v -e "起動します$" -e "すでに動いています$" -e "^Chrome で")
      off=$(( size + 1 ))
      if [ -n "$new" ]; then
        printf '%s\n' "$new" | sed 's/^/  /'
        printf '%s' "$new" | grep -q "\[[0-9]*/[0-9]*\]" && seen=1
        quiet=0
      fi
    fi
  }
  t=0; quiet=0
  while kill -0 "$spid" 2>/dev/null; do
    sleep 1
    t=$((t + 1)); quiet=$((quiet + 1))
    show
    # 何も出ないあいだも、待っていることがわかるように
    [ "$quiet" -ge 4 ] && { echo "  ……待っています（${t} 秒）"; quiet=0; }
  done
  wait "$spid"
  rc=$?
  show
  # ログに一括チェックの行が出てこなかったときは、サーバーに直接聞く
  [ "$rc" = 0 ] && [ "$seen" = 0 ] && python3 "$PWD/tools/probe_info.py" 9090
  # 腕時計（minamo）の様子（前に届いたのはいつか。起動したことは、時計が次につながったときに伝わる）
  [ "$rc" = 0 ] && python3 "$PWD/tools/watch_info.py" 9090
  # スマホの感覚（予定・居場所・天気・通知）が読めているか（足りない設定も出す）
  [ "$rc" = 0 ] && python3 "$PWD/tools/senses_info.py" 9090
  if [ "$rc" != 0 ]; then
    echo "開けませんでした。上の表示か、mo log で様子を見てください。"
    exit 1
  fi
fi
# すぐに Chrome が前に出て、上の結果が隠れないように、少しだけ待つ
echo "（3 秒後に開きます。結果はあとで mo log でも見られます）"
sleep 3
URL="http://localhost:9090/$PAGE"
# 開くアプリを Chrome に決めて渡す。決めないと、localhost のリンクを受け持つアプリ（天文アプリ・
# 階層目録などの PWA）が、いっしょに起動することがある。別のブラウザなら MINAMO_BROWSER=パッケージ名
BROWSER="${MINAMO_BROWSER:-com.android.chrome}"
if ! am start -a android.intent.action.VIEW -d "$URL" -p "$BROWSER" >/dev/null 2>&1; then
  if command -v termux-open-url >/dev/null 2>&1; then
    termux-open-url "$URL"
  else
    am start -a android.intent.action.VIEW -d "$URL" >/dev/null 2>&1
  fi
fi
echo "開きました：$URL（止めるときは mo stop か sh ~/Claude/minamo/stop.sh）"
