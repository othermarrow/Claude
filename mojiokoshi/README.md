# 物音の多い録音の文字起こし(mojiokoshi)

NVIDIA の API(build.nvidia.com)だけで、録音を文字起こしする Termux 用のツール。
物音が声より大きい場面や、物音しかしない時間が長い録音を想定している。

- 物音しかしない時間は、スマホの中で声を検出して(Silero VAD)、**そもそも送らない**。
  送る量と時間が減り、Whisper が物音から文章を作る誤認識(「ご視聴ありがとう
  ございました」など)の大半を防げる。
- 声のある区間だけを NVIDIA API の音声認識(既定は Whisper large-v3)に送る。
- 返ってきた結果から、物音由来らしい誤認識を見分けて「除外」「要確認」に分ける。
  除外したものも末尾の一覧に残す(黙って消さない)。
- 結果は Obsidian でそのまま読める Markdown(時刻つき)と、字幕形式(SRT)で保存する。

## しくみ

```
録音(m4a・mp3・wav・mp4 など)
 │ ffmpeg で 16kHz・モノラルに変換(80Hz 以下の振動・空調の音を切る)
 ▼
声の検出(Silero VAD・スマホの中)
 │ ① 元の音声 ② 雑音を除いて音量をそろえた音声(RNNoise → dynaudnorm)の両方で
 │   32ms ごとに「声らしさ」を出し、どちらかで声なら声とする
 ▼
区間分け
 │ 前後に 0.5秒の余白・2秒以内の区間はつなぐ(文脈が増えて正確になる)・
 │ 25秒を超える発話は声の途切れで分ける(Whisper は30秒単位で処理するため)
 ▼
送る音声を整える(区間ごと)
 │ 声のない瞬間の大きな物音(ドア・食器・叩く音)を声の大きさまで下げ、
 │ 声の音量をそろえる(遠くの小さな声を持ち上げる)
 ▼
NVIDIA API で認識(Whisper large-v3・日本語。並列・送信間隔の調整・再試行つき)
 │ (任意)確認用のモデル(parakeet など)でも認識し、食い違いを見る
 ▼
誤認識の見分け → Markdown と SRT に保存
 │ (任意)LLM で変換ミスと句読点だけを直した版も作る
```

途中経過は録音ごとに `~/.cache/mojiokoshi/` に残る。途中で止まっても(Ctrl-C・
通信切れ・Termux が落ちた)、同じコマンドで続きから再開し、送った区間は送り直さない。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `mojiokoshi.py` | 入口。全体の流れ・再開・`models`・`check` |
| `config.py` | 設定(よく変える設定ほど上) |
| `audio.py` | 変換(ffmpeg)・声の検出(Silero VAD)・区間分け・送る音声の整え方 |
| `nvasr.py` | NVIDIA API(Riva の gRPC)の呼び出し。公式クライアントを使わずに通信する |
| `textfilter.py` | 誤認識の見分け |
| `output.py` | Markdown・SRT の書き出し |
| `polish.py` | LLM で読みやすく整える(`--polish`) |
| `setup.sh` | 初回の準備(パッケージとモデル) |
| `update.sh` | 更新(Download の zip から入れ替え。モデルと設定は残る) |

公式の `nvidia-riva-client` は Termux ではビルドが要る依存(grpcio-tools)を持つため
使っていない。必要な通信の形(`riva_asr.proto` の一部)を `nvasr.py` で組み立てている。

## 準備(初回だけ)

1. このフォルダの zip(`mojiokoshi.zip` か、GitHub の `Code` → `Download ZIP` で
   保存した `Claude-ブランチ名.zip`)を Download に置く。
2. Termux で次を実行する。

```bash
termux-setup-storage
pkg install -y unzip
cd ~
mkdir -p ~/mojiokoshi_tmp
unzip -o -q "$(ls -t /storage/emulated/0/Download/mojiokoshi*.zip /storage/emulated/0/Download/Claude*.zip 2>/dev/null | head -1)" -d ~/mojiokoshi_tmp
mkdir -p ~/mojiokoshi
cp "$(dirname "$(find ~/mojiokoshi_tmp -name mojiokoshi.py | head -1)")"/* ~/mojiokoshi/
rm -r ~/mojiokoshi_tmp
bash ~/mojiokoshi/setup.sh
```

