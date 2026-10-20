#!/usr/bin/env python3
"""膨大な量のテキスト：手もとの青空文庫（Obsidian の Vault2 など）から「手もとの棚」を作る。

使い方（Termux）:
    python make-local.py [読むフォルダ] [書き出すフォルダ]

既定は /storage/emulated/0/Obsidian/Vault2 を読み、
/storage/emulated/0/Download/boudai-local.js に書き出す。
boudai-text.html と同じフォルダに boudai-local.js を置くと、ゲームはそちらの本を使う。

青空文庫らしいファイル（「底本：」や「青空文庫」を含む、ルビ《》や注記［＃］がある）だけを使う。
ふつうのメモが混ざらないように、それ以外のファイルは読まない（--all を付けると全部読む）。
"""
import json
import os
import random
import re
import sys
import time

SRC = "/storage/emulated/0/Obsidian/Vault2"
OUT = "/storage/emulated/0/Download"
MAX_WORKS = 100          # 棚に並べる本の数（多すぎるとゲームの読みこみが重くなる）
MAX_SENTENCES = 250      # 一冊から残す文の数
EXTS = (".txt", ".md", ".html", ".htm", ".xhtml")

# 怪談・幻想・孤独の書き手（多めに選ぶ）
DARK = ["夢野久作", "岡本綺堂", "泉鏡花", "江戸川乱歩", "芥川龍之介", "梶井基次郎", "小酒井不木", "海野十三",
        "萩原朔太郎", "小泉八雲", "田中貢太郎", "中島敦", "坂口安吾", "太宰治", "久生十蘭", "大阪圭吉", "蘭郁二郎",
        "浜尾四郎", "小川未明", "宮沢賢治", "夏目漱石", "佐藤春夫", "谷崎潤一郎", "牧逸馬", "国枝史郎", "上田秋成",
        "原民喜", "葉山嘉樹", "林芙美子", "北条民雄"]
# 没年（ファイルに書いていないとき用）
DIED = {"芥川龍之介": 1927, "夏目漱石": 1916, "太宰治": 1948, "宮沢賢治": 1933, "夢野久作": 1936, "岡本綺堂": 1939,
        "泉鏡花": 1939, "江戸川乱歩": 1965, "梶井基次郎": 1932, "小泉八雲": 1904, "中島敦": 1942, "坂口安吾": 1955,
        "萩原朔太郎": 1942, "森鴎外": 1922, "森鷗外": 1922, "樋口一葉": 1896, "小川未明": 1961, "田中貢太郎": 1941,
        "海野十三": 1949, "小酒井不木": 1929, "久生十蘭": 1957, "谷崎潤一郎": 1965, "佐藤春夫": 1964, "島崎藤村": 1943,
        "国木田独歩": 1908, "正岡子規": 1902, "石川啄木": 1912, "中原中也": 1937, "堀辰雄": 1953, "横光利一": 1947,
        "織田作之助": 1947, "林芙美子": 1951, "原民喜": 1951, "北条民雄": 1937, "葉山嘉樹": 1945, "上田秋成": 1809,
        "岡本かの子": 1939, "与謝野晶子": 1942, "有島武郎": 1923, "寺田寅彦": 1935, "牧野信一": 1936, "大阪圭吉": 1945,
        "蘭郁二郎": 1944, "浜尾四郎": 1935, "牧逸馬": 1935, "国枝史郎": 1943, "新美南吉": 1943, "菊池寛": 1948,
        "幸田露伴": 1947, "徳田秋声": 1943, "二葉亭四迷": 1909, "尾崎紅葉": 1903}

SCARY = re.compile(r"死|闇|血|夜|影|暗|怖|墓|骨|声|独り|一人|寂|淋|消え|棺|幽|亡|鬼|狂|泣|黒|冷|穴|底|沈|眠|夢|忘れ|誰も|だれも|孤|涙|骸|呪|霧|雨")


def score(s):
    return len(SCARY.findall(s))


