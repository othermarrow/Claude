#!/usr/bin/env python3
"""青空文庫のテキストを UTF-8 にして、作家ごとのフォルダに分ける。

元のファイルは消さない・書き換えない。出力は別のフォルダに作る。
対応する入力: .txt（Shift_JIS / UTF-8）と .zip（中の .txt を取り出す）。
"""
import argparse
import csv
import re
import sys
import unicodedata
import zipfile
from pathlib import Path

DEFAULT_SRC = "/storage/emulated/0/Obsidian/Vault2/aozora_bunko"

# 見出しの末尾がこれで終わる行は、作家ではなく訳者・編者などとみなす
ROLE_SUFFIX = ("訳", "譯", "翻訳", "訳編", "編訳", "訳注", "訳詩", "校訂", "校注",
               "註", "注", "補", "改編", "監修", "画", "絵", "挿絵", "口述", "筆記")
BAD_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
SEPARATOR = re.compile(r"^-{5,}")


def decode(data: bytes):
    """文字コードを当てて str にする。戻り値は (本文, 使った文字コード)。"""
    if data.startswith(b"\xef\xbb\xbf"):
        return data[3:].decode("utf-8", errors="replace"), "utf-8-sig"
    for enc in ("utf-8", "cp932", "shift_jis_2004", "euc_jp"):
        try:
            return data.decode(enc), enc
        except UnicodeDecodeError:
            continue
    return data.decode("cp932", errors="replace"), "cp932(一部置換)"


def header_lines(text: str):
    """冒頭の見出し（題名・副題・作家・訳者）を取り出す。"""
    lines = []
    for line in text.split("\n")[:12]:
        s = line.strip().strip("　")
        if not s or SEPARATOR.match(s) or s.startswith("【"):
            break
        lines.append(s)
    return lines


def guess(text: str):
    """(題名, 作家) を返す。わからないときは作家を None にする。"""
    lines = header_lines(text)
    if not lines:
        return None, None
    title = lines[0]
    rest = lines[1:]
    # 末尾の訳者・編者行を落とす
    while rest and rest[-1].replace(" ", "").replace("　", "").endswith(ROLE_SUFFIX):
        rest.pop()
    if not rest:
        return title, None
    author = rest[-1]
    if len(rest) >= 2:
        title = f"{title} {' '.join(rest[:-1])}"
    return title, author


def clean_name(name: str, limit=80):
    name = unicodedata.normalize("NFC", name)
    name = BAD_CHARS.sub("＿", name).strip(" .　")
    return name[:limit] or "無題"


def clean_author(name: str):
    # 「夏目 漱石」「夏目　漱石」を「夏目漱石」にそろえる（和名だけ）
    if re.fullmatch(r"[^\x00-\x7f]+[ 　][^\x00-\x7f]+", name):
        name = re.sub(r"[ 　]", "", name)
    return clean_name(name, 40)


def iter_sources(src: Path, out: Path):
    """(元ファイルの表示名, バイト列) を順に返す。"""
    for p in sorted(src.rglob("*")):
        if not p.is_file() or out in p.parents:
            continue
        ext = p.suffix.lower()
        if ext == ".txt":
            yield str(p.relative_to(src)), p.stem, p.read_bytes()
        elif ext == ".zip":
            try:
                zf = zipfile.ZipFile(p, metadata_encoding="cp932")
            except TypeError:  # Python 3.10 以前
                zf = zipfile.ZipFile(p)
            except zipfile.BadZipFile:
                print(f"  壊れた zip を飛ばしました: {p.name}", file=sys.stderr)
                continue
            with zf:
                for info in zf.infolist():
                    if info.filename.lower().endswith(".txt"):
                        stem = Path(info.filename).stem
                        yield f"{p.relative_to(src)}!{info.filename}", stem, zf.read(info)


def main():
    ap = argparse.ArgumentParser(description="青空文庫テキストを UTF-8 化して作家別に分ける")
    ap.add_argument("src", nargs="?", default=DEFAULT_SRC, help="青空文庫のファイルがあるフォルダ")
    ap.add_argument("-o", "--out", help="出力先（既定: <src>_作家別）")
    ap.add_argument("--md", action="store_true", help="拡張子を .md にする（Obsidian で開けるように）")
    ap.add_argument("--crlf", action="store_true", help="改行を CRLF のまま残す（既定は LF）")
    ap.add_argument("-n", "--dry-run", action="store_true", help="書き出さずに振り分け結果だけ表示")
    args = ap.parse_args()

    src = Path(args.src).expanduser()
    if not src.is_dir():
        sys.exit(f"フォルダが見つかりません: {src}")
    out = Path(args.out).expanduser() if args.out else src.with_name(src.name + "_作家別")
    ext = ".md" if args.md else ".txt"

    rows, used = [], set()
    authors = {}
    for label, stem, data in iter_sources(src, out):
        text, enc = decode(data)
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        title, author = guess(text)
        folder = clean_author(author) if author else "_作家不明"
        name = clean_name(title or stem)
        dest = out / folder / f"{name}{ext}"
        if dest in used or (not args.dry_run and dest.exists()):
            dest = out / folder / f"{name}_{clean_name(stem, 40)}{ext}"
        n = 2
        while dest in used or (not args.dry_run and dest.exists()):
            dest = out / folder / f"{name}_{clean_name(stem, 40)}_{n}{ext}"
            n += 1
        used.add(dest)
        authors[folder] = authors.get(folder, 0) + 1
        rows.append([label, folder, title or "", enc, str(dest.relative_to(out))])
        print(f"{folder} / {dest.name}  ← {label} [{enc}]")
        if not args.dry_run:
            dest.parent.mkdir(parents=True, exist_ok=True)
            body = text.replace("\n", "\r\n") if args.crlf else text
            dest.write_text(body, encoding="utf-8", newline="")

    if not rows:
        sys.exit(f".txt / .zip が見つかりませんでした: {src}")

    print(f"\n{len(rows)} 作品 / {len(authors)} フォルダ")
    for a, c in sorted(authors.items(), key=lambda x: -x[1])[:20]:
        print(f"  {c:4d}  {a}")
    if args.dry_run:
        print("\n（試し実行なので何も書き出していません）")
        return
    log = out / "_振り分け一覧.csv"
    with open(log, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["元ファイル", "作家フォルダ", "題名", "元の文字コード", "出力先"])
        w.writerows(rows)
    print(f"\n出力先: {out}\n一覧: {log}")


if __name__ == "__main__":
    main()
