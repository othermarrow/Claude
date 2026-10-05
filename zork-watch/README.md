# Zork I を Amazfit Balance 2 で遊ぶ（zork-watch）

英語版の『Zork I』を、時計（Zepp OS）の中だけで動かすミニアプリ。
画面には日本語訳と英語の原文を並べて出し、命令は英語で入力する。

- ゲーム本体は、Microsoft が 2025年に MIT ライセンスで公開した
  [historicalsource/zork1](https://github.com/historicalsource/zork1) の `zork1.z3` を使う。
- `zork1.z3` を動かす Z-machine（バージョン3）は JavaScript で書き直した（`shared/zmachine.js`）。
  スマホとの通信はいらない。
- 日本語訳は `zork-ja/` の辞書を使う。辞書にない文は英語だけが表示される（AI 翻訳はなし）。

## 画面

上から順に、次のものが並ぶ。画面を上下にスクロールして使う。

1. 今いる場所（日本語・英語）、得点、手数
2. 入力した命令と、ゲームの返事（日本語の下に英語）
3. 「英語で入力」ボタン：文字のキーボードを開く
   - 上の段の単語（take / open / examine …）は、押すと単語と空白が入る
   - `DEL` で1文字消す。「送る」で命令を送り、「戻る」で取り消す
4. 方角ボタン（北西〜南東、真ん中は「見る」）と、上・下・中・外
5. よく使う命令：持ち物・全部取る・待つ・もう一度・体調・得点・はい/いいえ・セーブ・ロード
6. 「はじめから」：3秒以内に2回押すと最初からになる

## 保存

- 1手ごとに自動で保存する。アプリを閉じても、次に開くと続きから遊べる。
- 「セーブ」「ロード」ボタン（または `save` / `restore` の入力）で、別に1つだけ保存場所を使える。
- 保存したものは時計のアプリ用の場所に置かれる。アプリを消すと一緒に消える。

## 準備（初回だけ）

前提：Termux に Zepp OS の開発ツール `zeus` が入っていて、gh-reader などを `zeus preview` で送れていること。

1. ブラウザで GitHub の `othermarrow/Claude` を開き、`Code` → `Download ZIP` で zip を
   Download フォルダに保存する（ブランチを選んでから保存する）。
2. Termux で次を実行する。`Claude-main` の部分は、保存された zip の名前に合わせて書き換える
   （ブランチを選んだ場合は `Claude-ブランチ名` になる）。

```bash
termux-setup-storage
pkg install -y unzip
cd ~
unzip -o /storage/emulated/0/Download/Claude-main.zip 'Claude-main/zork-watch/*'
rm -rf ~/zork-watch
mv Claude-main/zork-watch ~/zork-watch
rm -rf Claude-main
bash ~/zork-watch/setup.sh
```

3. 時計とスマホをつないだ状態で、時計に送る。

```bash
cd ~/zork-watch
zeus preview
```

表示された QR コードを Zepp アプリ（開発者モード）で読み取ると、時計に入る。

## 補足

- `app.json` の appId `1098766` は仮の番号。preview で弾かれたら、Zepp 開発者サイトで発行した番号に変える。
- 実機ではまだ試していない。パソコン上（Node.js）では、Z-machine の部分で Zork I を動かす
  テスト（ランダムな命令 12,000 手、セーブ・ロード、やり直し）と、画面の流れのテストをした。
  時計で動かして、表示の崩れや遅さがあれば直す。
- 1手の処理はパソコンで数ミリ秒。時計ではもっと遅くなるが、待たされるほどではないと考えている（未確認）。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `page/game/index.js` | 画面（ゲームの表示、ボタン、キーボード） |
| `shared/zmachine.js` | Z-machine（バージョン3）のインタプリタ |
| `shared/translate.js` | ゲームの出力を日本語にする（`zork-ja/zork_ja.py` の訳し方を移植） |
| `shared/dict.js` | 訳の辞書。`zork-ja/data/*.tsv` から自動生成 |
| `shared/store.js` | ゲームファイルの読み込みと、状態の保存 |
| `tools/build-dict.js` | `shared/dict.js` を作り直すスクリプト |
| `setup.sh` | 初回の準備（`zork1.z3` を取ってきて、`npm i`） |

## 辞書を直したとき

`zork-ja/data/*.tsv` を直したら、リポジトリ全体を置いた場所で次を実行して `shared/dict.js` を作り直す。

```bash
node zork-watch/tools/build-dict.js
```
