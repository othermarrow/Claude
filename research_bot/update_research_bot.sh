# rbup の中身(~/update_research_bot.sh)。Download にある最新の research_bot*.zip で
# ~/research_bot の .py と README.md を入れ替える。
# zip の中は research_bot/ フォルダに入れてあること(research_bot/research_bot.py など)。
set -e
ZIP=$(ls -t /storage/emulated/0/Download/research_bot*.zip | head -1)
echo "使うzip: $ZIP"
TMP=$(mktemp -d)
unzip -q "$ZIP" -d "$TMP"
cp "$TMP"/research_bot/*.py "$TMP"/research_bot/README.md ~/research_bot/
rm -rf "$TMP"
cd ~/research_bot
python research_bot.py -h > /dev/null && echo "OK: 入れ替え完了"
