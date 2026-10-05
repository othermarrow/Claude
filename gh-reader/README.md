---
tags: [zeppos, amazfit, github]
created: 2026-09-29
---
# GH Reader（Amazfit Balance 2 で GitHub を読む）

## 仕組み
- 時計 ⇄(BLE)⇄ スマホの Zepp アプリ（サイドサービス）→ GitHub API
- 時計は通信しない。取得・Markdown整形はスマホ側（`app-side/index.js`）
- Markdown 整形は `md_reader_server.py` の parse_markdown を JS に移植（frontmatter・`[[wikilink]]`・コードブロック・引用・表・チェックボックス対応）
- 長いノートは約1800文字ごとにページ分割し、「前へ / 次へ」で移動

## 一覧の並び順（作成日順）
- フォルダが先、その後にファイル。それぞれ作成日の新しい順（作成日は名前の下に表示）
- 作成日 = そのパスを最初に追加したコミットの日時（GitHub のコミット履歴から取得）
  - フォルダは、中身が最初に入ったコミットの日時
  - 移動・名前変更したファイルは、移動した日が作成日になる
- 初めて開くフォルダは、名前順で表示 →「作成日を取得中…」→ 取得後に並べ直す
- 取得した作成日はスマホに保存するので、2回目からはすぐ並ぶ
- トークン未設定のときは作成日を取らず、名前順（API 回数制限のため）

## ランダムノート
- 一覧のいちばん下のボタン。今いるフォルダ以下（サブフォルダ含む）の .md から1つ開く
- ルートで押すとリポジトリ全体から選ぶ

## オフライン閲覧
- ルート一覧の先頭「オフライン (端末内)」から入る。スマホとつながらないときは、エラー画面の「オフラインで読む」からも入れる
- 「同期する」で、設定した「オフライン用フォルダ」（既定 `Abstract/report`）の中身を時計に保存
  - サブフォルダも含む。テキスト系ファイルのみ
  - 同期中は画面を消さない（最大10分）。途中で切れても前回のデータは残る
- 保存したノートは時計の中で整形して表示するので、スマホなしで読める（作成日順・ランダムノートも使える）
- ノートを更新したら、もう一度「同期する」を押す

## 導入（Termux）
```bash
cd ~/storage/shared/Claude   # このリポジトリを置いている場所
bash gh-reader/setup.sh
cd ~/gh-reader
npm i
zeus preview
```

## 設定（スマホ）
Zepp アプリ → プロフィール → デバイス → ミニアプリ → GH Reader → 設定
- Owner / Repository / Branch（未入力なら othermarrow / Psychology / デフォルトブランチ）
- オフライン用フォルダ（未入力なら `Abstract/report`）
- Token：非公開リポジトリの場合と、作成日順に並べる場合は必須
  - GitHub → Settings → Developer settings → Fine-grained tokens
  - 対象リポジトリだけを選び、権限は Contents: Read-only のみ

## 表示されるもの
- フォルダと、テキスト系ファイル（md, txt, py, js, json, sh, yml, csv など）
- `.` で始まるもの（.obsidian, .trash など）と PDF・画像は非表示

## 補足
- appId `1098765` は仮の番号。preview で弾かれたら Zepp 開発者サイトで発行した ID に変える
- トークンなしだと GitHub API は 60回/時 まで

## ファイル
- `gh-reader/` のこのフォルダがプロジェクト本体（`zeus preview` はここで実行できる）
- `setup.sh` は同じ内容を `~/gh-reader` に書き出す Termux 用スクリプト（cat EOF 形式）
