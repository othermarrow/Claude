# 文字起こし(mojiokoshi)

録音状態の悪い音声を、**仕組みの違う複数の文字起こしエンジン**で書き起こし、
**複数の LLM** で突き合わせて1つの原稿にする。Groq・NVIDIA・Gemini の無料 API で動く。
Termux だけで完結する(PC は要らない)。

- 入力: `/storage/emulated/0/Converter` の音声(m4a・mp3・wav・aac・ogg・opus・flac・amr・3gp・mp4 など)
- 出力: `/storage/emulated/0/Converter/Output`
- 用語集: `/storage/emulated/0/Converter/用語.txt`

> **個人情報について**: 無料枠の API に送った音声・文字は、サービス側に保存されたり、
> 製品の改善に使われたりすることがあります(Gemini の無料枠は、送った内容が Google の
> 製品改善に使われると料金ページに書かれています)。利用者さんの個人情報に関わる録音は、
> 職場の規程と各サービスの利用規約を確かめてから使ってください。

## しくみ

| 段階 | すること | 幻覚(ハルシネーション)への備え |
|---|---|---|
| 1. 前処理 | ffmpeg で 16kHz モノラルにし、エンジンごとに違う雑音処理(`light`・`denoise`・`raw`)をかける | 同じ処理だと誤りが重なるので、わざと変える |
| 2. 区切り | 声の切れ目で 40 秒前後の区間に分ける | 4 秒以上の無音は送らない(Whisper は無音で「ご視聴ありがとうございました」を書きがち)。区間は録音全体を隙間なく覆うので、小さい声も落とさない |
| 3. 文字起こし | 下の 5 つのエンジンが同じ区間を別々に書き起こす | Whisper の区間ごとの指標(無音らしさ・確からしさ・繰り返し)で捨てる/畳む。声の無い時刻に出た文を捨てる |
| 4. 照合 | 区間ごとに、エンジン同士の一致を読み(ひらがな)で測る | 「系統」の違うエンジンに無い動画の定型句を消す。1つだけ大きく違う候補に「外れ値」、字数が多すぎる候補に「多すぎる」と注記する |
| 5. 統合 | LLM 4つが**それぞれ独立に**候補を読み比べて本文を復元する | 候補に無い言葉を足さない・決めきれない語に〔?〕を付ける、と指示する |
| 6. 合議 | 区間ごとに最良の統合を選ぶ | 「音声認識の候補に根拠がある割合」「2系統以上が一致した内容を落としていない割合」「LLM 同士の一致」で採点。選んだ統合のうち、どの候補にも無い連なりには〔?〕を付ける。根拠の薄い統合は捨てて音声認識の候補を使う |
| 7. 校正 | LLM 2つが句読点・誤変換・フィラー・段落を整え、良いほうを選ぶ | 元の文との一致が 0.85 未満・1.15 倍より長い・〔?〕が消えた・元にも候補にも無い言葉が入った校正は使わない |
| 8. 出力 | Markdown(時刻つき)・テキスト・字幕・比較表・要確認の一覧 | 一致度の低い区間と〔?〕のある区間を「要確認」に時刻つきで挙げる |

それでも幻覚が「ゼロ」になる保証はない。〔?〕と「要確認.md」の時刻を手がかりに、
大事な所は録音を聞き直すこと。

### 文字起こしエンジン(既定)

| 候補 | エンジン | サービス | 系統 | 前処理 |
|---|---|---|---|---|
| A | `whisper-v3`(Whisper large-v3、用語集をプロンプトで渡す) | Groq | Whisper | light |
| B | `whisper-turbo`(Whisper large-v3 turbo、用語集なし) | Groq | Whisper | denoise |
| C | `parakeet`(Parakeet 1.1B RNNT 多言語、ja-JP、用語集で単語ブースト) | NVIDIA | Parakeet | denoise |
| D | `gemini-transcribe`(Gemini 3.5 Transcribe、逐語・単語の時刻・custom_vocabulary) | Gemini | Gemini | light |
| E | `nv-whisper`(Whisper large-v3) | NVIDIA | Whisper | raw |

