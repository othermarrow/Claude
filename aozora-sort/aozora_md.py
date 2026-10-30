#!/usr/bin/env python3
"""作家別に分けた青空文庫テキスト（UTF-8）から、Obsidian 用の Markdown 版と索引を作る。

入力のフォルダは書き換えない。出力は別のフォルダに作る。
"""
import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

DEFAULT_SRC = "/storage/emulated/0/Obsidian/Vault2/aozora_bunko_作家別"
INDEX_NAME = "青空文庫 索引"
ROLE_SUFFIX = ("訳", "譯", "翻訳", "訳編", "編訳", "訳注", "訳詩", "校訂", "校注",
               "註", "注", "補", "改編", "監修", "画", "絵", "挿絵", "口述", "筆記")
SEPARATOR = re.compile(r"^-{5,}")
LINK_BAD = re.compile(r"[#^\[\]|]")

KANJI = r"[々〆ヵヶ㐀-䶿一-鿿豈-﫿\U00020000-\U0003ffff]"
RUBY_BAR = re.compile(r"｜([^｜《》\n]+?)《([^》\n]+)》")
RUBY_KANJI = re.compile(rf"({KANJI}+)《([^》\n]+)》")
RUBY_LEFT = re.compile(r"《([^》\n]+)》")
GAIJI = re.compile(r"※［＃([^］]*)］")
HEADING_LINE = re.compile(r"［＃「([^」]+)」は(大|中|小|同行中|同行小|窓中|窓小)見出し］")
HEADING_SPAN = re.compile(r"［＃(?:ここから)?(?:同行|窓)?(大|中|小)見出し］(.*?)［＃(?:ここで)?(?:同行|窓)?\1見出し終わり］")
EMPHASIS = re.compile(r"［＃「([^」]+)」に(?:白?[ゴ丸]?[^」］]*傍点|傍線|太字)］")
PAGE_BREAK = re.compile(r"^［＃改(?:ページ|丁|段|見開き)］$")
NOTE = re.compile(r"［＃[^］]*］")
LEVEL = {"大": "##", "中": "###", "小": "####"}


def gaiji(m):
    """外字注記を、変換できるものは文字に、できないものは説明だけ残す。"""
    note = m.group(1)
    u = re.search(r"U\+([0-9A-Fa-f]{4,6})", note)
    if u:
        return chr(int(u.group(1), 16))
    k = re.search(r"(?<!\d)([12])-(\d{1,2})-(\d{1,2})(?!\d)", note)
    if k:
        men, ku, ten = (int(x) for x in k.groups())
        raw = bytes([ku + 0xA0, ten + 0xA0])
        if men == 2:
            raw = b"\x8f" + raw
        try:
            return raw.decode("euc_jis_2004")
        except UnicodeDecodeError:
            pass
    desc = re.match(r"「([^」]+)」", note)
    return f"〔{desc.group(1)}〕" if desc else "〓"


def split_parts(text):
    """(見出し行, 本文行, 底本以下の行) に分ける。"""
    lines = text.split("\n")
    i = 0
    head = []
    while i < len(lines) and lines[i].strip("　 "):
        if SEPARATOR.match(lines[i]):
            break
        head.append(lines[i].strip("　 "))
        i += 1
    # 空行と【テキスト中に現れる記号について】の囲みを飛ばす
    while i < len(lines) and not lines[i].strip("　 "):
        i += 1
    if i < len(lines) and SEPARATOR.match(lines[i]):
        j = i + 1
        while j < len(lines) and not SEPARATOR.match(lines[j]):
            j += 1
        i = j + 1 if j < len(lines) else i
    body = lines[i:]
    foot = []
    for k, line in enumerate(body):
        if line.startswith("底本："):
            foot, body = body[k:], body[:k]
            break
    while body and not body[-1].strip("　 "):
        body.pop()
    body = [l for l in body if l.strip() != "［＃本文終わり］"]
    return head, body, foot


