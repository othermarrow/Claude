# mojiup の中身。Download にある最新の mojiokoshi*.zip で ~/mojiokoshi を入れ替える
# (初めて入れるときにも使える)。zip の中は mojiokoshi/ フォルダに入れてあること。
# 自分で変えた設定は ~/.config/mojiokoshi/config_local.py に書いておけば消えない。
set -e
ZIP=$(ls -t /storage/emulated/0/Download/mojiokoshi*.zip 2>/dev/null | head -1)
if [ -z "$ZIP" ]; then
  echo "Download に mojiokoshi*.zip がありません"
  exit 1
fi
echo "使うzip: $ZIP"
TMP=$(mktemp -d)
unzip -q "$ZIP" -d "$TMP"
if [ ! -f "$TMP/mojiokoshi/mojiokoshi.py" ]; then
  echo "zip の中に mojiokoshi/mojiokoshi.py がありません"
  rm -rf "$TMP"
  exit 1
fi
mkdir -p ~/mojiokoshi
if [ -f ~/mojiokoshi/config.py ] && ! cmp -s ~/mojiokoshi/config.py "$TMP/mojiokoshi/config.py"; then
  cp ~/mojiokoshi/config.py ~/mojiokoshi/config.py.bak
  echo "前の config.py は config.py.bak に残しました"
fi
cp "$TMP"/mojiokoshi/*.py "$TMP"/mojiokoshi/README.md "$TMP"/mojiokoshi/update_mojiokoshi.sh ~/mojiokoshi/
cp "$TMP/mojiokoshi/.mojiokoshi.sh" ~/.mojiokoshi.sh
rm -rf "$TMP"
grep -q '\.mojiokoshi\.sh' ~/.bashrc 2>/dev/null || echo '[ -f ~/.mojiokoshi.sh ] && . ~/.mojiokoshi.sh' >> ~/.bashrc
cd ~/mojiokoshi
mkdir -p ~/.cache
if python mojiokoshi.py selftest > ~/.cache/mojiokoshi_selftest.txt 2>&1; then
  echo "OK: 入れ替え完了(新しいコマンドは source ~/.bashrc の後で使える)"
else
  cat ~/.cache/mojiokoshi_selftest.txt
  echo "入れ替えたが、自己点検で ✗ が出ました(上の表示を見てください)"
fi
