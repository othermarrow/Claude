#!/data/data/com.termux/files/usr/bin/sh
# Anchorhead と Slouching Towards Bedlam を、配布元（IF Archive）から Download に取ってくる。
# 取ったファイルは、夜の書庫の「ゲームファイルを開く」で選ぶ。配布条件は、各作品のページで確かめること。
# 使い方: sh fetch_games.sh
OUT=/storage/emulated/0/Download
[ -d "$OUT" ] || { echo "先に termux-setup-storage を実行してください"; exit 1; }
BASE=https://ifarchive.org/if-archive/games

check() {
  # 先頭で、ゲームファイルか（Z-machine / Glulx / blorb）を確かめる。HTML のエラーページなどは捨てる
  f="$1"
  magic=$(head -c 4 "$f")
  case "$magic" in Glul|FORM) return 0 ;; esac
  v=$(head -c 1 "$f" | od -An -tu1 | tr -d ' ')
  case "$v" in 1|2|3|4|5|7|8) return 0 ;; esac
  return 1
}

get() {
  name="$1"; shift
  for u in "$@"; do
    echo "試す: $u"
    code=$(curl -sSL -m 60 -o "$OUT/$name.tmp" -w "%{http_code}" "$u" 2>"$OUT/.fetch_err")
    echo "  応答: $code $(head -c 120 "$OUT/.fetch_err")"
    if [ "$code" = "200" ] && [ -s "$OUT/$name.tmp" ] && check "$OUT/$name.tmp"; then
      mv "$OUT/$name.tmp" "$OUT/$name"
      echo "  → $OUT/$name"
      rm -f "$OUT/.fetch_err"
      return 0
    fi
    [ "$code" = "200" ] && echo "  （200 でしたが、ゲームファイルではありませんでした）"
    rm -f "$OUT/$name.tmp"
  done
  rm -f "$OUT/.fetch_err"
  echo "  取れませんでした: $name（IFDB で名前を検索して、配布ページから手で保存してください）"
  return 1
}

get Anchorhead.z8 "$BASE/zcode/Anchorhead.z8" "$BASE/zcode/anchor.z8"
get Bedlam "$BASE/zcode/bedlam.z5" "$BASE/zcode/Bedlam.z5" "$BASE/glulx/Bedlam.gblorb" "$BASE/glulx/bedlam.gblorb" "$BASE/zcode/Bedlam.zblorb"
echo "できたら、夜の書庫の「ゲームファイルを開く」→ Download から選んでください。"
