#!/data/data/com.termux/files/usr/bin/sh
# 端末の中の AI（llama.cpp の llama-server）を 127.0.0.1:8090 で動かす。止めるときは Ctrl+C。
# ミナモは、クラウドにつながらないとき、ここが動いていれば使う（動いていなければ旧式エンジン）。
# 使い方: sh ~/Claude/minamo/local.sh [モデルの .gguf]
MODEL="${1:-$HOME/models/qwen2.5-3b-instruct-q4_k_m.gguf}"
if [ ! -f "$MODEL" ]; then
  echo "モデルがありません: $MODEL"
  echo "README の「端末の中の AI」を見てください。"
  exit 1
fi
exec llama-server -m "$MODEL" --host 127.0.0.1 --port 8090 -c 4096
