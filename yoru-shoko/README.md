# 夜の書庫（yoru-shoko）

Zork と、日本語で遊べるホラーのテキストアドベンチャーを、ひとつの PWA にまとめた本棚。
Chrome でインストールすると、ホーム画面のアイコンから開ける。遊んだ続きは、端末の中に残る。

## 中身

| 札 | 内容 | 日本語 |
|---|---|---|
| 蔵守（くらもり） | 書き下ろしの長編ホラー。山あいの旧家で三晩。蔵の戸は開けてはいけない。部屋 48・結末 8・三つの章 | 全文日本語 |
| ZORK I | Infocom（MIT ライセンスで公開されたもの） | 辞書で日本語表示（`zork-ja/` の辞書を使う） |
| ZORK II・III | 同上 | 英語。「訳す」ボタンで翻訳サービスに送れる |
| 持ち込んだゲーム | Z-machine（.z3〜.z8 .zblorb）と Glulx（.ulx .gblorb）のゲームファイルを、自分で開く | 英語。「訳す」ボタン |


### 番号が 8081 から 7070 に変わった（記録の引っ越し）

ミナモ（8082）や端末の中の AI（8090）と離すため、既定の番号を 8081 から **7070** に変えた。Chrome は記録を番号ごとに分けて持つので、前に 8081 で遊んでいた記録（持ち込んだゲームファイルも運ぶ）は、一度だけ引っ越す（8081 の記録は消えずに残る）。

```bash
cd ~/Claude/yoru-shoko
sh serve.sh 8081 &
sh serve.sh
```

1. 一行目は前の番号 8081 のサーバー（後ろで動く）、二行目が新しい番号 7070 のサーバー。
2. Chrome で `http://localhost:8081/move.html` を開き、「引っ越す」を押す。新しい番号の画面が開いて「受け取りました」と出れば、終わり。
3. 前の番号のサーバーを止める：`pkill -f "http.server 8081"`。ホーム画面の古いアイコンは消して、`http://localhost:7070/` でインストールし直す。

## 持ち込みについて（Anchorhead・Slouching Towards Bedlam など）

- ゲームファイルは、このアプリには入れていない。自分で取ってきて、「ゲームファイルを開く」で選ぶ。
  Termux なら `sh yoru-shoko/tools/fetch_games.sh` で、Anchorhead と Bedlam を Download に取ってこられる（取得先の URL は、このセッションからは確かめられていない。取れなければ、IFDB で探して手で保存する）。
  ファイルは、この端末の IndexedDB にだけ置かれる（どこにも送られない）。
- Anchorhead は Z-machine 形式（.z8）。Slouching Towards Bedlam の形式は未確認だが、Z-machine でも Glulx でも動く。
- Glulx は Quixe（MIT ライセンス、`glulx/LICENSE-quixe.txt`）で動かす。Glulx のゲームは、ゲームを閉じて別の Glulx のゲームを開くとき、画面を読み込みなおす。
  Glulx は、ゲーム内の「save」「restore」で続きを遊ぶ（スロットは「⋮」で選ぶ。Z-machine のような自動保存はない）。画像・音・タイマーは未対応。
- 配布が許されているかは、作品ごとに違う。配布元のページで確かめてから取ること。
- 『Buddy Simulator 1984』は、独自のエンジンで動く別のゲームなので、ここでは動かせない。
- 英語の持ち込みゲームを日本語で読むには、右上の「⋮」→「いまの場面を訳す」。押したときだけ、
  いまの場面の英文が Google 翻訳のページに送られる。辞書で訳せるのは、今のところ Zork I だけ。

## 動かし方（スマートフォンだけでできる）

PWA は `https://` か `http://localhost` で開いたときだけインストールできる。
リポジトリが非公開なので、Termux の中で小さなサーバーを動かして、同じスマホの Chrome から開く。

```sh
cd ~/Claude
git status --short                       # 何か出たら、先に git stash
git fetch origin ccr-db3a2681-hvk1xj:ccr-db3a2681-hvk1xj
git checkout ccr-db3a2681-hvk1xj
sh yoru-shoko/serve.sh
```

「Chrome で http://localhost:7070/ を開いてください」と出たら、Termux はそのままにして、
Chrome で `http://localhost:7070/` を開く。Chrome の ⋮ →「アプリをインストール」（または「ホーム画面に追加」）。
更新するときは、`git checkout ccr-db3a2681-hvk1xj` と `git pull origin ccr-db3a2681-hvk1xj` をしてから `serve.sh`。
入れたあとは、サーバーを止めても開ける（はず。下の「確認したこと」を参照）。

