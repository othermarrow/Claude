#!/data/data/com.termux/files/usr/bin/sh
# Anchorhead と Slouching Towards Bedlam を、配布元（IF Archive）から Download に取ってくる。
# 取ったファイルは、夜の書庫の「ゲームファイルを開く」で選ぶ。配布条件は、各作品のページで確かめること。
# 使い方: sh fetch_games.sh
OUT=/storage/emulated/0/Download
[ -d "$OUT" ] || { echo "先に termux-setup-storage を実行してください"; exit 1; }
BASE=https://ifarchive.org/if-archive/games

check() {
  # 先頭のバイトで、ゲームファイルか（Z-machine / Glulx / blorb）を確かめる
  f="$1"
  head -c 4 "$f" | od -An -c | tr -d ' \n' | grep -qE '^(\\001|\\002|\\003|\\004|\\005|\\007|\\010)|Glul|FORM'
}

get() {
  name="$1"; shift
  for u in "$@"; do
    echo "試す: $u"
    if curl -fsSL -o "$OUT/$name.tmp" "$u" && [ -s "$OUT/$name.tmp" ] && check "$OUT/$name.tmp"; then
      mv "$OUT/$name.tmp" "$OUT/$name"
      echo "  → $OUT/$name"
      return 0
    fi
    rm -f "$OUT/$name.tmp"
  done
  echo "  取れませんでした: $name（IFDB で名前を検索して、配布ページから手で保存してください）"
  return 1
}

get Anchorhead.z8 "$BASE/zcode/Anchorhead.z8" "$BASE/zcode/anchor.z8"
get Bedlam "$BASE/zcode/bedlam.z5" "$BASE/zcode/Bedlam.z5" "$BASE/glulx/Bedlam.gblorb" "$BASE/glulx/bedlam.gblorb" "$BASE/zcode/Bedlam.zblorb"
echo "できたら、夜の書庫の「ゲームファイルを開く」→ Download から選んでください。"
