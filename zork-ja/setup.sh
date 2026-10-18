#!/data/data/com.termux/files/usr/bin/bash
# zork-ja の準備（Termux 用）。何度実行してもよい。
# - 必要なパッケージを入れる
# - frotz（2.55）の文字だけ版 dfrotz をビルドして bin/ に置く
# - Zork I のゲームファイル（MIT ライセンスで公開）を game/ に置く
set -e
cd "$(dirname "$0")"

pkg install -y python clang make git curl binutils which pkg-config

if [ ! -x bin/dfrotz ]; then
  rm -rf build/frotz
  mkdir -p build bin
  git clone --depth 1 -b 2.55 https://gitlab.com/DavidGriffith/frotz.git build/frotz
  AR_BIN="$(command -v ar || command -v llvm-ar)"
  make -C build/frotz CC=clang AR="$AR_BIN" dumb
  cp build/frotz/dfrotz bin/dfrotz
  rm -rf build
fi

if [ ! -f game/zork1.z3 ]; then
  mkdir -p game
  curl -fL -o game/zork1.z3 \
    https://raw.githubusercontent.com/historicalsource/zork1/master/COMPILED/zork1.z3
  curl -fL -o game/LICENSE \
    https://raw.githubusercontent.com/historicalsource/zork1/master/LICENSE
fi

echo
echo "準備ができました。次のコマンドで遊べます:"
echo "  python $(pwd)/zork_ja.py"
