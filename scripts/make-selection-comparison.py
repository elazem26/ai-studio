#!/usr/bin/env python3
"""توليد صورة مقارنة لعناوين عربية سليمة — خطوة: تحديد بالنص + نقل."""
import os
from PIL import Image, ImageDraw, ImageFont
import arabic_reshaper
from bidi.algorithm import get_display

base = '/home/z/my-project/data/test-selection-live'
files = ['s1_head_overlay.png', 's2_hair_overlay.png',
         's3_hair_expanded_overlay.png', 's5_transplanted.png']
titles = ['1: الرأس', '2: الشعر', '3: تكبير التحديد', '4: النتيجة النهائية']

imgs = []
for f in files:
    im = Image.open(os.path.join(base, f)).convert('RGB')
    im.thumbnail((420, 420))
    imgs.append(im)

w = sum(i.width for i in imgs) + 30 * (len(imgs) + 1)
h = max(i.height for i in imgs) + 100
canvas = Image.new('RGB', (w, h), (250, 250, 250))
d = ImageDraw.Draw(canvas)
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 22)

x = 30
for t, im in zip(titles, imgs):
    rt = get_display(arabic_reshaper.reshape(t))
    d.text((x, 20), rt, fill=(25, 25, 25), font=font)
    canvas.paste(im, (x, 70))
    x += im.width + 30

out = '/home/z/my-project/download/اختبار-التحديد-بالكتابة.png'
canvas.save(out)
print('saved:', out, canvas.size)
