#!/usr/bin/env python3
"""青空文庫のテキストを UTF-8 にして、作家ごとのフォルダに分ける。

元のファイルは消さない・書き換えない。出力は別のフォルダに作る。
対応する入力: .txt（Shift_JIS / UTF-8）と .zip（中の .txt を取り出す）。
"""
import argparse
import csv
import hashlib
import io
import re
import struct
import sys
import unicodedata
import zipfile
import zlib
from pathlib import Path

DEFAULT_SRC = "/storage/emulated/0/Obsidian/Vault2/aozora_bunko"

# 見出しの末尾がこれで終わる行は、作家ではなく訳者・編者などとみなす
ROLE_SUFFIX = ("訳", "譯", "翻訳", "訳編", "編訳", "訳注", "訳詩", "校訂", "校注",
               "註", "注", "補", "改編", "監修", "画", "絵", "挿絵", "口述", "筆記")
BAD_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
SEPARATOR = re.compile(r"^-{5,}")
PERSON_ID = re.compile(r"^(\d{6})_")  # 青空文庫のファイル名の頭は作家番号（例: 000119 = 中島敦）
NAME_BYTES = 200  # Android のファイル名は 255 バイトまで
_warned = set()


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
    name = "".join(c for c in name if unicodedata.category(c) not in ("Cc", "Co", "Cs", "Cn"))
    name = BAD_CHARS.sub("＿", name).strip(" .\u3000")[:limit]
    while len(name.encode("utf-8")) > NAME_BYTES:
        name = name[:-1]
    return name or "無題"


def looks_broken(text: str):
    """文字化けした見出しなら True。"""
    head = "".join(header_lines(text)[:4])
    return not head or "\ufffd" in head or any(unicodedata.category(c) == "Co" for c in head)


def clean_author(name: str):
    # 「夏目 漱石」「夏目　漱石」を「夏目漱石」にそろえる（和名だけ）
    if re.fullmatch(r"[^\x00-\x7f]+[ 　][^\x00-\x7f]+", name):
        name = re.sub(r"[ 　]", "", name)
    return clean_name(name, 40)


def open_zip(src):
    try:
        return zipfile.ZipFile(src, metadata_encoding="cp932")
    except TypeError:  # Python 3.10 以前
        return zipfile.ZipFile(src)


def salvage_zip(data: bytes):
    """目次（central directory）が壊れた zip から、各ファイルの頭を直接たどって取り出す。"""
    pos = 0
    while (pos := data.find(b"PK\x03\x04", pos)) >= 0 and pos + 30 <= len(data):
        _, flag, method, _, _, _, csize, _, nlen, xlen = struct.unpack("<HHHHHIIIHH", data[pos + 4:pos + 30])
        name = data[pos + 30:pos + 30 + nlen].decode("utf-8" if flag & 0x800 else "cp932", errors="replace")
        start = pos + 30 + nlen + xlen
        pos = start
        if not name.lower().endswith(".txt"):
            continue
        raw = data[start:start + csize] if csize and not flag & 0x08 else data[start:]
        try:
            if method == 0:
                body = raw
            elif method == 8:
                body = zlib.decompressobj(-15).decompress(raw)
            else:
                continue
        except zlib.error:
            continue
        if body:
            yield name, body


def warn(msg: str):
    """同じ警告は一度だけ出す（ファイルを二周するため）。"""
    if msg not in _warned:
        _warned.add(msg)
        print(msg, file=sys.stderr)


def read_zip(data: bytes, label: str):
    """zip の中の .txt を (表示名, 名前の元, バイト列) で返す。壊れていても止まらない。"""
    items = []
    try:
        with open_zip(io.BytesIO(data)) as zf:
            for info in zf.infolist():
                if info.filename.lower().endswith(".txt"):
                    items.append((f"{label}!{info.filename}", Path(info.filename).stem, zf.read(info)))
        return items
    except Exception:
        pass
    items = [(f"{label}!{n}", Path(n).stem, b) for n, b in salvage_zip(data)]
    if items:
        warn(f"  壊れた zip から取り出しました: {label}")
    else:
        warn(f"  壊れた zip を飛ばしました: {label}")
    return items


