#!/usr/bin/env python3
"""ブラウザ版（web/zork-ja.html と web/zork-ja-standalone.html）を組み立てる。

src/page.html に、ゲームファイル・辞書（../data/*.tsv）・スクリプトを埋め込んで
1 枚の HTML にする。ゲームファイルは ../game/zork1.z3 を使い、なければ取ってくる。
"""
import base64
import json
import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
STORY_URL = ("https://raw.githubusercontent.com/historicalsource/zork1/"
             "master/COMPILED/zork1.z3")


def read(*p):
    with open(os.path.join(*p), encoding="utf-8") as f:
        return f.read()


def story_bytes():
    path = os.path.join(ROOT, "game", "zork1.z3")
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        urllib.request.urlretrieve(STORY_URL, path)
    with open(path, "rb") as f:
        return f.read()


def main():
    data = {name: read(ROOT, "data", name + ".tsv")
            for name in ("names", "messages", "patterns", "verbs", "nouns", "verbs_en")}
    data["story"] = base64.b64encode(story_bytes()).decode("ascii")
    scripts = "\n".join([
        "const ZDATA = " + json.dumps(data, ensure_ascii=False) + ";",
        read(HERE, "src", "zmachine.js"),
        read(HERE, "src", "translate.js"),
        read(HERE, "src", "scene.js"),
        read(HERE, "src", "app.js"),
    ])
    # </script> が中に現れると HTML が途中で切れるので避ける
    scripts = scripts.replace("</script", "<\\/script")
    page = read(HERE, "src", "page.html").replace("/*@SCRIPTS@*/", scripts)
    # zork-ja.html は claude.ai に公開する用（ページの頭は公開時に付く）
    write("zork-ja.html", page)
    # zork-ja-standalone.html は Tasker のシーンやブラウザで直接開く用
    write("zork-ja-standalone.html", STANDALONE_HEAD + page + "\n</body>\n</html>\n")


STANDALONE_HEAD = """<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>body{margin:0}</style>
</head>
<body>
"""


def write(name, text):
    out = os.path.join(HERE, name)
    with open(out, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"{out} ({len(text.encode('utf-8')) // 1024} KB)")


if __name__ == "__main__":
    main()
