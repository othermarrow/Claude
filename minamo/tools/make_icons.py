"""ミナモのアイコンを作る（水面の波紋）。python3 tools/make_icons.py"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "icons")
BG, LINE = (7, 9, 10), (169, 201, 176)


def draw(size, safe):
    s = 4                                      # 大きく描いて縮める（線をなめらかに）
    W = size * s
    im = Image.new("RGB", (W, W), BG)
    d = ImageDraw.Draw(im)
    cx, cy = W / 2, W * 0.56
    r = W * safe / 2
    for i, k in enumerate((1.0, 0.72, 0.46, 0.22)):
        rx, ry = r * k, r * k * 0.32
        a = int(255 * (0.35 + 0.65 * (1 - i / 4)))
        col = tuple(int(BG[j] + (LINE[j] - BG[j]) * a / 255) for j in range(3))
        d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), outline=col, width=max(2, W // 110))
    # 落ちてくる一滴
    dr = W * 0.035
    d.ellipse((cx - dr, cy - r * 0.62 - dr, cx + dr, cy - r * 0.62 + dr), fill=LINE)
    return im.resize((size, size), Image.LANCZOS)


os.makedirs(OUT, exist_ok=True)
draw(192, 0.82).save(os.path.join(OUT, "icon-192.png"))
draw(512, 0.82).save(os.path.join(OUT, "icon-512.png"))
draw(512, 0.62).save(os.path.join(OUT, "maskable-512.png"))
print("ok")