- 遊んだ記録は、`localhost:7070` という場所に保存される。ポート（7070）を変えると、記録が見えなくなる。
- Chrome の「サイトのデータを削除」をすると、記録も消える。
- `serve.sh` は `127.0.0.1` でだけ待つので、同じ Wi-Fi のほかの端末からは見えない。
- Chrome のタブで開けば、Chrome の「日本語に翻訳」で、英語のゲームの画面全体を訳すこともできる。

## ファイル

| ファイル | 役目 |
|---|---|
| `index.html` / `app.js` | 一覧と、ゲームの画面（記録・入力・メニュー・保存） |
| `games.js` | 一覧に並べるゲーム |
| `zvm.js` | Z-machine（バージョン 1〜5・7・8）のインタープリタ。保存・復元・やり直し・上の窓に対応。画像・音・タイマー入力は未対応 |
| `glulx/` | Glulx 用。`quixe.min.js`（Quixe 本体）・`glkapi.min.js`（Glk API）は Quixe 2.1.6 のもの。`glkote-mini.js` は、このアプリ用に書いた画面側の部品（GlkOte と Dialog の代わり） |
| `translate.js` / `dict.js` | Zork I の日本語辞書（`tools/build.py` が `zork-ja/` から作る） |
| `stories/` | Zork I〜III（`LICENSE-zork.txt` を参照） |
| `kura/engine.js` | 日本語アドベンチャー用のエンジン（部屋・物・時間・夜・問い・ひとつ戻す） |
| `kura/house.js` `village.js` `night.js` `extra.js` | 『蔵守』の世界（家と蔵／集落とダムと底／人・夜・結末・ヒント／旧家・駐在所・郵便局・七つの割符・夢） |
| `kura/WALKTHROUGH.md` | 『蔵守』の攻略メモ（**ネタバレ**） |
| `tools/play.js` | Z-machine を Node で動かして試す（`node tools/play.js stories/zork1.z3 "open mailbox"`） |
| `tools/kura_test.js` `kura_walk.js` | 『蔵守』を画面なしで通して、全結末に着けるか確かめる（`node tools/kura_test.js return`） |
| `sw.js` `manifest.webmanifest` `icons/` `serve.sh` | PWA の仕組み。ファイルを足したら `sw.js` の `FILES` に足し、`VERSION` を上げる |

## 遊びかた（蔵守）

- 画面の下の「動詞→物」のボタンで命令を作る。日本語で打ち込んでもよい（「表札を調べる」「北へ」など）。
- 「手がかり」で、見つけたことを見返せる。「ヒントを見る」は右上の ⋮ にある。
- 失敗しても「ひとつ戻す」でやり直せる。結末は 8 つ。一覧の札に、見た結末の数が出る。
- 時間は、移動や「待つ」で進む。夜は家の外にいてはいけない。

## 確認したこと・していないこと

確認したこと（Node とヘッドレス Chromium で）：
- Zork I〜III が起動し、命令を受け付ける。Zork I は日本語表示と、日本語の命令が通る。
- Inform 6 で作った Z-machine のテスト用ゲーム（v5・v8）で、命令の読み取り・状態行（上の窓）・やり直し・保存と復元が動く。
- 持ち込み（ファイル選択→一覧→遊ぶ→再読み込みで続き）が動く。
- Glulx：Inform 6 で作ったテスト用の Glulx ゲームが、持ち込み・命令・状態行・save/restore・別のゲームを挟んでの再読み込みまで動く。
- 『蔵守』の全 8 結末に、攻略手順（`tools/kura_walk.js`）で着ける。

確認していないこと：
- Android の実機（Xperia 1 IV の Chrome）での動作。PWA のインストールと、サーバーを止めたあとの起動。
- Anchorhead と Slouching Towards Bedlam の実ファイル。このセッションからは取得できなかったので、動くことは確かめていない。Glulx の仮想機械（Quixe）自体は、作者のテストで確かめられている実績のあるものを、そのまま使っている。
- 『蔵守』を、人が通して遊んだときの面白さ・難しさ。文章と謎解きの調整は、遊んだ感想をもとに直す。
