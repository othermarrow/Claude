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

---

# aozora_md.py（Markdown 版と索引）

`aozora_sort.py` で作家別に分けたテキストから、Obsidian で読める Markdown 版を別のフォルダに作る。索引ノートもいっしょに作る。

```sh
python aozora_md.py                     # 既定: aozora_bunko_作家別 → aozora_bunko_md
python aozora_md.py --ruby paren        # ルビを「漢字（かんじ）」にする
python aozora_md.py --index-only        # 索引だけ作り直す
python aozora_md.py --force             # 作品ノートも上書きして作り直す
```

## できるもの
```
aozora_bunko_md/
├─ 青空文庫 索引.md          作家一覧（作品数つき）と、全作品の題名順一覧
├─ 中島敦/
│   ├─ 中島敦（作品一覧）.md  その作家の作品一覧
│   └─ 山月記.md
└─ …
```

## 作品ノートの中身
- プロパティ（YAML）: `title` `subtitle` `author` `translator` `source`（底本）`first_published`（初出）`chars`（本文の文字数）`tags: 青空文庫`
- 冒頭の「テキスト中に現れる記号について」は消す。
- ルビ `漢字《かんじ》` / `｜文字《もじ》` → `<ruby>` タグ（`--ruby paren` で括弧、`drop` で消す）
- `［＃「…」は大／中／小見出し］` → `##` / `###` / `####` の見出し
- `［＃「…」に傍点］` など → 太字
- `［＃改ページ］` → 区切り線
- 外字 `※［＃「…」、第3水準1-84-77］` や `U+XXXX` → 実際の文字。変換できないものは `〔てへん＋劣〕` のように説明を残す。
- そのほかの `［＃…］`（字下げなど）は消す。
- 末尾の底本・入力者などの情報は「底本・ファイル情報」としてそのまま残す。

二回目以降は、すでにある作品ノートは上書きしない（Obsidian で書き足したものを消さないため）。索引と作品一覧は毎回作り直す。

`<ruby>` タグが Obsidian のスマホ版でルビとして表示されるかは、実機でまだ確かめていない。読みにくければ `--ruby paren` で作り直す。