def meta_from(head, foot, author_dir):
    title = head[0] if head else ""
    rest = head[1:]
    translators = []
    while rest and rest[-1].replace(" ", "").replace("　", "").endswith(ROLE_SUFFIX):
        translators.insert(0, rest.pop())
    subtitle = " ".join(rest[:-1]) if len(rest) >= 2 else ""
    meta = {"title": title, "subtitle": subtitle, "author": author_dir, "translator": " / ".join(translators)}
    joined = "\n".join(foot)
    for key, label in (("source", "底本"), ("first", "初出")):
        m = re.search(rf"^{label}：(.+)$", joined, re.M)
        meta[key] = m.group(1).strip() if m else ""
    return meta


def escape_md(line):
    s = line.lstrip(" \t")
    s = s.replace("<", "&lt;").replace(">", "&gt;")
    m = re.match(r"^\d+(?=[.)])", s)
    if m:  # 「1.」を番号つきリストにしない
        s = m.group() + "\\" + s[m.end():]
    elif re.match(r"^([#>*+=_`|~-]|&gt;)", s):
        s = "\\" + s
    return s


def convert_line(line, ruby):
    if PAGE_BREAK.match(line.strip()):
        return "\n---\n"
    line = GAIJI.sub(gaiji, line)
    level = None
    m = HEADING_LINE.search(line)
    if m:
        level = LEVEL[m.group(2)[-1]]
    span = HEADING_SPAN.search(line)
    if span:
        level = LEVEL[span.group(1)]
        line = span.group(2)

    # 傍点など: 直前が「X」で終わっていれば太字にする
    out, pos = [], 0
    for m in EMPHASIS.finditer(line):
        chunk = line[pos:m.start()]
        target = m.group(1)
        if chunk.endswith(target):
            chunk = chunk[: -len(target)] + "\x01" + target + "\x02"
        out.append(chunk)
        pos = m.end()
    out.append(line[pos:])
    line = NOTE.sub("", "".join(out))
    line = escape_md(line)
    if ruby == "html":
        rep = r"<ruby>\1<rt>\2</rt></ruby>"
    elif ruby == "paren":
        rep = r"\1（\2）"
    else:
        rep = r"\1"
    line = RUBY_BAR.sub(rep, line)
    line = RUBY_KANJI.sub(rep, line)
    line = RUBY_LEFT.sub("" if ruby == "drop" else r"（\1）", line)
    line = line.replace("｜", "").replace("\x01", "**").replace("\x02", "**")
    if level:
        text = line.strip("　 \\")
        return f"\n{level} {text}\n" if text else ""
    return line


def safe_link(name):
    return LINK_BAD.sub(lambda m: unicodedata.normalize("NFKC", m.group()).translate(
        str.maketrans("#^[]|", "＃＾［］｜")), name)


def yaml(meta_items):
    lines = ["---"]
    for k, v in meta_items:
        if isinstance(v, list):
            lines.append(f"{k}:")
            lines += [f"  - {json.dumps(x, ensure_ascii=False)}" for x in v]
        elif v != "":
            lines.append(f"{k}: {json.dumps(v, ensure_ascii=False)}")
    lines.append("---")
    return "\n".join(lines)


def find_vault(p: Path):
    for d in [p, *p.parents]:
        if (d / ".obsidian").is_dir():
            return d
    return p.parent


