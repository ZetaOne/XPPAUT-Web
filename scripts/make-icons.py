#!/usr/bin/env python3
"""Make the web and Android icons from docs/xpp-icon.png (512x512).

Run from the project root:  python3 scripts/make-icons.py
- public/favicon-16.png, favicon-32.png, apple-touch-icon.png (180),
  icon-192.png, icon-512.png: the picture itself, scaled
- public/icon-maskable-512.png: the picture at 80% on its grey, so a
  circular mask (the "safe zone") does not cut it
- android/.../mipmap-*/ic_launcher_fg.png: adaptive-icon foreground, the
  picture in the visible 72 of the 108 dp, on its grey
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = Image.open(os.path.join(ROOT, "docs", "xpp-icon.png")).convert("RGBA")
GREY = (60, 61, 66, 255)  # the picture's background (#3c3d42)


def scaled(size):
    return src.resize((size, size), Image.LANCZOS)


def on_grey(canvas, inner):
    im = Image.new("RGBA", (canvas, canvas), GREY)
    off = (canvas - inner) // 2
    im.paste(scaled(inner), (off, off))
    return im


pub = os.path.join(ROOT, "public")
for name, size in [("favicon-16.png", 16), ("favicon-32.png", 32),
                   ("apple-touch-icon.png", 180), ("icon-192.png", 192),
                   ("icon-512.png", 512)]:
    im = scaled(size)
    if name == "apple-touch-icon.png":
        im = im.convert("RGB")  # iOS wants no transparency
    im.save(os.path.join(pub, name), optimize=True)
on_grey(512, 410).save(os.path.join(pub, "icon-maskable-512.png"), optimize=True)

res = os.path.join(ROOT, "android", "app", "src", "main", "res")
for dpi, px in [("mdpi", 108), ("hdpi", 162), ("xhdpi", 216),
                ("xxhdpi", 324), ("xxxhdpi", 432)]:
    on_grey(px, round(px * 72 / 108)).save(
        os.path.join(res, "mipmap-" + dpi, "ic_launcher_fg.png"), optimize=True)
print("icons written")
