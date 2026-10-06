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

- はじめは日本語と英語を併記する。訳した行のすぐ下に、英語の原文が灰色で出る。部屋の名前も「家の西(West of House)」のように両方出る。
- `:both` … 日本語と英語を併記する(はじめはこれ)。
- `:ja` … 日本語だけにする。
- `:en` … 英語だけにする(AI 翻訳も使わない)。
- 起動時から切り替えたいときは `ZORK_JA_MODE=ja python ~/zork-ja/zork_ja.py` のように指定する(`both`・`ja`・`en`)。
- 灰色が見えにくいときは `NO_COLOR=1` を付けて起動すると、色なしで出る。
- `:help` … 遊び方を表示する。
- セーブ・ロードでファイル名を聞かれたら、英数字で入力する。何も入れずに Enter を押すと既定の名前(`zork1.qzl`)になる。
- 日本語の命令が変換できないときは、AI 翻訳が使えればそれで変換する。だめなら言い方を変えるか、英語で入力する。

## 辞書を育てる

- 訳がおかしい文や英語のまま出る文は、`data/messages.tsv` に
  `英語の一文<TAB>日本語` の形で足す。文の単位で照合する。
- AI で訳した文は `~/.zork-ja/cache.tsv` にたまる。よい訳はそこから `messages.tsv` に移すと、
  キーがなくても日本語で出るようになる。
- 通じない日本語の命令は、`data/verbs.tsv`(動詞)と `data/nouns.tsv`(名詞)に足す。

## ブラウザ版(Termux 不要)

`web/zork-ja.html` は、ゲームの実行・翻訳・命令の変換をすべてブラウザの中で行う版。
claude.ai のページとして公開してあり、Termux を起動しなくても遊べる。

- ページ: https://claude.ai/artifact/AzWbvM2cR6RrpRRgP1RUkA(本人だけが開ける)
- ホーム画面に置く: Chrome でページを開き、メニューの「ホーム画面に追加」を選ぶ。
- 見た目: 元祖 ZORK の画面(黒地・灰色の文字・反転した状態行)を、日本語も読めるドット書体で描き直したもの。
- 表示: 右上の ≡ から「日本語＋英語」「日本語だけ」「英語だけ」を選べる。
- 下のボタンで、移動や「見る」「持ち物」などをタップだけで入力できる。
- 辞書にない文は、Claude に訳してもらう(初回に許可を求められる。使うのは開いた人の Claude の利用枠)。
  訳した文はその端末に残り、2回目からは Claude を使わない。メニューで「使わない」にもできる。
- セーブは1か所。claude.ai の保存領域に残り、別の端末で開いてもロードできる。
- 途中の画面はその端末に自動で残り、次に開いたときに続きから始まる。

### Tasker のシーンで遊ぶ(ホーム画面から起動)

`web/zork-ja-standalone.html` を Tasker のシーンの Webビューで開く。claude.ai の外なので、
辞書にない文の翻訳は Gemini API キー(≡ の設定で入れる)があれば Gemini で行う。キーがなければ英語のまま出る。
セーブと途中の画面は `Tasker/zork-ja/zork-ja-data.json` に保存する(「電話へのアクセスを許可」が必要)。一度保存すると、Tasker の変数 `%ZORKJA` が `1` になる。この変数がある間に `zork-ja-data.json` を消すと、起動時に Tasker のエラーが出るので、消すときは変数も消す。

1. ファイルを置く。Termux で次を実行する。

```bash
mkdir -p /storage/emulated/0/Tasker/zork-ja
cp /storage/emulated/0/Download/zork-ja-standalone.html /storage/emulated/0/Tasker/zork-ja/zork-ja.html
```

2. Tasker の「シーン」(Scenes)タブで「＋」を押し、名前を `Zork` にする。
3. シーンの編集画面で、右下の角をドラッグして画面いっぱいの大きさにする。
4. 要素を追加して「Webビュー」(Web View)を選び、次のように設定する。
   - モード(Mode): ファイル(File)
   - ソース(Source): `/storage/emulated/0/Tasker/zork-ja/zork-ja.html`
   - 電話へのアクセスを許可(Allow Phone Access): オン
   設定を閉じたら、Webビューをシーンいっぱいに広げる。
5. 「タスク」(Tasks)タブで「＋」を押し、名前を `Zorkを遊ぶ` にする。アクション「シーン」→「シーンを表示」(Show Scene)を追加し、
   名前に `Zork`、表示方法(Display As)に「アクティビティ, 全画面」(Activity, Full Window)などを選ぶ。
6. ホーム画面を長押し →「ウィジェット」→ Tasker の「タスクショートカット」(Task Shortcut)→ `Zorkを遊ぶ` を選ぶ。

Tasker にファイルへのアクセス(すべてのファイルの管理)を許可していないと、`Tasker/zork-ja/` に保存できない。
その場合も遊べるが、セーブが残らないことがある。画面の名前は Tasker の版によって少し違うことがある。

作り直すときは `python web/build.py` を実行する。`web/src/` のファイルと `data/*.tsv` を
1枚の `web/zork-ja.html` にまとめる。

| ファイル | 役割 |
|---|---|
| `web/src/zmachine.js` | ゲームファイル(Z マシン バージョン3)を動かす部分 |
| `web/src/translate.js` | 辞書による翻訳と、日本語の命令の変換(Termux 版と同じ動き) |
| `web/src/app.js` | 画面・入力・セーブ・Claude による翻訳 |
| `web/src/page.html` | 画面の作りと見た目 |
| `web/build.py` | 上のファイルと辞書・ゲームファイルを1枚の HTML にまとめる |
| `web/zork-ja.html` | claude.ai に公開する版 |
| `web/zork-ja-standalone.html` | Tasker のシーンやブラウザで直接開く版 |

## 確認できていること・いないこと

- この開発環境(Linux)で、ビルドから起動、日本語の命令、翻訳表示、セーブ・ロードまで動いた。
- Termux の実機では、まだ確かめていない。
- ブラウザ版は、開発環境の Chromium で、命令の入力・翻訳表示・表示の切り替え・セーブとロードまで動いた。
  ゲームを動かす部分は、Termux 版(dfrotz)と同じ命令で同じ出力になることを確かめた。
  claude.ai の中での Claude による翻訳と、claude.ai へのセーブは、まだ実機で確かめていない。
- Tasker 向けの保存(readFile / writeFile)と Gemini での翻訳は、開発環境で偽の Tasker 関数・偽の Gemini 応答を
  使って流れを確かめただけで、Tasker の実機と本物の Gemini API ではまだ確かめていない。
- Gemini API で訳す部分は、実際の API にはつないで確かめていない(偽の応答で処理の流れだけ確認した)。
- 辞書で訳せるのは、ゲームの序盤(家のまわり・地下室・トロールの部屋あたり)と、部屋・物の名前、
  よく出る応答が中心。それ以外は AI 翻訳か英語になる。

## ライセンス

- このフォルダのプログラムと辞書は、このリポジトリの方針に従う。
- Zork I のゲームファイルは MIT ライセンス(Copyright (c) 2025 Microsoft)。`setup.sh` が `game/LICENSE` に保存する。
- frotz は GPL。`setup.sh` が公式リポジトリからビルドする(このリポジトリには入れない)。