ほかに `nemotron-asr`(Nemotron 3.5 ASR、40言語・ストリーミング)と `gemini-flash-asr`
(Gemini 3.8 Flash に聞かせる)を用意してある(既定では無効)。使えないエンジンは自動で外れ、
残りで動く。

### 統合・校正の LLM(既定)

`config.py` の `LLMS` に候補を書いてあり、そのサービスのモデル一覧にある最初のものを使う。

| 名前 | サービス | 候補(上から順に) |
|---|---|---|
| gemini | Gemini | gemini-3.8-flash → 3.6-flash → 3.5-flash → … |
| gpt-oss | Groq | openai/gpt-oss-120b → gpt-oss-20b |
| qwen | Groq | qwen/qwen3.8-27b → qwen3.6-27b → qwen3-32b → kimi-k2 |
| nemotron | NVIDIA | nemotron-3-super-120b-a12b → nemotron-3-ultra → gpt-oss-120b |
| gemini-lite | Gemini | gemini-3.5-flash-lite → 2.5-flash-lite(校正の代わり用) |

統合は `MERGE_MODELS`(既定 4 つ)、校正は `PROOF_MODELS` の先頭 `PROOF_COUNT`(既定 2)つ。
校正役が上限に達したら、残りの区間を次の候補に回す。

## 準備(初回だけ)

### 1. 道具を入れる

```bash
pkg install python ffmpeg curl unzip
pip install pykakasi
termux-setup-storage
```

`pykakasi` は読みをそろえて比べるため(「子供/子ども/こども」を同じとみなす)。無くても動くが、
一致の測り方が厳しくなる。`grpcio` は要らない(NVIDIA には curl の HTTP/2 で送る)。

### 2. ファイルを置く

送られてきた `mojiokoshi.zip` を Download に置いて:

```bash
mkdir -p ~/mojiokoshi
unzip -o /storage/emulated/0/Download/mojiokoshi.zip -d ~
cp ~/mojiokoshi/.mojiokoshi.sh ~/.mojiokoshi.sh
grep -q mojiokoshi.sh ~/.bashrc || echo '[ -f ~/.mojiokoshi.sh ] && . ~/.mojiokoshi.sh' >> ~/.bashrc
source ~/.bashrc
```

### 3. API キー

```bash
mkdir -p ~/.config/mojiokoshi
cat > ~/.config/mojiokoshi/keys.env << 'EOF'
GROQ_API_KEY=gsk_ここにキー
NVIDIA_API_KEY=nvapi-ここにキー
GEMINI_API_KEY=ここにキー
EOF
chmod 600 ~/.config/mojiokoshi/keys.env
```

NVIDIA のキーが `~/.config/research_bot/keys.env` にあれば、書かなくてもそれを使う。
環境変数があればそちらが優先。

### 4. 確かめる

```bash
mojicheck
```

キー・モデル・各エンジンに 1.5 秒の音を送って、使えるかを ✓ / ✗ で表示する。
`mojicheck --deep` で LLM にも実際に問い合わせる。

**`nv-whisper` が ✗ のとき**: function-id が変わっている。スマホの Chrome で
`build.nvidia.com/openai/whisper-large-v3` を開き、API の例の `function-id` の値を
次のように書く(`parakeet` も同じ。Nemotron を使うときは `enabled` も):

```bash
cat > ~/.config/mojiokoshi/config_local.py << 'EOF'
engine("nv-whisper")["function_id"] = "ここに値"
# engine("nemotron-asr")["function_id"] = "ここに値"
# engine("nemotron-asr")["enabled"] = True
EOF
```

`config_local.py` は更新(`mojiup`)で消えない。ほかの設定もここで変えられる
(例: `FILLER_MODE = "keep"`、`MERGE_MODELS = ["gemini", "gpt-oss"]`)。

## 使い方

