# 日本語で遊ぶ Zork I(zork-ja)

英語版の『Zork I』を Termux で日本語で遊ぶためのプログラム。
英語版のゲームは裏で動かしたまま、画面に出る文章を日本語に訳し、
日本語で入力した命令を英語に直してゲームに渡す。

- ゲームの文章は、辞書(`data/`)で日本語にする。
- 辞書にない文は、Gemini API キーがあれば AI で訳す。訳した文は保存しておき、2回目からは通信しない。
- キーがなければ、辞書にない文だけ英語のまま表示される。
- ゲーム本体は、Microsoft が 2025年に MIT ライセンスで公開した
  [historicalsource/zork1](https://github.com/historicalsource/zork1) のものを使う。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `zork_ja.py` | 本体。ゲームを動かし、出力の翻訳と命令の変換をする |
| `setup.sh` | 初回の準備。パッケージを入れ、`dfrotz` をビルドし、ゲームファイルを取ってくる |
| `data/names.tsv` | 部屋と物の名前(英語→日本語) |
| `data/messages.tsv` | 文の対訳(英語の一文→日本語) |
| `data/patterns.tsv` | 決まった形の文の訳し方(「There is a ○○ here.」など) |
| `data/verbs.tsv` | 日本語の動詞→英語の命令 |
| `data/nouns.tsv` | 日本語の名詞→英単語 |

`setup.sh` を実行すると、`bin/dfrotz` と `game/zork1.z3` ができる(どちらも Git には入れない)。
セーブデータと AI 翻訳の保存先は `~/.zork-ja/` にある。

## 準備(初回だけ)

1. ブラウザで GitHub の `othermarrow/Claude` を開き、`Code` → `Download ZIP` で zip を
   Download フォルダに保存する(ブランチを選んでから保存する)。
2. Termux で次を実行する。`Claude-main` の部分は、保存された zip の名前に合わせて書き換える
   (ブランチを選んだ場合は `Claude-ブランチ名` になる)。

```bash
termux-setup-storage
pkg install -y unzip
cd ~
unzip -o /storage/emulated/0/Download/Claude-main.zip 'Claude-main/zork-ja/*'
rm -rf ~/zork-ja
mv Claude-main/zork-ja ~/zork-ja
rm -rf Claude-main
bash ~/zork-ja/setup.sh
```

`setup.sh` では、frotz(2.55)をスマホ上でビルドする。数分かかることがある。

毎回の入力を短くしたいときは、`zork` という名前で起動できるようにしておく。

```bash
cat >> ~/.bashrc <<'EOF'
alias zork='python ~/zork-ja/zork_ja.py'
EOF
source ~/.bashrc
```

### AI 翻訳を使う場合(任意)

[Google AI Studio](https://aistudio.google.com/apikey) で Gemini API キーを作り、
次のファイルに保存する。Gemini アプリの有料プランとは別物で、API キーが必要になる。
無料枠のキーで送った文は、Google のサービス改善に使われることがある。

```bash
mkdir -p ~/.zork-ja
cat > ~/.zork-ja/gemini_key <<'EOF'
ここにAPIキー
EOF
chmod 600 ~/.zork-ja/gemini_key
```

モデルは `gemini-2.5-flash` を使う。使えない場合は、`GEMINI_MODEL` で別のモデル名を指定する。

```bash
GEMINI_MODEL=gemini-2.5-flash-lite python ~/zork-ja/zork_ja.py
```

## 遊び方

```bash
python ~/zork-ja/zork_ja.py      # alias を作っていれば zork
```

命令は日本語でも英語でも入力できる。日本語の命令は、ゲームに渡す英語がかっこ書きで表示される。

| やりたいこと | 入力の例 |
|---|---|
| 移動 | `北` `南西` `上` `下` `中に入る` `東へ行く` |
| 見る | `見る`(周りを見る) `チラシを読む` `剣を調べる` `郵便受けの中を見る` |
| 物を扱う | `ランプを取る` `全部取る` `袋を置く` `絵をトロフィー棚に入れる` |
| 開け閉め | `郵便受けを開ける` `窓を開ける` `格子を鍵で開ける` |
| 明かり | `ランプをつける` `ランプを消す` |
| 戦う | `剣でトロールを攻撃` `トロールを剣で殺す` |
| そのほか | `持ち物` `待つ` `得点` `セーブ` `ロード` `やり直す` `終了` |

- `:en` … 英語の原文表示に切り替える(もう一度入力すると日本語に戻る)。
- `:help` … 遊び方を表示する。
- セーブ・ロードでファイル名を聞かれたら、英数字で入力する。何も入れずに Enter を押すと既定の名前(`zork1.qzl`)になる。
- 日本語の命令が変換できないときは、AI 翻訳が使えればそれで変換する。だめなら言い方を変えるか、英語で入力する。

## 辞書を育てる

- 訳がおかしい文や英語のまま出る文は、`data/messages.tsv` に
  `英語の一文<TAB>日本語` の形で足す。文の単位で照合する。
- AI で訳した文は `~/.zork-ja/cache.tsv` にたまる。よい訳はそこから `messages.tsv` に移すと、
  キーがなくても日本語で出るようになる。
- 通じない日本語の命令は、`data/verbs.tsv`(動詞)と `data/nouns.tsv`(名詞)に足す。

## 確認できていること・いないこと

- この開発環境(Linux)で、ビルドから起動、日本語の命令、翻訳表示、セーブ・ロードまで動いた。
- Termux の実機では、まだ確かめていない。
- Gemini API で訳す部分は、実際の API にはつないで確かめていない(偽の応答で処理の流れだけ確認した)。
- 辞書で訳せる範囲は、自動で約100部屋を回り、いろいろな命令を試して出た文まで広げた
  (よくある返事、戦闘、ダム、神殿、地獄の入口、川など)。ゲームの終盤(死者の国、機械室、最後の場面など)は、
  まだ AI 翻訳か英語になることがある。
- `patterns.tsv` の `{1}` に辞書にない名前が入るときは、短い名前ならその部分だけ英語のまま訳文に入れる。

## ライセンス

- このフォルダのプログラムと辞書は、このリポジトリの方針に従う。
- Zork I のゲームファイルは MIT ライセンス(Copyright (c) 2025 Microsoft)。`setup.sh` が `game/LICENSE` に保存する。
- frotz は GPL。`setup.sh` が公式リポジトリからビルドする(このリポジトリには入れない)。