`setup.sh` は Termux のパッケージ(python・ffmpeg・python-numpy・python-grpcio・
python-onnxruntime)を入れ、声の検出と雑音除去のモデルを `~/mojiokoshi/models/` に
取ってくる(中身はハッシュで確かめる)。最後に `check` の結果が出る。

3. 短い名前で呼べるようにする。

```bash
cat >> ~/.bashrc <<'EOF'
alias moji='python ~/mojiokoshi/mojiokoshi.py'
alias mojiup='bash ~/mojiokoshi/update.sh'
EOF
source ~/.bashrc
```

4. API キーは `.bashrc` の `export NVIDIA_API_KEY=nvapi-...` をそのまま使う
   (research_bot の `~/.config/research_bot/keys.env` があれば、そこからも読む)。

5. モデルが使えるか確かめる(1分ほど)。

```bash
moji models
```

それぞれのモデルに雑音だけの短い音声を送り、`OK` / `NG` と、通った言語コード・
方式を表示する。通った組み合わせは `~/.config/mojiokoshi/functions.json` に残り、
次からはそれを使う。function-id が変わっていたら、ここで分かる(NVCF の一覧が
取れれば、名前から新しい function-id も探す)。

6. まず自分の声の短い録音(1〜2分)で試し、結果を確かめてから本番の録音に使う。

## 使い方

```bash
moji /storage/emulated/0/Download/録音.m4a          # 文字起こし
moji 録音.m4a --dry-run                              # 声の検出だけ(送信しない)。区間数と送信回数の見込み
moji 録音.m4a --from 1:00:00 --to 1:30:00            # 一部だけ(設定を試すとき)
moji 録音.m4a --verify parakeet                      # 確認用のモデルでも認識する
moji 録音.m4a --polish                               # LLM で整えた版も作る
moji 録音.m4a --vad-threshold 0.3                    # 声をもっと拾う(物音の誤検出も増える)
moji 録音.m4a --denoise rnnoise                      # 送る音声の雑音も除く(試すとき)
moji 録音.m4a -o /storage/emulated/0/Vault/文字起こし  # 保存先を指定
moji a.m4a b.m4a c.m4a                               # 複数をまとめて
moji /storage/emulated/0/Converter --ext wav,mp3 -o /storage/emulated/0/Converter/Output
                                                     # フォルダの中の wav・mp3 をまとめて
moji models                                          # モデルが使えるか
moji check                                           # 準備ができているか
```

### フォルダをまとめて処理する

録音ファイルの代わりにフォルダを渡すと、その中の音声をまとめて順に処理する
(サブフォルダの中は見ない。`.` で始まるファイルは飛ばす)。

- `--ext wav,mp3` … 拾う形式を絞る(大文字・小文字は区別しない)。既定は音声・動画の形式すべて
- 同じ名前で形式だけ違うファイル(`録音.wav` と `録音.mp3` など)は、同じ録音とみなして
  1つだけ使う(wav → flac → m4a → aac → mp3 … の順で先のもの)
- 結果(`名前_文字起こし.md`)が保存先に既にある録音は飛ばす。新しく足した録音だけを
  処理するので、同じコマンドを何度実行してもよい。作り直すときは `--overwrite`
  (送った区間の記録が残っていれば、送り直さずに作り直す)

よく使うフォルダは、短い名前にしておくと楽。

```bash
cat >> ~/.bashrc <<'EOF'
alias mojiconv='python ~/mojiokoshi/mojiokoshi.py /storage/emulated/0/Converter --ext wav,mp3 -o /storage/emulated/0/Converter/Output'
EOF
source ~/.bashrc
```

処理中は `termux-wake-lock` でスマホが眠らないようにし、終わったら通知する
(通知は Termux:API があるとき)。長い録音では、Android の設定で Termux の
「バッテリーの最適化」を外しておくと、途中で止められにくい。

### 時間の目安

この開発環境(Linux・x86)での実測。スマホではこれより遅いと見込まれる(未計測)。

| 段階 | 1時間の録音 |
|---|---|
| 変換と声の検出(2通り) | 約1分30秒(実測) |
| 送信(声が2割・88区間の場合) | 送信上限 35回/分なら約3分(見込み。API の応答が遅ければ延びる) |

声の検出の結果は残るので、同じ録音のやり直しでは検出し直さない。検出を急ぐときは
`--fast-vad`(雑音を除いた音声での検出を省く。物音の下の声を取りこぼしやすくなる)。

## 出力

録音と同じフォルダ(`-o` か設定の `OUTPUT_DIR` で変えられる)に保存する。