def read_text(path):
    raw = open(path, "rb").read()
    for enc in ("utf-8-sig", "cp932", "euc_jp"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    return raw.decode("utf-8", "replace")


def looks_aozora(t):
    return ("底本：" in t or "青空文庫" in t or "［＃" in t or re.search(r"《[ぁ-んァ-ヶー]+》", t)) is not None


def front_matter(t):
    meta = {}
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n", t, re.S)
    if not m:
        return meta, t
    for line in m.group(1).splitlines():
        kv = re.match(r"^\s*([^:#]+?)\s*:\s*(.*?)\s*$", line)
        if kv:
            meta[kv.group(1).strip().lower()] = kv.group(2).strip().strip("\"'[]")
    return meta, t[m.end():]


def pick_meta(meta, keys):
    for k in keys:
        if meta.get(k):
            return meta[k]
    return ""


def clean(t):
    # HTML（青空文庫の XHTML をそのまま置いている場合）
    if re.search(r"<(br|ruby|div|p)\b", t, re.I):
        m = re.search(r'<div class="main_text">(.*?)<div class="bibliographical_information">', t, re.S)
        if m:
            t = m.group(1)
        t = re.sub(r"<(rt|rp)>.*?</\1>", "", t, flags=re.S)
        t = re.sub(r'<span class="notes">.*?</span>', "", t, flags=re.S)
        t = re.sub(r"<img[^>]*>", "※", t)
        t = re.sub(r"<br\s*/?>|</p>|</div>", "\n", t, flags=re.I)
        t = re.sub(r"<[^>]+>", "", t)
        t = t.replace("&nbsp;", " ").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
    # 青空文庫の書式
    t = re.sub(r"※［＃[^］]*］", "※", t)
    t = re.sub(r"［＃[^］]*］", "", t)
    t = re.sub(r"《[^》]*》", "", t)
    t = t.replace("｜", "")
    # Markdown
    t = re.sub(r"\[\[([^\]|]*\|)?([^\]]*)\]\]", r"\2", t)
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)
    t = re.sub(r"^\s{0,3}(#{1,6}|>|[-*+]\s)\s*", "", t, flags=re.M)
    t = re.sub(r"[*_`]{1,3}", "", t)
    return t


def split_aozora(t, fallback_title):
    """青空文庫のテキスト形式なら、頭の題名・著者と、記号の説明・底本の部分を分ける。"""
    lines = t.splitlines()
    seps = [i for i, l in enumerate(lines) if re.match(r"^-{20,}\s*$", l)]
    title = author = ""
    body_from = 0
    if len(seps) >= 2:
        head = [l.strip() for l in lines[:seps[0]] if l.strip()]
        if head:
            title = head[0]
            names = [h for h in head[1:] if not h.endswith("訳")]
            if names:
                author = names[-1]
        body_from = seps[1] + 1
    body = []
    for l in lines[body_from:]:
        if l.startswith("底本：") or l.startswith("底本:"):
            break
        body.append(l)
    return title or fallback_title, author, "\n".join(body)


def sentences_of(text):
    out = []

    def add(s):
        s = s.strip()
        if len(s) < 4:
            return
        while len(s) > 130:
            cut = s.rfind("、", 0, 110)
            if cut < 30:
                cut = 110
            out.append(s[:cut + 1])
            s = s[cut + 1:]
        if len(s) >= 4:
            out.append(s)

    for line in text.split("\n"):
        line = re.sub(r"\s+", " ", line.strip(" \t　"))
        if not line:
            continue
        cur = ""
        for i, ch in enumerate(line):
            nx = line[i + 1] if i + 1 < len(line) else ""
            cur += ch
            if ch in "。！？" and nx not in "」』）":
                add(cur)
                cur = ""
            elif ch in "」』" and i > 0 and line[i - 1] in "。！？" and nx not in "」』":
                add(cur)
                cur = ""
        if cur:
            add(cur)
    return out


def best_window(s, n):
    if len(s) <= n:
        return s
    best, best_score = 0, -1
    for _ in range(12):
        st = random.randrange(len(s) - n)
        sc = sum(score(s[i]) for i in range(st, st + n, 4))
        if sc > best_score:
            best, best_score = st, sc
    return s[best:best + n]


