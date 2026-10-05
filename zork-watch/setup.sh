#!/data/data/com.termux/files/usr/bin/bash
# zork-watch の準備（Termux 用）。何度実行してもよい。
# - Zork I のゲームファイル（MIT ライセンスで公開）を assets/common.r/ に置く
# - npm の部品を入れる
set -e
cd "$(dirname "$0")"

pkg install -y nodejs curl

if [ ! -f assets/common.r/zork1.z3 ]; then
  curl -fL -o assets/common.r/zork1.z3 \
    https://raw.githubusercontent.com/historicalsource/zork1/master/COMPILED/zork1.z3
  curl -fL -o assets/common.r/LICENSE-zork1.txt \
    https://raw.githubusercontent.com/historicalsource/zork1/master/LICENSE
fi

npm i

echo
echo "準備ができました。時計を Zepp アプリとつないだ状態で、次を実行します:"
echo "  cd $(pwd) && zeus preview"