def iter_sources(src: Path, out: Path):
    """(元ファイルの表示名, 名前の元, バイト列) を順に返す。"""
    for p in sorted(src.rglob("*")):
        if not p.is_file() or out in p.parents or p.suffix.lower() not in (".txt", ".zip"):
            continue
        label = str(p.relative_to(src))
        try:
            data = p.read_bytes()
        except OSError as e:
            warn(f"  読めないファイルを飛ばしました: {label} ({e.strerror})")
            continue
        if data[:4] == b"PK\x03\x04":  # 拡張子が .txt でも中身が zip のことがある
            yield from read_zip(data, label)
        elif p.suffix.lower() == ".txt":
            if b"\x00" in data[:2000]:
                warn(f"  文字でないファイルを飛ばしました: {label}")
                continue
            yield label, p.stem, data


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

    # 1 周目: 見出しから作家名を読み、作家番号と名前の対応を作る
    id_author = {}
    for label, stem, data in iter_sources(src, out):
        text, _ = decode(data)
        _, author = guess(text.replace("\r\n", "\n"))
        m = PERSON_ID.match(Path(label.split("!")[0]).name)
        if author and m and not looks_broken(text):
            id_author.setdefault(m.group(1), {}).setdefault(author, 0)
            id_author[m.group(1)][author] += 1
    id_author = {k: max(v, key=v.get) for k, v in id_author.items()}

    # 2 周目: 書き出す
    rows, used, seen, authors = [], set(), set(), {}
    skipped = failed = 0
    for label, stem, data in iter_sources(src, out):
        text, enc = decode(data)
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        digest = hashlib.sha1(text.encode("utf-8")).hexdigest()
        if digest in seen:  # 同じ作品が zip と txt で二重にあるなど
            skipped += 1
            continue
        seen.add(digest)
        title, author = guess(text)
        m = PERSON_ID.match(Path(label.split("!")[0]).name)
        if looks_broken(text):
            title, author = None, None
        if not author and m and m.group(1) in id_author:
            author = id_author[m.group(1)]  # 見出しで読めないときは作家番号から
        folder = clean_author(author) if author else "_作家不明"
        name = clean_name(title or stem)
        body = text.replace("\n", "\r\n") if args.crlf else text

        def same_file(d):
            try:
                return d.read_text(encoding="utf-8", newline="") == body
            except (OSError, UnicodeDecodeError):
                return False

        cands = [f"{name}{ext}", f"{name}_{clean_name(stem, 40)}{ext}"]
        cands += [f"{name}_{clean_name(stem, 40)}_{n}{ext}" for n in range(2, 100)]
        dest = None
        for c in cands:
            d = out / folder / c
            if d in used:
                continue
            if not args.dry_run and d.exists():
                if same_file(d):  # 前の実行で書き出し済み
                    dest = d
                    break
                continue
            dest = d
            break
        used.add(dest)
        authors[folder] = authors.get(folder, 0) + 1
        print(f"{folder} / {dest.name}  ← {label} [{enc}]")
        if not args.dry_run and not dest.exists():
            try:
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(body, encoding="utf-8", newline="")
            except OSError as e:
                failed += 1
                print(f"  書き出せませんでした: {label} ({e.strerror})", file=sys.stderr)
                continue
        rows.append([label, folder, title or "", enc, str(dest.relative_to(out))])

    if not rows:
        sys.exit(f".txt / .zip が見つかりませんでした: {src}")

    print(f"\n{len(rows)} 作品 / {len(authors)} フォルダ（重複で飛ばした {skipped} / 失敗 {failed}）")
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