def main():
    ap = argparse.ArgumentParser(description="作家別の青空文庫テキストから Markdown 版と索引を作る")
    ap.add_argument("src", nargs="?", default=DEFAULT_SRC, help="aozora_sort.py の出力フォルダ")
    ap.add_argument("-o", "--out", help="出力先（既定: src と同じ場所の aozora_bunko_md）")
    ap.add_argument("--ruby", choices=["html", "paren", "drop"], default="html",
                    help="ルビ: html=<ruby>タグ / paren=漢字（かんじ） / drop=消す（既定 html）")
    ap.add_argument("--force", action="store_true", help="作品ノートも上書きする（既定は索引だけ作り直す）")
    ap.add_argument("--index-only", action="store_true", help="索引だけ作り直す")
    args = ap.parse_args()

    src = Path(args.src).expanduser()
    if not src.is_dir():
        sys.exit(f"フォルダが見つかりません: {src}")
    out = Path(args.out).expanduser() if args.out else src.parent / "aozora_bunko_md"
    out.mkdir(parents=True, exist_ok=True)
    vault = find_vault(out.resolve())
    base = out.resolve().relative_to(vault).as_posix() if out.resolve() != vault else ""
    link_root = f"{base}/" if base else ""

    works = {}  # 作家 -> [(題名, ノート名, meta)]
    made = kept = failed = 0
    for txt in sorted(src.glob("*/*.txt")):
        author = txt.parent.name
        try:
            text = txt.read_text(encoding="utf-8").replace("\r\n", "\n")
        except (OSError, UnicodeDecodeError) as e:
            print(f"  読めませんでした: {txt.name} ({e})", file=sys.stderr)
            failed += 1
            continue
        head, body, foot = split_parts(text)
        meta = meta_from(head, foot, author)
        note = safe_link(txt.stem)
        dest = out / safe_link(author) / f"{note}.md"
        works.setdefault(author, []).append((meta["title"] or txt.stem, note, meta))
        if args.index_only or (dest.exists() and not args.force):
            kept += 1
            continue
        author_note = f"{link_root}{safe_link(author)}/{safe_link(author)}（作品一覧）"
        fm = yaml([
            ("title", meta["title"]), ("subtitle", meta["subtitle"]), ("author", meta["author"]),
            ("translator", meta["translator"]), ("source", meta["source"]), ("first_published", meta["first"]),
            ("chars", sum(len(l) for l in body)), ("tags", ["青空文庫"]),
        ])
        parts = [fm, "", f"# {meta['title'] or txt.stem}"]
        if meta["subtitle"]:
            parts.append(f"*{meta['subtitle']}*")
        byline = f"[[{author_note}|{author}]]"
        if meta["translator"]:
            byline += f"　{meta['translator']}"
        parts += [byline, "", "---", ""]
        parts += [convert_line(l, args.ruby) for l in body]
        if foot:
            parts += ["", "---", "", "## 底本・ファイル情報", ""]
            parts += [escape_md(l) + "  " for l in foot if l.strip()]
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text("\n".join(parts) + "\n", encoding="utf-8")
            made += 1
        except OSError as e:
            print(f"  書き出せませんでした: {dest.name} ({e.strerror})", file=sys.stderr)
            failed += 1

    if not works:
        sys.exit(f"作家フォルダの .txt が見つかりませんでした: {src}")

    # 作家ごとの作品一覧
    total = sum(len(v) for v in works.values())
    for author, items in works.items():
        a = safe_link(author)
        lines = [yaml([("author", author), ("works", len(items)), ("tags", ["青空文庫", "青空文庫/作家"])]),
                 "", f"# {author}", "", f"[[{link_root}{INDEX_NAME}|← 索引]]　{len(items)} 編", ""]
        for title, note, meta in sorted(items, key=lambda x: x[0]):
            extra = "".join(f"　{x}" for x in (meta["subtitle"], meta["translator"]) if x)
            lines.append(f"- [[{link_root}{a}/{note}|{title}]]{extra}")
        (out / a / f"{a}（作品一覧）.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    # 全体の索引: 作家一覧と、題名順の作品一覧
    lines = [yaml([("tags", ["青空文庫"])]), "", f"# {INDEX_NAME}", "",
             f"作家 {len(works)} 人 / 作品 {total} 編", "", "## 作家", ""]
    for author, items in sorted(works.items()):
        a = safe_link(author)
        lines.append(f"- [[{link_root}{a}/{a}（作品一覧）|{author}]]（{len(items)}）")
    lines += ["", "## 作品（題名順）", ""]
    allw = sorted(((t, a, n) for a, items in works.items() for t, n, _ in items),
                  key=lambda x: unicodedata.normalize("NFKC", x[0]))
    for title, author, note in allw:
        lines.append(f"- [[{link_root}{safe_link(author)}/{note}|{title}]]　{author}")
    (out / f"{INDEX_NAME}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"作品ノート: 新しく {made} / そのまま {kept} / 失敗 {failed}")
    print(f"作家 {len(works)} 人 / 作品 {total} 編")
    print(f"出力先: {out}\n索引: {out / (INDEX_NAME + '.md')}")


if __name__ == "__main__":
    main()
