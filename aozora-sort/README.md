# aozora-sort

青空文庫のテキスト（Shift_JIS）を UTF-8 にして、作家ごとのフォルダに分けるスクリプト。Termux で動かす。

- 入力: `.txt`（Shift_JIS / UTF-8 どちらでも）と `.zip`（中の `.txt` を取り出す）。サブフォルダも見る。
- 出力: `<元フォルダ>_作家別/<作家>/<題名>.txt`（UTF-8、改行は LF）
- **元のファイルは消さない・書き換えない。**
- 作家名は本文冒頭の見出し（題名／副題／作家／訳者）から読む。「〜訳」「〜校訂」などの行は訳者として飛ばし、原作者のフォルダに入れる。
- 見出しで作家名が読めないときは、ファイル名の頭の作家番号（例: `000119_` = 中島敦）から、同じ番号のほかの作品の作家名を使う。それでも読めなければ `_作家不明/` に入る。
- 拡張子が `.txt` でも中身が zip のファイルは、zip として開く。
- 同じ作品が zip と txt で二重にあるときは一つだけ書き出す。何度実行しても、書き出し済みのものは増えない。
- 書き出せないファイルがあっても止まらず、最後に件数を出す。
- 振り分けの結果は `_振り分け一覧.csv` に残る。

## 準備（初回だけ）

```sh
termux-setup-storage
pkg install -y python git
cd ~ && git clone https://github.com/othermarrow/Claude.git   # 既にあれば: cd ~/Claude && git pull
```

## 使い方

```sh
cd ~/Claude/aozora-sort

# 1. 試し実行（何も書き出さず、振り分け先だけ表示）
python aozora_sort.py /storage/emulated/0/Obsidian/Vault2/aozora_bunko -n

# 2. 本番
python aozora_sort.py /storage/emulated/0/Obsidian/Vault2/aozora_bunko
```

→ `/storage/emulated/0/Obsidian/Vault2/aozora_bunko_作家別/` ができる。

### オプション

| オプション | 内容 |
|---|---|
| `-n` | 試し実行。書き出さない |
| `-o DIR` | 出力先を指定 |
| `--md` | 拡張子を `.md` にする（Obsidian はそのままだと `.txt` を開かないため） |
| `--crlf` | 改行を CRLF のまま残す |

同じ題名が同じ作家に二つあるときは、元のファイル名を後ろに足して区別する。出力先に同名ファイルがあるときも上書きしない。

## 注意
- 外字注記（`※［＃…］`）やルビ記法（`《》`）はそのまま残す。
- 実機（Xperia / Termux）での動作はまだ確認していない。サンプルの Shift_JIS ファイルと zip で動作を確かめた。
