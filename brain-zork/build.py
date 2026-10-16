#!/usr/bin/env python3
"""Tasker のシーンやブラウザで直接開く版（brain-zork-standalone.html）を作る。

brain-zork.html は claude.ai に公開する形（ページの頭は公開時に付く）なので、
頭の部分を足して 1 枚の HTML にする。
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
HEAD = """<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
</head>
<body>
"""

with open(os.path.join(HERE, "brain-zork.html"), encoding="utf-8") as f:
    page = f.read()
out = os.path.join(HERE, "brain-zork-standalone.html")
with open(out, "w", encoding="utf-8") as f:
    f.write(HEAD + page + "\n</body>\n</html>\n")
print(out)
