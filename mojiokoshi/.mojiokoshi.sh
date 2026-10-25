# ===== mojiokoshi(文字起こし)の補助コマンド =====
# ~/.mojiokoshi.sh に置き、~/.bashrc に次の1行を足して読み込む:
#   [ -f ~/.mojiokoshi.sh ] && . ~/.mojiokoshi.sh
# 一覧: mojihelp

unalias moji mojicheck mojilist mojilog mojiup mojihelp mojikeys 2>/dev/null

MOJI_DIR="$HOME/mojiokoshi"

# 文字起こし: moji [ファイル名…] [--force など]
# 途中で画面が消えても止まらないよう、実行中は termux-wake-lock をかける
moji() {
  mkdir -p "$HOME/moji_logs"
  local log="$HOME/moji_logs/$(date +%Y%m%d-%H%M).txt"
  command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock
  python "$MOJI_DIR/mojiokoshi.py" "$@" 2>&1 | tee -i "$log"
  local rc=${PIPESTATUS[0]}
  command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock
  echo "ログ: $log"
  return $rc
}

# キー・モデル・エンジンが今使えるか: mojicheck [--deep] [--all]
mojicheck() { python "$MOJI_DIR/mojiokoshi.py" check "$@"; }

# 入力フォルダの音声と、済んだかどうか
mojilist() { python "$MOJI_DIR/mojiokoshi.py" list; }

# 最新のログの末尾: mojilog [行数]
mojilog() {
  local f
  f="$(ls -t "$HOME"/moji_logs/*.txt 2>/dev/null | head -1)"
  [ -z "$f" ] && { echo "ログがありません(moji で実行すると残ります)"; return 1; }
  echo "== $f"
  tail -n "${1:-40}" "$f"
}

# キーの書き換え(nano で開く)
mojikeys() { mkdir -p ~/.config/mojiokoshi && nano ~/.config/mojiokoshi/keys.env && chmod 600 ~/.config/mojiokoshi/keys.env; }

# Download の最新の mojiokoshi*.zip で更新
alias mojiup='bash "$MOJI_DIR/update_mojiokoshi.sh"'

mojihelp() {
  cat <<'EOF'
moji                   Converter の音声をすべて文字起こし(済んだものは飛ばす)
moji 会議.m4a           指定したファイルだけ
moji --force 会議.m4a   作り直す(途中経過は使い回すので、欠けた分だけ問い合わせる)
moji --fresh 会議.m4a   途中経過も捨てて最初から
moji --no-proof        校正しない
moji --engines whisper-v3,parakeet   エンジンを選ぶ
mojicheck              キー・モデル・エンジンの確認(--deep で LLM にも問い合わせる)
mojilist               入力フォルダの一覧
mojilog                最新のログ
mojikeys               API キーの書き換え
mojiup                 Download の最新 zip で更新
EOF
}
