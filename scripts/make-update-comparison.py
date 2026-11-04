#!/usr/bin/env python3
"""صورة مقارنة لعناصر التحديث: الهدف الأصلي + نتيجتا النقل بعناوين عربية."""
import os
import arabic_reshaper
from bidi.algorithm import get_display
from PIL import Image, ImageDraw, ImageFont

OUT = "/home/z/my-project/data/update-test"
PANEL_W, PAD, TITLE_H = 560, 16, 54
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

items = [
    ("/tmp/photo_b.png", "الصورة الهدف (قبل)"),
    (os.path.join(OUT, "a_head.png"), "نقل الرأس — دمج inswapper"),
    (os.path.join(OUT, "b_hair.png"), "نقل الشعر — دمج مخصص"),
]


def ar(t):
    return get_display(arabic_reshaper.reshape(t))


def load_panel(path):
    im = Image.open(path).convert("RGB")
    s = PANEL_W / im.width
    return im.resize((PANEL_W, int(im.height * s)), Image.LANCZOS)


panels = []
for path, title in items:
    if not os.path.exists(path):
        print(f"مفقود: {path}")
        continue
    panels.append((load_panel(path), ar(title)))

if not panels:
    raise SystemExit("لا توجد لوحات")

max_h = max(p.height for p, _ in panels)
W = PANEL_W * len(panels) + PAD * (len(panels) + 1)
H = PAD + TITLE_H + max_h + PAD
canvas = Image.new("RGB", (W, H), (246, 247, 250))
draw = ImageDraw.Draw(canvas)
font = ImageFont.truetype(FONT, 26)

x = PAD
for im, title in panels:
    ty = PAD + (TITLE_H - 26) // 2
    tw = draw.textlength(title, font=font)
    draw.text((x + (PANEL_W - tw) / 2, ty), title, font=font, fill=(30, 32, 38))
    canvas.paste(im, (x, PAD + TITLE_H))
    draw.rectangle([x - 1, PAD + TITLE_H - 1, x + PANEL_W, PAD + TITLE_H + im.height],
                   outline=(210, 214, 222), width=1)
    x += PANEL_W + PAD

out_path = "/home/z/my-project/download/نتيجة-التحديث-الدمج-السلس.png"
canvas.save(out_path, quality=92)
print(out_path)
