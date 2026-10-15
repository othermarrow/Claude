#!/data/data/com.termux/files/usr/bin/bash
# mojiokoshi の準備(Termux 用)。何度実行してもよい。
# - 必要なパッケージを入れる(すべて Termux のパッケージ。pip は使わない)
# - 声の検出(Silero VAD)と雑音除去(RNNoise)のモデルを models/ に取ってくる
set -e
cd "$(dirname "$0")"

pkg install -y python ffmpeg python-numpy python-grpcio curl ca-certificates
if ! pkg install -y python-onnxruntime; then
  echo "python-onnxruntime を入れられませんでした。声の検出に必要です。"
  echo "  pkg update のあと、もう一度 setup.sh を実行してください。"
  exit 1
fi

mkdir -p models
# get URL 保存先 sha256(中身を確かめてから置く)
get() {
  if [ -f "$2" ] && echo "$3  $2" | sha256sum -c --status; then
    echo "あります: $2"
    return
  fi
  curl -fL --retry 3 -o "$2.part" "$1"
  if ! echo "$3  $2.part" | sha256sum -c --status; then
    rm -f "$2.part"
    echo "取ってきたファイルが想定と違います: $1"
    exit 1
  fi
  mv "$2.part" "$2"
  echo "取得しました: $2"
}
# Silero VAD v6.2.3(MIT ライセンス)
get https://raw.githubusercontent.com/snakers4/silero-vad/v6.2.3/src/silero_vad/data/silero_vad.onnx \
  models/silero_vad.onnx 1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3
# RNNoise のモデル leavened-quisling(GregorR/rnnoise-models。雑音: 一般、残す音: 声)
get https://raw.githubusercontent.com/GregorR/rnnoise-models/master/leavened-quisling-2018-08-31/lq.rnnn \
  models/rnnoise_lq.rnnn 1957528b752799fddf06270bc5469af7cf54c3badc358544ae2abed730943ff9

echo
python mojiokoshi.py check
