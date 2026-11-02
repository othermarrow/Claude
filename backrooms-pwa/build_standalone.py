"""games/ のゲームに fx.js を埋めこみ、HTML 一枚で開ける版を standalone/ に作る。

使い方: python3 build_standalone.py noclip
起動画面がないので「起動画面へ」ボタンは隠し、PWA の manifest とアイコンの読みこみは外す。
ゲームの横に置いたスクリプト（蔵守の <script src="kura/engine.js"></script> など）も、中に埋めこむ。
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
GAMES = ROOT / "games"
# games/ の中を指す、相対パスの <script src="…js"></script>（../fx.js と、http などの外のものは除く）
LOCAL_JS = re.compile(r'<script src="(?!\.\./)(?![a-z]+:)(?!/)([^"<>]+\.js)"></script>')


def inline(code):
    return "<script>\n" + code.replace("</script>", "<\\/script>") + "\n</script>"


def local_script(m):
    path = (GAMES / m.group(1)).resolve()
    if GAMES not in path.parents or not path.is_file():
        raise SystemExit(f"{m.group(1)} が games/ の中に見つからない")
    return inline(path.read_text(encoding="utf-8"))


def build(name):
    src = (GAMES / f"{name}.html").read_text(encoding="utf-8")
    fx = (ROOT / "fx.js").read_text(encoding="utf-8")
    tag = '<script src="../fx.js"></script>'
    if tag not in src:
        raise SystemExit(f"{name}.html に {tag} がない")
    out = LOCAL_JS.sub(local_script, src)
    out = out.replace(tag, inline(fx))
    out = out.replace('<link rel="manifest" href="../manifest.webmanifest">\n', "")
    out = out.replace('<link rel="icon" href="../icons/icon-192.png" type="image/png">\n', "")
    out = out.replace('id="home-btn">', 'id="home-btn" style="display:none">')
    dst = ROOT / "standalone" / f"{name}-standalone.html"
    dst.parent.mkdir(exist_ok=True)
    dst.write_text(out, encoding="utf-8")
    print(dst.relative_to(ROOT), len(out.encode("utf-8")), "bytes")


for n in sys.argv[1:] or ["noclip"]:
    build(n)
