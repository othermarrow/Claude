"""games/ のゲームに fx.js を埋めこみ、HTML 一枚で開ける版を standalone/ に作る。

使い方: python3 build_standalone.py tane-wo-niru
起動画面がないので「起動画面へ」ボタンは隠し、PWA の manifest は外す。
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent


def build(name):
    src = (ROOT / "games" / f"{name}.html").read_text(encoding="utf-8")
    fx = (ROOT / "fx.js").read_text(encoding="utf-8")
    tag = '<script src="../fx.js"></script>'
    if tag not in src:
        raise SystemExit(f"{name}.html に {tag} がない")
    out = src.replace(tag, "<script>\n" + fx.replace("</script>", "<\\/script>") + "\n</script>")
    out = out.replace('<link rel="manifest" href="../manifest.webmanifest">\n', "")
    out = out.replace('id="home-btn">', 'id="home-btn" style="display:none">')
    dst = ROOT / "standalone" / f"{name}-standalone.html"
    dst.parent.mkdir(exist_ok=True)
    dst.write_text(out, encoding="utf-8")
    print(dst.relative_to(ROOT), len(out.encode("utf-8")), "bytes")


for n in sys.argv[1:] or ["tane-wo-niru"]:
    build(n)
