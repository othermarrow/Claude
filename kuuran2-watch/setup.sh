#!/bin/bash
# kuuran2-watch の準備。何度実行してもよい。
# Termux でも、Termux の中の root 環境（proot の Ubuntu / Debian など）でも動くようにしてある。
set -e
cd "$(dirname "$0")"

if ! command -v npm >/dev/null 2>&1; then
  if command -v pkg >/dev/null 2>&1 && [ "$(id -u)" != "0" ]; then
    pkg install -y nodejs
  elif command -v apt-get >/dev/null 2>&1; then
    apt-get update && apt-get install -y nodejs npm
  else
    echo "Node.js（npm）が見つかりません。入れてから、もう一度実行してください。"
    exit 1
  fi
fi

npm i

echo
echo "準備ができました。時計を Zepp アプリとつないだ状態で、次を実行します:"
echo "  cd $(pwd) && zeus preview"
