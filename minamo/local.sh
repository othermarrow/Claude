#!/data/data/com.termux/files/usr/bin/sh
# 端末の中の AI（llama.cpp の llama-server）を 127.0.0.1:8090 で動かす。止めるときは Ctrl+C。
# ミナモは、クラウドにつながらないとき、ここが動いていれば、端末内モデルの返事に添えるひとことを頼む
# （--local-mode full なら全部話させる）。動いていなければ、端末内モデルだけで話す。
# 使い方: sh ~/Claude/minamo/local.sh [モデルの .gguf]
MODEL="${1:-$HOME/models/qwen2.5-3b-instruct-q4_k_m.gguf}"
if [ ! -f "$MODEL" ]; then
  echo "モデルがありません: $MODEL"
  echo "README の「端末の中の AI」を見てください。"
  exit 1
fi
# 前に起動した llama-server が動いたままなら、知らせて終わる（ポートは一つしか使えない）
if curl -s -o /dev/null --max-time 2 http://127.0.0.1:8090/health 2>/dev/null; then
  echo "ポート 8090 は、もう使われています（前に起動した llama-server が動いたままかもしれません）。"
  echo "モデルを替えるなら、止めてからもう一度："
  echo "  pkill -f llama-server"
  exit 1
fi
exec llama-server -m "$MODEL" --host 127.0.0.1 --port 8090 -c 4096
