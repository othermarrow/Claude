# ===== research_bot(文献収集)の補助コマンド =====
# 一覧: rbhelp
# Unpaywall・OpenAlex に伝える連絡先。config.py の ACADEMIC_EMAIL が空のとき使われる
export UNPAYWALL_EMAIL="yuu.ohara@gmail.com"

# 同じ名前のエイリアスが残っていると関数を定義できないので消しておく
unalias rb rbrun rblog cdcat check rbhelp 2>/dev/null

RB_DIR="$HOME/research_bot"

# research_bot.py をそのまま呼ぶ: rb <サブコマンド> ...
rb() { python "$RB_DIR/research_bot.py" "$@"; }

# 収集してログも残す: rbrun [テーマ文] [オプション]
rbrun() {
  mkdir -p "$HOME/rb_logs"
  local log="$HOME/rb_logs/$(date +%Y%m%d-%H%M).txt"
  echo "ログ: $log"
  python "$RB_DIR/research_bot.py" "$@" 2>&1 | tee -i "$log"
}

# 最新のログの末尾を表示: rblog [行数]
rblog() {
  local f
  f="$(ls -t "$HOME"/rb_logs/*.txt 2>/dev/null | head -1)"
  [ -z "$f" ] && { echo "ログがありません(rbrun で実行すると残ります)"; return 1; }
  echo "== $f"
  tail -n "${1:-40}" "$f"
}

# カタログの保存先(config.py の CATALOG_ROOT を読む)
_rb_root() {
  python -c "import sys; sys.path.insert(0, '$RB_DIR'); import config; print(config.CATALOG_ROOT)"
}

# カタログのフォルダへ移動: cdcat [テーマ名](省略で一覧)
cdcat() {
  if [ -z "$1" ]; then
    rb themes
    return
  fi
  cd "$(_rb_root)/${1%/}" || return 1
  pwd
}

# 事後チェック3種: check <テーマ名> [--no-ensemble] [--model 名前]
check() {
  local t="${1%/}"
  if [ -z "$t" ]; then
    echo "使い方: check <テーマ名> [--no-ensemble] [--model 名前]"
    rb themes
    return 1
  fi
  rb check "$t" "${@:2}" || echo "  (失敗)"
  echo
  echo "===== 出力 ====="
  ls "$(_rb_root)/$t" 2>/dev/null | grep '^_' || echo "  (出力なし)"
}

alias ens='rb ensemble'      # ens <テーマ名>          別モデルで再判定
alias ft='rb fulltext'       # ft <テーマ名> [--fetch]  全文の所在
alias cdiff='rb diff'        # cdiff <テーマ名>        前回との差分
alias rthemes='rb themes'
alias rmodels='rb models'
alias rprobe='rb probe'
alias rbup='bash ~/update_research_bot.sh'
alias rbot='rb'              # 旧名

rbhelp() {
  cat << 'HELP'
rbrun [テーマ文] [オプション]  収集(ログは ~/rb_logs)
  --resume             中断したところから再開
  --reuse-plan [回]    前回(または指定した回)の検索計画
  --model 名前         判定モデルを差し替え
rblog [行数]           最新のログの末尾
check <テーマ>         事後チェック3種
  --no-ensemble        再判定を省く
ens / ft / cdiff <テーマ>
                       再判定 / 全文の所在 / 前回との差分
cdcat [テーマ]         フォルダへ移動(省略で一覧)
rthemes / rmodels / rprobe
                       テーマ一覧 / モデル一覧 / 応答確認
rbup                   Download の最新 zip で更新
rb <サブコマンド>      research_bot.py をそのまま呼ぶ
HELP
}
# ===== research_bot 補助コマンド ここまで =====
