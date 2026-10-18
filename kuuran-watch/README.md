# 空欄を Amazfit Balance 2 で遊ぶ（kuuran-watch）

テキストアドベンチャー「空欄」（`kuuran/`）を、時計（Zepp OS）の中だけで動かすミニアプリ。
話・仕掛け・結末は HTML 版と同じ。スマホとの通信はいらない。

## 画面

上から順に並ぶ。画面を上下にスクロールして使う。

1. 今いる場所、曜日、体温
2. 直前までの命令（3つ）、今の命令と、その結果
3. 「命令を作る」：動詞 → 物（→ 2つ目の物）、「言う」「書く」はことば、の順にタップする
4. 方角（上・北・西・見る・東・南・下）。行ける方角だけ明るい
5. よく使う命令：持ち物・待つ・耳をすます・寝る・わからない・遊び方
6. 「はじめから」：3秒以内に2回押すと最初からになる

文字の入力はない（全部タップで遊べる）。部屋によって、画面の色が変わる。

## 保存

- 1手ごとに自動で保存する。アプリを閉じても、次に開くと続きから遊べる。
- 時計のアプリ用の場所に `kuuran.json`（状態）と `kuuran-loop.json`（周回の記録。はじめからやり直しても残る）を置く。アプリを消すと一緒に消える。
- HTML 版の保存とはつながっていない。

## 準備（初回だけ）

前提：Termux に Zepp OS の開発ツール `zeus` が入っていて、zork-watch や gh-reader を `zeus preview` で送れていること。

1. ブラウザで GitHub の `othermarrow/Claude` を開き、ブランチ `ccr-d4f31da7-u5hlbp` を選んでから `Code` → `Download ZIP` で zip を Download フォルダに保存する。
   保存された名前は `ls /storage/emulated/0/Download/ | grep -i claude` で確かめられる（`(1)` が付くことがある）。
2. zeus を使っている環境（Termux、または Termux の中の root 環境）で次を実行する。zip の名前が違うときは `Claude-ccr-d4f31da7-u5hlbp` の部分を書き換える。
   `pkg` は root では使えないので、root 環境で `unzip` がないときは `apt install -y unzip` で入れる。

```bash
cd ~
unzip -o /storage/emulated/0/Download/Claude-ccr-d4f31da7-u5hlbp.zip 'Claude-ccr-d4f31da7-u5hlbp/kuuran-watch/*'
rm -rf ~/kuuran-watch
mv Claude-ccr-d4f31da7-u5hlbp/kuuran-watch ~/kuuran-watch
rm -rf Claude-ccr-d4f31da7-u5hlbp
bash ~/kuuran-watch/setup.sh
```

3. 時計とスマホをつないだ状態で、時計に送る。

```bash
cd ~/kuuran-watch
zeus preview
```

表示された QR コードを Zepp アプリ（開発者モード）で読み取ると、時計に入る。

## 補足

- `app.json` の `appName`（中のなまえ）は英数字の `Kuuran` にしてある。時計の一覧に出る名前は、日本語設定なら `i18n` の `空欄` になる。
- `app.json` の appId `1098767` は仮の番号。preview で弾かれたら、Zepp 開発者サイトで発行した番号に変える。
  時計に送るときに「ダウンロードエラー（400）」になったら、この番号が原因のことが多い（実際に、仮の番号では 400 になり、時計に入っている別のアプリの番号に変えると入った）。
- 実機ではまだ試していない。パソコン上（Node.js）で、Zepp OS の部品を偽物に差し替えて、
  ボタンだけで最後まで遊べること（二つの結末）、ランダムなタップ 40,000 回で例外が出ないこと、
  ボタンが画面の幅からはみ出さないことを確かめた。
  時計で、文字の大きさ・●や℃などの記号の表示・背景の塗り（`FILL_RECT` の大きさを後から変えている）・速さに崩れがあれば直す。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `page/game/index.js` | 画面（文章、方角、命令を作る、よく使う命令） |
| `shared/engine.js` | ゲーム本体。`kuuran/kuuran.html` から自動で作る（直接は直さない） |
| `shared/store.js` | 状態の保存 |
| `shared/ui.js` | 部品を置く小さな道具（zork-watch と同じ） |
| `tools/build-engine.js` | `shared/engine.js` を作り直すスクリプト |
| `setup.sh` | 初回の準備（`npm i`） |

## HTML 版を直したとき

`kuuran/kuuran.html` のゲームを直したら、リポジトリ全体を置いた場所で次を実行して `shared/engine.js` を作り直す。

```bash
node kuuran-watch/tools/build-engine.js
```
