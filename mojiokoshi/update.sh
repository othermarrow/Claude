#!/data/data/com.termux/files/usr/bin/bash
# mojiokoshi の更新。Download にある最も新しい mojiokoshi*.zip か Claude*.zip
# (GitHub の Download ZIP)から、mojiokoshi/ の .py・.sh・README.md を
# ~/mojiokoshi に上書きする。models/ と ~/.config/mojiokoshi の設定は残る。
set -e
DL=${MOJI_DOWNLOAD_DIR:-/storage/emulated/0/Download}
ZIP=$(ls -t "$DL"/mojiokoshi*.zip "$DL"/Claude*.zip 2>/dev/null | head -1)
if [ -z "$ZIP" ]; then
  echo "Download に mojiokoshi*.zip も Claude*.zip もありません。"
  exit 1
fi
echo "使う zip: $ZIP"
TMP=$(mktemp -d)
unzip -q "$ZIP" -d "$TMP"
SRC=$(find "$TMP" -maxdepth 3 -type f -name mojiokoshi.py | head -1)
if [ -z "$SRC" ]; then
  rm -rf "$TMP"
  echo "zip の中に mojiokoshi/ がありません。"
  exit 1
fi
SRC=$(dirname "$SRC")
mkdir -p ~/mojiokoshi
cp "$SRC"/*.py "$SRC"/*.sh "$SRC"/README.md ~/mojiokoshi/
rm -rf "$TMP"
cd ~/mojiokoshi
python mojiokoshi.py -h > /dev/null && echo "OK: 入れ替えました(~/mojiokoshi)"
