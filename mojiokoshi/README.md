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
| A | `whisper-v3`(Whisper large-v3) | Groq | Whisper | light |
| B | `whisper-turbo`(Whisper large-v3 turbo、用語集なし) | Groq | Whisper | denoise |
| C | `parakeet`(Parakeet 1.1B RNNT 多言語、ja-JP) | NVIDIA | Parakeet | denoise |
| D | `gemini-transcribe`(Gemini 3.5 Transcribe、逐語・単語の時刻・custom_vocabulary。無料枠は1日25回なので20分ずつ送る) | Gemini | Gemini | light |
| E | `nv-whisper`(Whisper large-v3) | NVIDIA | Whisper | raw |

用語集は Gemini と統合・校正の LLM にだけ渡す。実際の録音で、Whisper はプロンプトの用語を
聞こえていない所に差し込み、Parakeet は単語ブーストで用語の羅列しか出さなくなったため。

話し言葉になっていない出力(仮名が 2 割未満で、同じ漢字の繰り返しか用語集の漢字ばかりのもの)は
区間ごとに捨て、録音の半分以上がそうなったエンジンは、そのファイルでは丸ごと外す
(`要確認.md` の「外したエンジン」に出る)。LLM の統合が無い区間では、`trust`(信頼の重み)を
加えて候補を選ぶ。

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

始める前に、統合・校正の LLM と文字起こしエンジンへごく短い問い合わせを送り、使えるものだけで
処理する(実行前の確かめ)。LLM は「はい」と答えさせ、403(プロジェクトで止められている)・
404(このアカウントで使えない)なら同じ枠の次の候補を試す。上限(429)に当たった枠は今回は使わない。
エンジンには 1.5 秒の音を送る(1日の回数が少ない gemini-transcribe は送らない)。結果は 6 時間
覚えておき(上限に当たったものは 1 時間)、続けて実行しても問い合わせ直さない。

```bash
moji --recheck          # 覚えた結果を捨てて確かめ直す(Groq でモデルを有効にした後など)
moji --no-preflight     # 確かめずに始める
```

`moji` は実行中 `termux-wake-lock` をかける(画面が消えても止まらないように)。
途中で Ctrl-C を押しても、区間ごとに結果を残しているので、もう一度 `moji` で続きから。

## モデル調べ(全部試す)

```bash
mojimodels nvidia            # NVIDIA の一覧のモデルを全部(groq・gemini も指定できる。省略で3つとも)
mojimodels nvidia --quick    # 応答するかだけ(速い)
mojimodels --apply           # 調べ直して、◎ のモデルを点の順に設定へ反映する
mojimodels nvidia gemini --ok-only --apply   # 前回 応答したモデルだけ調べ直して反映(速い)
```

一覧にあるモデルを1つずつ、統合役として同じ試験問題(作り物の2区間。正解の文と、3つのエンジンの
典型的な誤り・聞き落とし・「ご視聴ありがとうございました」を入れた候補)にかけ、正解との一致・
残存(削らなかったか)・追加(足さなかったか)・定型句を消したかで採点する。応答しない・使えない
(403・404)ものは理由を書く。結果は `Output/モデル調査_日時.md`。1 個あたり最長 2 分、同時に 3 個まで。

試験は4区間(1.9 から)で、候補の多数決(系統の違う2つが一致する方を選ぶ)・1つの候補にしか
無い本物の発言を残す・動画の定型句と同じ語の繰り返しを消す・用語集の表記(PECS)を見る。
結果はサービスごとに最新の回を覚えておき、`--apply` は今回調べなかったサービスの前回の結果も
合わせて反映する(サービスを分けて調べても、前の結果が消えない)。

