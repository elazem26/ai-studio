#!/usr/bin/env python3
"""Generate 4 test photos with very DIFFERENT lighting/backgrounds so the
merge quality is honestly testable (indoor warm, studio white, outdoor green,
dark blue). Each image = gradient bg + person-ish subject + grain."""
import numpy as np, cv2, os

os.makedirs("/home/z/my-project/data/test-transplant", exist_ok=True)
rng = np.random.default_rng(42)
OUT = "/home/z/my-project/data/test-transplant"

def grain(img, sigma):
    n = rng.normal(0, sigma, img.shape).astype(np.float32)
    return np.clip(img.astype(np.float32) + n, 0, 255).astype(np.uint8)

def person(h=900, w=700, skin=(210, 170, 145), shirt=(60, 40, 120), hair=(30, 20, 15)):
    img = np.zeros((h, w, 3), np.uint8)
    # head
    cv2.ellipse(img, (w//2, int(h*0.22)), (int(w*0.17), int(h*0.13)), 0, 0, 360, skin, -1)
    # hair cap
    cv2.ellipse(img, (w//2, int(h*0.155)), (int(w*0.18), int(h*0.085)), 0, 180, 360, hair, -1)
    # eyes
    cv2.circle(img, (int(w*0.44), int(h*0.21)), 9, (40, 30, 25), -1)
    cv2.circle(img, (int(w*0.56), int(h*0.21)), 9, (40, 30, 25), -1)
    # shirt / body
    cv2.ellipse(img, (w//2, int(h*0.78)), (int(w*0.34), int(h*0.38)), 0, 0, 360, shirt, -1)
    cv2.rectangle(img, (int(w*0.30), int(h*0.30)), (int(w*0.42), int(h*0.62)), skin, -1)
    cv2.rectangle(img, (int(w*0.58), int(h*0.30)), (int(w*0.70), int(h*0.62)), skin, -1)
    return img

def scene(name, top, bottom, light_dir, sigma):
    h, w = 1000, 800
    grad = np.linspace(top, bottom, h, dtype=np.float32)[:, None, :].repeat(w, axis=1)
    # directional light patch
    xx, yy = np.meshgrid(np.arange(w), np.arange(h))
    gx = int(w * light_dir[0]); gy = int(h * light_dir[1])
    d = np.exp(-(((xx - gx) ** 2) + (yy - gy) ** 2) / (2 * (0.30 * max(w, h)) ** 2))
    img = np.clip(grad + d[..., None] * 70, 0, 255).astype(np.uint8)
    img = grain(img, sigma)
    p = person(skin=(210, 170, 145))
    ph, pw = p.shape[:2]
    y0 = h - ph - 30; x0 = (w - pw) // 2
    # darken the person toward scene light (source light dir)
    pf = p.astype(np.float32)
    pf = pf * (0.55 + 0.45 * d[y0:y0+ph, x0:x0+pw][..., None])
    img[y0:y0+ph, x0:x0+pw] = np.clip(pf, 0, 255).astype(np.uint8)
    cv2.imwrite(f"{OUT}/{name}.png", img)
    print(name, img.shape)

# 1) indoor warm lamp, heavy grain
scene("src_indoor", (40, 30, 25), (95, 70, 50), (0.3, 0.2), 5.0)
# 2) clean studio white-blue, almost no grain  → strong lighting mismatch
scene("ref_studio", (225, 230, 235), (245, 246, 250), (0.7, 0.15), 0.6)
# 3) outdoor green field, medium grain
scene("ref_outdoor", (70, 120, 60), (150, 190, 120), (0.5, 0.1), 3.0)
# 4) dark blue night, strong grain
scene("src_night", (15, 10, 30), (35, 25, 60), (0.5, 0.8), 7.0)
print("done")