```bash
moji                    # Converter の音声をすべて(書き出し済みは飛ばす)
moji 会議.m4a            # 指定したファイルだけ
moji --force 会議.m4a    # 作り直す(途中経過を使い回し、欠けた分だけ問い合わせる)
moji --fresh 会議.m4a    # 途中経過も捨てて最初から
moji --no-proof         # 校正しない
moji --no-llm           # LLM を使わない(音声認識の候補から選ぶだけ)
moji --engines whisper-v3,whisper-turbo,parakeet   # エンジンを選ぶ
moji --merge gemini,gpt-oss --proof gpt-oss       # LLM を選ぶ
mojilist                # 入力フォルダの一覧(✓ は書き出し済み)
mojilog                 # 最新のログ
mojihelp                # コマンドの一覧
```

`moji` は実行中 `termux-wake-lock` をかける(画面が消えても止まらないように)。
途中で Ctrl-C を押しても、区間ごとに結果を残しているので、もう一度 `moji` で続きから。

## 出力

`Output/` に、音声ファイルと同じ名前で書き出す。

| ファイル | 中身 |
|---|---|
| `名前.md` | 最終稿(Obsidian 用のフロントマターつき。段落の頭に時刻) |
| `名前.txt` | 最終稿(時刻なし) |
| `名前_詳細/要確認.md` | 聞き直したほうがよい区間の一覧(時刻・理由・本文) |
| `名前_詳細/比較.md` | 区間ごとの全候補・捨てた部分と理由・各 LLM の統合と点数・採用と校正の結果 |
| `名前_詳細/統合_校正前.txt` | 校正前の統合結果(フィラーや言い直しが残る、逐語に近い版) |
| `名前_詳細/A_whisper-v3.txt` など | 各エンジンの生の結果(時刻つき) |
| `名前_詳細/名前.srt` | 字幕(区間ごと) |
| `名前_詳細/名前_記号なし.txt` | 〔?〕〔聞き取れず〕を取った版 |

フロントマターの `agreement` は系統の違うエンジン同士の一致度の平均(0〜1)。
`status: 一部のエンジン欠け` は、上限などで返らなかったエンジンがある印。時間をおいて
`moji --force 名前` を実行すると、欠けた分だけ問い合わせて作り直す。

記号の意味:

- `〔?〕` … 直前の語は、候補が割れて決めきれなかったか、どの候補にも無い言葉
- `〔聞き取れず〕` … どの候補も聞き取れていない所

## 用語集(用語.txt)

1行に1語。

```text
# で始まる行は無視
強度行動障害
PECS(ペクス)
TEACCH, ティーチ, 構造化
ぺくす、ペクス → PECS
```

- `用語(読み・説明)` や `用語, メモ, メモ` … 2つ目以降は LLM へのメモ
- `誤 → 正` … 誤認識の直し方。最後に必ず置き換える(`→` `->` `=>` が使える。左は `、` で複数)
- 上のほうの語ほど優先して Whisper のプロンプト(150 字まで)に入る。NVIDIA・Gemini には先頭 100 語

## 主な設定(config.py)

| 項目 | 既定 | 意味 |
|---|---|---|
| `ENGINES` | 上の表 | 文字起こしエンジン。`enabled=False` で外す |
| `MERGE_MODELS` | gemini, gpt-oss, qwen, nemotron | 統合に使う LLM(2〜5 個) |
| `PROOF_MODELS` / `PROOF_COUNT` | gemini, gpt-oss, … / 2 | 校正に使う LLM |
| `FILLER_MODE` | remove | 最終稿でフィラーを消す(`keep` で残す) |
| `CHUNK_TARGET_SEC` / `MAX` / `MIN` | 40 / 60 / 8 | 区間の長さ |
| `SILENCE_SKIP_SEC` | 4.0 | これ以上の無音は送らない |
| `VAD_MARGIN_DB` | 6.0 | 声とみなす音量(雑音の床からの dB)。小さい声が落ちるなら下げる |
| `AUDIO_PROFILES` | light / denoise / raw | 前処理のフィルタ |
| `UPLOAD_FORMAT` | flac | Groq・Gemini に送る形式。`opus` で通信量が約 1/5(わずかに劣化) |
| `UNSUPPORTED_MIN_CHARS` | 5 | どの候補にも無い連なりがこの字数(読み)以上なら〔?〕 |
| `PROOF_MIN_SIMILARITY` | 0.85 | 校正を使う最低の一致度 |
| `RPM` | groq 18 / nvidia 35 / gemini 8 | 1 分あたりの送信上限 |
| `MAX_WAIT_SEC` | 180 | 429 でこれ以上待てと言われたら、そのモデルは今回は使わない |

