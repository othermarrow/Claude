#!/usr/bin/env python3
"""yoru-shoko の下準備をする。

- ../zork-ja/data/*.tsv から、Zork I の日本語辞書 dict.js を作る
- ../zork-ja/web/src/translate.js を translate.js にコピーする
- stories/ に Zork I〜III（MIT ライセンス）を取ってくる（なければ）
"""
import json
import os
import shutil
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ZJ = os.path.join(os.path.dirname(ROOT), "zork-ja")
BASE = "https://raw.githubusercontent.com/historicalsource/zork%d/master/%s"


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def main():
    data = {n: read(os.path.join(ZJ, "data", n + ".tsv"))
            for n in ("names", "messages", "patterns", "verbs", "nouns", "verbs_en")}
    out = os.path.join(ROOT, "dict.js")
    with open(out, "w", encoding="utf-8") as f:
        f.write("// 自動生成: tools/build.py（元は zork-ja/data/*.tsv）\nconst ZDICT = "
                + json.dumps(data, ensure_ascii=False) + ";\n")
    shutil.copy(os.path.join(ZJ, "web", "src", "translate.js"), os.path.join(ROOT, "translate.js"))
    os.makedirs(os.path.join(ROOT, "stories"), exist_ok=True)
    for n in (1, 2, 3):
        path = os.path.join(ROOT, "stories", "zork%d.z3" % n)
        if not os.path.exists(path):
            urllib.request.urlretrieve(BASE % (n, "COMPILED/zork%d.z3" % n), path)
        print(path, os.path.getsize(path))
    lic = os.path.join(ROOT, "stories", "LICENSE-zork.txt")
    if not os.path.exists(lic):
        urllib.request.urlretrieve(BASE % (1, "LICENSE"), lic)


if __name__ == "__main__":
    main()