| ファイル | 中身 |
|---|---|
| `録音_文字起こし.md` | 本文(区間ごとに時刻つき)・処理の条件・要確認と除外の一覧 |
| `録音_文字起こし.srt` | 字幕形式(再生ソフトで音声と合わせて確かめるとき) |
| `録音_文字起こし_整形.md` | `--polish` のときだけ。LLM で変換ミスと句読点を直した版 |

本文の例:

```
**00:12:34** おはようございます。今日は朝から雨が降っていますね。

*(00:13:10〜00:25:42 発話なし 12分32秒)*

**00:25:42** はい。 ⚠(要確認: 物音だけでも出やすい言葉(声らしい部分 0.2秒))
```

### 誤認識の見分け方

| 扱い | 条件 |
|---|---|
| 除外 | 動画の字幕由来の定型句(「ご視聴ありがとうございました」「チャンネル登録」「字幕作成」など)だけの結果・効果音の表記(「(拍手)」「♪」)・同じ文字の繰り返しだけ・文字なし |
| 要確認 | 定型句を除いた残り/同じ語句の4回以上の繰り返し/声の長さに比べて文字が多すぎる/「はい」「ありがとうございました」など物音でも出やすい言葉が、声らしい部分の短い区間から返った/声の確からしさが低い区間/日本語以外の文字が多い/確認用のモデルでは声なし |

除外・要確認は、時刻・理由・認識結果を末尾の表に残す。消すのではなく、本文から
外すだけ。

## 設定

`config.py` は更新で上書きされるので、変えたい設定は
`~/.config/mojiokoshi/settings.env` に書く(更新しても残る)。

```bash
mkdir -p ~/.config/mojiokoshi
cat > ~/.config/mojiokoshi/settings.env <<'EOF'
OUTPUT_DIR=/storage/emulated/0/Vault/文字起こし
VAD_THRESHOLD=0.4
EOF
```

| 項目 | 既定 | 意味 |
|---|---|---|
| `OUTPUT_DIR` | 空(録音と同じフォルダ) | 保存先 |
| `ASR_MODEL` | whisper | 文字起こしのモデル(whisper / parakeet / canary) |
| `VERIFY_MODEL` | 空 | 確認用のモデル(`--verify` と同じ) |
| `VAD_THRESHOLD` | 0.4 | 声とみなす確からしさ。下げると拾うが誤検出も増える |
| `VAD_DENOISED` | true | 雑音を除いた音声でも声を検出して合わせる |
| `DENOISE` | none | 送る音声の雑音除去(none / rnnoise / bnr) |
| `SPEECH_PAD_SEC` | 0.5 | 区間の前後の余白(秒) |
| `MERGE_GAP_SEC` | 2.0 | これ以下の間の区間はつなぐ(秒) |
| `MAX_SEGMENT_SEC` | 25 | 1回に送る長さの上限(秒) |
| `GAP_NOTE_SEC` | 60 | これ以上の無発話を本文に「発話なし」と書く(秒) |
| `REQUESTS_PER_MINUTE` | 35 | 1分あたりの送信上限。混雑の応答で自動で下げる |
| `CONCURRENCY` | 3 | 同時に送る数 |
| `AUDIO_STYLE` | auto | 音声の送り方(下の「うまくいかないとき」) |
| `POLISH_MODEL` | nvidia/nemotron-3-super-120b-a12b | `--polish` に使うモデル |
| `DELETE_AUDIO_CACHE` | true | 終わったら変換した音声を消す(結果の記録は残る) |

### モデル

| 短い名前 | モデル | 言語コード | 特徴 |
|---|---|---|---|
| whisper(既定) | openai/whisper-large-v3 | ja | 日本語の精度が高い。物音から文章を作ることがある |
| parakeet | nvidia/parakeet-1.1b-rnnt-multilingual-asr | ja-JP | 物音から文章を作りにくい方式。日本語の精度は未確認 |
| canary | nvidia/canary-1b-asr | ja-JP | 日本語に対応しているかは未確認(`models` で分かる) |

## うまくいかないとき

- **`API キーが通りません`** … `echo $NVIDIA_API_KEY` でキーが入っているか、
  build.nvidia.com でキーが有効か確かめる。
- **`function-id が見つかりません`** … `moji models` を実行する。NVIDIA 側で
  function-id が変わったときは、build.nvidia.com のそのモデルの API ページの
  `function-id` を見て、`moji models --set whisper <function-id>` で登録する。