def quotes_of(text):
    q = []
    for m in re.finditer(r"「([^「」『』]{3,40})」", text):
        t = re.sub(r"\s+", "", m.group(1))
        if len(t) >= 3 and t not in q and "※" not in t:
            q.append(t)
        if len(q) >= 60:
            break
    return q


def load(path, take_all):
    t = read_text(path)
    if not take_all and not looks_aozora(t):
        return None
    meta, t = front_matter(t)
    name = os.path.splitext(os.path.basename(path))[0]
    title, author, body = split_aozora(t, name)
    # 青空文庫の XHTML なら、題名と著者は見出しにある
    ht = re.search(r'class="title"[^>]*>(.*?)<', t)
    ha = re.search(r'class="author"[^>]*>(.*?)<', t)
    if ht and title == name:
        title = ht.group(1).strip()
    if ha and not author:
        author = ha.group(1).strip()
    title = pick_meta(meta, ["title", "タイトル", "作品名", "題名"]) or title
    author = pick_meta(meta, ["author", "著者", "作者", "著者名"]) or author
    author = re.sub(r"\s+", "", author)
    died = pick_meta(meta, ["died", "death", "没年", "没年月日"])[:4]
    if not re.match(r"^\d{4}$", died):
        died = str(DIED[author]) if author in DIED else ""
    body = clean(body)
    s = sentences_of(body)
    if len(s) < 20:
        return None
    return {"t": title, "a": author or "（著者不明）", "d": died, "s": best_window(s, MAX_SENTENCES), "q": quotes_of(body), "n": len(re.sub(r"\s", "", body))}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    take_all = "--all" in sys.argv
    src = args[0] if args else SRC
    out = args[1] if len(args) > 1 else OUT
    if not os.path.isdir(src):
        sys.exit(f"フォルダがない：{src}")
    files = []
    for root, dirs, names in os.walk(src):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        files += [os.path.join(root, n) for n in names if n.lower().endswith(EXTS)]
    print(f"{src} に、ファイルが {len(files)} 個")
    random.shuffle(files)
    works, skipped, t0 = [], 0, time.time()
    for i, f in enumerate(files):
        try:
            w = load(f, take_all)
        except Exception as e:  # 読めないファイルは飛ばす
            print(f"  読めない：{os.path.relpath(f, src)}（{e}）")
            w = None
        if w:
            works.append(w)
        else:
            skipped += 1
        if (i + 1) % 200 == 0:
            print(f"  {i + 1} 個読んだ（本 {len(works)} 冊）")
    if not works:
        sys.exit("青空文庫らしい本が見つからなかった。ふつうのテキストも使うなら --all を付ける。")
    dark = [w for w in works if w["a"] in DARK]
    other = [w for w in works if w["a"] not in DARK]
    shelf = dark[:int(MAX_WORKS * 0.7)]
    shelf += other[:MAX_WORKS - len(shelf)]
    shelf += dark[int(MAX_WORKS * 0.7):][:MAX_WORKS - len(shelf)]
    for n, w in enumerate(shelf):
        w["p"] = f"local:{n}"
    total = sum(w.pop("n") for w in works)
    data = {"v": 1, "made": time.strftime("%Y-%m-%d %H:%M"), "found": len(works), "chars": total, "works": shelf}
    os.makedirs(out, exist_ok=True)
    path = os.path.join(out, "boudai-local.js")
    with open(path, "w", encoding="utf-8") as fp:
        fp.write("window.BOUDAI_LOCAL = ")
        json.dump(data, fp, ensure_ascii=False, separators=(",", ":"))
        fp.write(";\n")
    authors = {}
    for w in shelf:
        authors[w["a"]] = authors.get(w["a"], 0) + 1
    top = sorted(authors.items(), key=lambda x: -x[1])[:8]
    print(f"本として読めたもの {len(works)} 冊（ぜんぶで {total:,} 字）、使わなかったファイル {skipped} 個（{time.time() - t0:.0f} 秒）")
    print(f"棚に並べた本 {len(shelf)} 冊：" + "、".join(f"{a} {n}" for a, n in top))
    print(f"書き出した：{path}（{os.path.getsize(path) // 1024} KB）")
    print("もう一度走らせると、棚の本が入れかわる。")


if __name__ == "__main__":
    main()
