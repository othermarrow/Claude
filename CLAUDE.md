# CLAUDE.md

このリポジトリ（othermarrow/Claude）は、Claude Code で作ったツール・スクリプト・アプリを管理する場所。

## 方針
- Claude が作ったものは、基本的にこのリポジトリで管理する。
- プロジェクトごとにトップレベルにフォルダを作る（例: `gh-reader/`, `research_bot/`）。
- 各フォルダに `README.md` を置き、目的・使い方・設定方法を書く。
- Vault のノートやメモそのものの変更だけは、othermarrow/Psychology 側で行う。
- 作業はブランチで行う。`main` へ直接プッシュせず、マージは依頼されたときだけ。
- PR は依頼されたときだけ作る。

## 利用環境
- 利用者は Android（Xperia 1 IV）のみで、PC はない。開発は F-Droid 版 Termux。
- Termux で実行するコードは、`cat > ファイル <<'EOF'` 形式で書く。
- 手順はスマホだけで完結するようにする（PC 前提の手順を書かない）。
- 時計は Amazfit Balance 2（Zepp OS）。ミニアプリは `zeus preview` で送る。
- 説明・README・コミットメッセージの本文は日本語でよい。

## プロジェクト
| フォルダ | 内容 |
|---|---|
| `gh-reader/` | Balance 2 で GitHub のフォルダ・Markdown を読むミニアプリ（Zepp OS） |
| `research_bot/` | テーマ文から文献を集め、抄録カタログを作るツール |
| `zork-ja/` | 英語版 Zork I を Termux で日本語で遊ぶためのラッパー |
| `zork-watch/` | Zork I を Balance 2 の中だけで動かすミニアプリ（日英表示・英語入力） |
| `brain-zork/` | 自分の考え方を Backrooms 風に描いたテキストアドベンチャー（脳内バックルーム） |

新しいプロジェクトを足したら、この表も更新する。

## 注意
- トークン・秘密鍵・パスワードはコミットしない。`.gitignore` で除外する。
- 機密を含みうるファイル（鍵、`.env`）は、中身を表示したりコミットしたりしない。
- 実機や外部サービスで確認できていないことは、確認済みと書かない。
