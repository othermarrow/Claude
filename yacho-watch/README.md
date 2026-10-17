# 野帳を Amazfit Balance 2 で遊ぶ（yacho-watch）

テキストアドベンチャー「野帳」（`yacho/`）を、時計（Zepp OS）の中だけで動かすミニアプリ。
話・仕掛け・野帳のしくみ・八つの結末は HTML 版と同じ。スマホとの通信はいらない。

## 画面

上から順に並ぶ。画面を上下にスクロールして使う。

1. 今いる場所、レベルと生存難易度、記録の数（渇き・けががあれば赤で）
2. 直前までの命令（3つ）、今の命令と、その結果
3. 「確かめた」とき：ネオンの二行（英語と日本語）
4. 「命令を作る」：動詞 → 物（「渡す」「入れる」は 2つ目の物）、「言う」はことば、の順にタップする
5. 方角（上・北・西・見る・東・南・下）。行ける方角だけ明るい
6. よく使う命令：持ち物・待つ・耳をすます・寝る・野帳・遊び方
7. 「振動：入／切」と「はじめから」（3秒以内に2回押すと最初からになる）

文字の入力はない（全部タップで遊べる）。レベルごとに画面の色が変わり、停電中は暗くなる。

## HTML 版との違い

- 音はない（HTML 版はブラウザの中で音を作っているが、時計のミニアプリではその仕組みが使えない）。代わりに、けが・倒れる・「確かめた」・停電・結末で振動する。
- 画面のちらつきや走査線はない。ネオンの二行は、文章の上に帯で出す。
- 文章のうち「≡ のメニュー」「十字キー」などの言い回しを、時計の画面に合わせて変えている。

## 保存

- 1手ごとに自動で保存する。アプリを閉じても、次に開くと続きから遊べる。
- 時計のアプリ用の場所に `yacho.json`（状態）、`yacho-loop.json`（周回の記録。「椅子」で置いた野帳が次の周回に出る。はじめからやり直しても残る）、`yacho-set.json`（振動の入／切）を置く。アプリを消すと一緒に消える。
- HTML 版の保存とはつながっていない。

## 準備（初回だけ）

前提：Termux に Zepp OS の開発ツール `zeus` が入っていて、kuuran-watch や zork-watch を `zeus preview` で送れていること。

1. ブラウザで GitHub の `othermarrow/Claude` を開き、ブランチ `ccr-d4f31da7-u5hlbp` を選んでから `Code` → `Download ZIP` で zip を Download フォルダに保存する。
   保存された名前は `ls /storage/emulated/0/Download/ | grep -i claude` で確かめられる（`(1)` が付くことがある）。
2. zeus を使っている環境（Termux、または Termux の中の root 環境）で次を実行する。zip の名前が違うときは `Claude-ccr-d4f31da7-u5hlbp` の部分を書き換える。
   `pkg` は root では使えないので、root 環境で `unzip` がないときは `apt install -y unzip` で入れる。

```bash
cd ~
unzip -o /storage/emulated/0/Download/Claude-ccr-d4f31da7-u5hlbp.zip 'Claude-ccr-d4f31da7-u5hlbp/yacho-watch/*'
rm -rf ~/yacho-watch
mv Claude-ccr-d4f31da7-u5hlbp/yacho-watch ~/yacho-watch
rm -rf Claude-ccr-d4f31da7-u5hlbp
bash ~/yacho-watch/setup.sh
```

3. 時計とスマホをつないだ状態で、時計に送る。

```bash
cd ~/yacho-watch
zeus preview
```

表示された QR コードを Zepp アプリ（開発者モード）で読み取ると、時計に入る。

## 補足

- `app.json` の appId `1098771` は仮の番号。preview で弾かれたら、Zepp 開発者サイトで発行した番号に変える。
- 実機ではまだ試していない。パソコン上（Node.js）で、Zepp OS の部品を偽物に差し替えて、
  ボタンだけで「椅子」の結末まで遊べること、いろいろな場所・持ち物から始めたランダムなタップ 40,000 回で例外が出ないこと、
  ボタンが画面の幅からはみ出さないこと、保存が 10KB 前後に収まることを確かめた。
  ゲーム本体は HTML 版と同じもので、そちらで八つの結末すべてを確かめてある。
- 振動は `@zos/sensor` の `Vibrator` を使っている。時計が対応していない、または呼び方が合わないときは、振動しないだけで遊べる。実機で振動するかは未確認。
- 時計で、文字の大きさ・長い文章（野帳の中身）のスクロール・背景の塗り・速さに崩れがあれば直す。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `page/game/index.js` | 画面（文章、ネオン、方角、命令を作る、よく使う命令、振動） |
| `shared/engine.js` | ゲーム本体。`yacho/yacho.html` から自動で作る（直接は直さない） |
| `shared/store.js` | 状態と設定の保存 |
| `shared/vibe.js` | 振動 |
| `shared/ui.js` | 部品を置く小さな道具（kuuran-watch と同じ） |
| `tools/build-engine.js` | `shared/engine.js` を作り直すスクリプト |
| `setup.sh` | 初回の準備（`npm i`） |

## HTML 版を直したとき

`yacho/yacho.html` のゲーム本体（`// ==== ENGINE BEGIN ====` から `// ==== ENGINE END ====` まで）を直したら、リポジトリ全体を置いた場所で次を実行して `shared/engine.js` を作り直す。

```bash
node yacho-watch/tools/build-engine.js
```

## ライセンス

ゲームの文章は Backrooms Wiki の記事の翻案なので、HTML 版と同じく CC BY-SA 3.0 で公開する。もとにした記事と作者は `yacho/README.md` に記してある。
