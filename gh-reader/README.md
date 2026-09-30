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
- Token：非公開リポジトリの場合は必須
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