- **`このモデルは指定の条件を受け付けません`** … 言語コードか方式が合っていない。
  `moji models` で通る組み合わせを探す。
- **すべての区間が空で返る** … 送り方が合っていない可能性がある。既定(`auto`)では、
  声のはっきりした区間が2回空で返ると WAV 形式で送る方式を試し、文字が返れば
  以降はその方式にする(`[送り方]` と表示される)。それでも空なら `moji models` と、
  短い自分の声の録音で確かめる。
- **声を取りこぼす** … `--vad-threshold 0.3`。`--dry-run` で区間の数と声らしさを
  見ながら調整できる。
- **物音を声と取り違えた区間が多い** … `--vad-threshold 0.5`。
- **途中で止まった** … 同じコマンドをもう一度実行する。送った区間は送り直さない。
- **保存できない** … `termux-setup-storage` を一度実行して、ストレージを許可する。
- **作業フォルダを消したい** … `rm -r ~/.cache/mojiokoshi`(結果の .md・.srt は消えない)。

## 個人情報の扱い

声のある区間の音声は、NVIDIA のサーバーに送られる(物音だけの時間は送らない)。
build.nvidia.com の無料の API は、評価・試作向けの条件(NVIDIA API Trial Terms of
Service)で提供されている。利用者・職員の声や個人を特定できる内容を含む録音に
使う前に、規約の本文と、施設・自治体の個人情報の取り扱いの決まりを確かめること。

## 確認できていること・いないこと

確認できていること(この開発環境・Linux):

- 通信の形: 自前で組み立てた RecognitionConfig・RecognizeRequest・
  StreamingRecognizeRequest が、公式の `nvidia-riva-client` の定義とバイト単位で
  一致する。応答の読み取りも公式の定義で作った応答で確かめた。
- 手元の偽サーバー(Riva と同じ gRPC の形・function-id での振り分け・混雑の
  エラーをわざと返す)を相手に、変換 → 声の検出 → 送信 → 再試行 → 判定 → 保存、
  中断からの再開、確認用モデル(ストリーミング方式)、送り方の自動切り替え、
  キーや function-id の誤りでの停止、`--polish`(偽の LLM サーバー)、フォルダの
  一括処理(同じ名前の wav・mp3 の重複を除く・済みを飛ばす・`--ext`)が動いた。
- 声の検出: 施設の録音に近づけたテスト音源3本(10分ずつ。合成音声と英語の実音声
  60発話を、ドア・食器・掃除機・水・咳・泣き声など ESC-50 の物音120回の中に、
  物音が声より 8〜12dB 大きく重なる場面も含めて配置)で評価した。
  - 元の音声だけで検出: 取りこぼし 15発話 / 物音だけの区間 10
  - 雑音を除いた音声と合わせる(既定): 取りこぼし 11発話 / 物音だけの区間 11
  - 取りこぼしは、声より 8〜12dB 大きい物音が重なった発話と、声より大きい掃除機の
    音の下の発話に集中した(人が聞いても聞き取りにくい条件)

確認できていないこと:

- **NVIDIA の実際の API にはつないでいない**(開発環境から NVIDIA のサーバーに
  つなげないため)。function-id は build.nvidia.com の API ページの例(検索で確認)
  から取った値で、`moji models` で確かめる前提。
- Whisper の日本語の精度、parakeet・canary が日本語に対応しているか。
- BNR(`--denoise bnr`)。NVIDIA の公式クライアント(nim-clients の bnr.py)の
  ストリーミング方式に合わせたが、実際には試していない。失敗すると、雑音除去なしに
  切り替えて続ける。
- Termux の実機での動作と速さ(Termux のパッケージの版は確かめてある:
  python-grpcio 1.84・onnxruntime 1.31。開発環境でも同じ版で動かした)。
- 実際の施設の録音での精度。テスト音源の声の多くは合成音声。

## ライセンス

- このフォルダのプログラムは、このリポジトリの方針に従う。
- Silero VAD のモデルは MIT ライセンス(snakers4/silero-vad)。`setup.sh` が取ってくる
  (このリポジトリには入れない)。
- RNNoise のモデル(GregorR/rnnoise-models の leavened-quisling)は、作者が
  著作権の対象外と明記している。`setup.sh` が取ってくる。
- NVIDIA の API の利用は NVIDIA の規約に従う。