数値・文字列の設定は、環境変数で 1 回だけ変えられる(例: `CHUNK_TARGET_SEC=30 moji`)。

## 1 時間の録音で使う回数の目安

区間 40 秒・既定の設定で、およそ:

| サービス | 回数 |
|---|---|
| Groq | Whisper 2 種 × 90 回、gpt-oss・qwen の統合 各 30 回、校正 15 回 |
| NVIDIA | Parakeet 90 回、Whisper 90 回、nemotron の統合 23 回 |
| Gemini | 文字起こし 6 回(10 分ずつ)、統合 12 回、校正 15 回 |

無料枠の上限(1 日の回数・トークン数・音声の秒数)はサービスとモデルごとに違い、よく変わる。
上限に達したモデルはその回は外れ、残りのモデルで続ける。通信量は flac で 1 時間あたり
数百 MB になるので、Wi-Fi で使うのがよい。

## 困ったとき

| 症状 | 対処 |
|---|---|
| `✗ nv-whisper: gRPC 5` / `HTTP 404` | function-id が違う。上の「4. 確かめる」 |
| `この curl は HTTP/2 に対応していません` | `pkg upgrade curl` |
| `pykakasi が無いので…` | `pip install pykakasi`(無くても動く) |
| 小さい声の所が抜ける | `VAD_MARGIN_DB=4 moji --fresh 名前`(声の検出をゆるめる) |
| 〔?〕が多すぎる | `UNSUPPORTED_MIN_CHARS` を上げる。用語集に固有名詞を足す |
| 上限で止まる | 時間をおいて `moji --force 名前`(済んだ分は使い回す) |
| 動きを確かめたい | `python ~/mojiokoshi/mojiokoshi.py selftest`(通信しない自己点検) |

## 確認状況

- 確認済み(開発環境): 自己点検 12 項目。偽の API サーバー(Groq・Gemini・NVIDIA の形式を真似たもの)と、
  NVIDIA の公式の定義(riva_asr.proto)から作った偽の gRPC サーバーに対して、前処理から出力までの
  通しの動き、curl(HTTP/2・暗号化あり/なし)と grpcio の両方での NVIDIA への送受信、
  一括→ストリーミングへの自動切り替え、上限に達したときの代わりのモデルへの切り替え、
  途中経過の使い回し
- 未確認: 実際の Groq・NVIDIA・Gemini の API での動作(開発環境から届かないため)、Termux 上での動作、
  実際の録音での精度。gemini-3.5-transcribe の送り方は公式 SDK(google-genai 2.33)の定義に合わせた。
  NVIDIA の Whisper の function-id は記憶による値なので、`mojicheck` で確かめること

## ファイル構成

| ファイル | 役割 |
|---|---|
| `config.py` | 設定(自分用の上書きは `~/.config/mojiokoshi/config_local.py`) |
| `mojiokoshi.py` | 入口と全体の流れ(照合・合議・校正の検証・出力) |
| `audio.py` | ffmpeg での前処理・声の検出・区切り・送る音声の切り出し |
| `asr.py` | 文字起こしエンジン(Groq・NVIDIA の gRPC・Gemini) |
| `llm.py` | 統合・校正の LLM とプロンプト |
| `textproc.py` | 読みでの比較・幻覚の検出・〔?〕付け・用語集 |
| `net.py` | API キーと HTTP(送信間隔・再試行・上限の見分け) |
| `selftest.py` | 通信しない自己点検 |
| `.mojiokoshi.sh` | 補助コマンド(`moji` など。`~/.mojiokoshi.sh` に置く) |
| `update_mojiokoshi.sh` | `mojiup` の中身。Download の最新の `mojiokoshi*.zip` で入れ替える |