`--apply` は ◎(点 0.85 以上・残存 90% 以上・定型句を消した・40 秒以内)のモデルを、サービスごとに点の順に
並べて `~/.config/mojiokoshi/models_ranked.py` に書き、統合・校正はそれを使う(消せば既定に戻る)。
`config_local.py` に `MERGE_MODELS` などがあると、そちらが優先される。Gemini を調べると、
1 日の回数の少ないモデルの枠を使うので注意。1 回だけの試験なので、点は目安。

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
`kept` は残存率: 区間ごとに最も信頼できる音声認識の候補の内容のうち、最終稿に残った割合(読みで比べる)。
統合・校正で言葉が削られていないかの目安で、0.9 を大きく下回るなら `要確認.md` の「候補の内容の残り」を見る。
統合は候補の内容を 8 割以上(`MERGE_MIN_KEEP`)、校正は元の長さを 92% 以上(`PROOF_MIN_KEEP`)残して
いなければ使わない。
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
| `HTTP 403: error code: 1010`(Groq) | 前段の Cloudflare に機械アクセスとして弾かれた。1.1 で名乗り(User-Agent)を付けて直した。古い版なら `mojiup` で更新 |
| `この curl は HTTP/2 に対応していません` | `pkg upgrade curl` |
| `pykakasi が無いので…` | `pip install pykakasi`(無くても動く) |
| 小さい声の所が抜ける | `VAD_MARGIN_DB=4 moji --fresh 名前`(声の検出をゆるめる) |
| 〔?〕が多すぎる | `UNSUPPORTED_MIN_CHARS` を上げる。用語集に固有名詞を足す |
| 上限で止まる | 時間をおいて `moji --force 名前`(済んだ分は使い回す)。Groq の 1時間あたりの上限は 20 分まで待つ(`MAX_WAIT_SEC`) |
| `HTTP 403: The model ... is blocked at the project level`(Groq) | Groq のプロジェクトでそのモデルが止められている。Chrome で console.groq.com を開き、プロジェクトの設定(エラーに出る URL)でモデル(gpt-oss・qwen)を有効にする |
| `HTTP 404: Function ... Not found for account`(NVIDIA) | 一覧に載っていても、このアカウントでは配信されていないモデル。1.3 から同じ枠の次の候補へ自動で切り替わる |
| 統合が 1 つも動かない(フロントマターの `merge_models: []`) | `mojilog 300` の「✗ 統合」の行を見る。上限なら時間をおく |
| 途中で止まったように見える | 1.6 から、応答を待っている問い合わせを 1 分ごとに「… 応答待ち」と表示する。応答しないモデルは 1 回送り直して外す(以前は最悪 30 分以上、何も表示せずに待っていた)。`mojilog 30` で最後の表示を見る |
| 動きを確かめたい | `python ~/mojiokoshi/mojiokoshi.py selftest`(通信しない自己点検) |

## 確認状況

- 確認済み(開発環境): 自己点検 13 項目。偽の API サーバー(Groq・Gemini・NVIDIA の形式を真似たもの)と、
  NVIDIA の公式の定義(riva_asr.proto)から作った偽の gRPC サーバーに対して、前処理から出力までの
  通しの動き、curl(HTTP/2・暗号化あり/なし)と grpcio の両方での NVIDIA への送受信、
  一括→ストリーミングへの自動切り替え、上限に達したときの代わりのモデルへの切り替え、
  途中経過の使い回し
- 実機(2026-10、Xperia 1 IV の Termux、1時間47分の会話の録音、1.1 で実行):
  - whisper-v3 は全 170 区間、gemini-transcribe は最初の 19 区間で上限(429)、whisper-turbo は 64 区間で
    Groq の 1時間あたりの音声の上限(429)。nv-whisper は 0 区間(原因は記録に残らず。1.2 で記録するようにした)
  - parakeet は単語ブーストのせいで用語の羅列とキリル文字だけになり、羅列が最終稿に 3 か所入った(1.2 で修正。
    同じ結果を 1.2 の照合に通すと、parakeet は丸ごと外れ、羅列は最終稿に残らないことを確かめた)
  - 統合の LLM 4 つがどれも結果を返さず、校正は代わりの gemini-3.5-flash-lite だけが動いた。
    原因は未確認(ログが要る)。1.2 では、統合が返らない区間を代わりの LLM(`MERGE_BACKUPS`)に回す
- 実機(1.2 で同じ録音を作り直し、20 分 46 秒): parakeet は単語ブーストを外すと全 170 区間で普通の文になり、
  一致度の平均は 0.14 → 0.76。統合は gemini(8 区間で 429)のあと代わりの gemini-3.5-flash-lite が残り
  162 区間を担当。分かった原因と 1.3 での対処:
  - nv-whisper: Android の Python に `os.link` が無く落ちていた → 使わないようにした
  - whisper-turbo: Groq の 1 分 20 回の上限はプロジェクト全体で共有で、Whisper 2 つが別々に 18 回/分
    送っていた → 2 つで 18 回/分を分け合う。1 分あたりの上限では諦めずに待つ
  - gpt-oss・qwen(Groq): プロジェクトの設定でモデルが止められていた(403) → 利用者が設定で有効にする
  - nemotron(NVIDIA): このアカウントでは配信されていない(404) → 次の候補へ自動で切り替える
  - gemini-transcribe: 無料枠は 1 日 25 回 → 1 回に送る長さを 20 分にした(1 時間 47 分で 6 回)
- 実機(1.4): 「かなり削られている」との報告。統合役が gemini-lite 1 つだけ動いた回で、統合の採否が
  「足した言葉」しか見ておらず、指示も 1 つの候補にしか無い語句を消しやすい書き方で、校正も 2 割近い
  削除を通していた → 1.5 で、削った統合・校正を使わない検証と残存率(`kept`)を足し、指示を
  「削らない・迷ったら残して〔?〕」に改めた
- 未確認: 1.3〜1.5 での実機の動作、統合の LLM が複数動いたときの精度

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
| `preflight.py` | 実行前の確かめ(使える LLM・エンジンだけを選ぶ) |
| `bench.py` | モデル調べ(一覧のモデルを全部、統合役として採点する) |
| `selftest.py` | 通信しない自己点検 |
| `.mojiokoshi.sh` | 補助コマンド(`moji` など。`~/.mojiokoshi.sh` に置く) |
| `update_mojiokoshi.sh` | `mojiup` の中身。Download の最新の `mojiokoshi*.zip` で入れ替える |
