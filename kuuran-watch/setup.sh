#!/data/data/com.termux/files/usr/bin/bash
# kuuran-watch の準備（Termux 用）。何度実行してもよい。
set -e
cd "$(dirname "$0")"
pkg install -y nodejs
npm i
echo
echo "準備ができました。時計を Zepp アプリとつないだ状態で、次を実行します:"
echo "  cd $(pwd) && zeus preview"
