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
| `tane-wo-niru/` | 黄色い部屋から下へ降りていくサイコホラーのテキストアドベンチャー「降下記録」（HTML 一枚） |
| `kuuran/` | 白い部屋で目を覚ます、目的の書かれていないテキストアドベンチャー「空欄」（HTML 一枚） |
| `kuuran-watch/` | 「空欄」を Balance 2 の中だけで動かすミニアプリ（Zepp OS、全部タップで遊ぶ） |
| `noclip/` | 本家 Backrooms の設定（レベル・実体・M.E.G.・アーモンド水）で一から作ったテキストアドベンチャー「ノークリップ」（HTML 一枚） |
| `yacho/` | Backrooms Wiki の記事をもとに、出会うものを観察して野帳に書きとめていくテキストアドベンチャー「野帳」（HTML 一枚、CC BY-SA 3.0） |
| `yacho-watch/` | 「野帳」を Balance 2 の中だけで動かすミニアプリ（Zepp OS、全部タップで遊ぶ、振動つき） |
| `backrooms-pwa/` | 「階層目録」：降下記録・空欄・ノークリップ・野帳を強化し、物語から作った新作「未定稿」（Zork + Backrooms）を足して、起動画面から選べるようにした PWA（Chrome でインストール、Termux の localhost で配る） |
| `yoru-shoko/` | 「夜の書庫」：Zork I〜III（Zork I は日本語辞書つき）と、書き下ろしの長編ホラー「蔵守」を選んで遊ぶ PWA。Z-machine 形式のゲームファイル（Anchorhead など）は自分で持ち込んで遊べる（Termux の localhost で配る） |
| `minamo/` | 「ミナモ」：Gemini API か NVIDIA API を使い、旧式カウンセリングAIと面接する CUI 心理ホラー（Termux、沈黙の秒数・端末情報・六つのAIの人物像を紹介状として使う） |

新しいプロジェクトを足したら、この表も更新する。

## 注意
- トークン・秘密鍵・パスワードはコミットしない。`.gitignore` で除外する。
- 機密を含みうるファイル（鍵、`.env`）は、中身を表示したりコミットしたりしない。
- 実機や外部サービスで確認できていないことは、確認済みと書かない。
