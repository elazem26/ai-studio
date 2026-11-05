"""regions.py — تحديد المناطق بالنص العربي (Selection Engine).

يحوّل وصفاً عربياً («الرأس»، «الشعر فقط»، «الجهة اليسرى من الخلفية»،
«الشخص الثاني»…) إلى قناع بكسلي + معاينة ملوّنة تظهر على الصورة، بحيث
يرى المستخدم التحديد قبل التنفيذ ويعدّل كلماته حتى يصبح صحيحاً.

القناع يُبنى من مصادر حتمية:
  - insightface (bbox + kps + landmark_3d_68) للوجه والعين والأنف والفم
  - rembg subject mask للشخص/الكائن/الخلفية
  - نطاقات نسبية لارتفاع الوجه للصدر/الجذع/الذراعين/الرجلين
"""
import re

import numpy as np
import cv2

# ---------------------------------------------------------------- labels
LABELS = {
    "head": "الرأس",
    "face": "الوجه",
    "hair": "الشعر",
    "eyes": "العينان",
    "nose": "الأنف",
    "mouth": "الفم",
    "chest": "الصدر والكتفان",
    "torso": "الجذع",
    "arms": "الذراعان",
    "legs": "الرجلان",
    "person": "الشخص كاملاً",
    "foreground": "الموضوع الأمامي",
    "object": "الكائن/الرسمة",
    "background": "الخلفية",
    "bbox": "منطقة مخصصة",
}
SIDE_AR = {"left": "الجهة اليسرى", "right": "الجهة اليمنى",
           "top": "الجزء العلوي", "bottom": "الجزء السفلي"}

# نطاقات (أعلى، أسفل) × ارتفاع الوجه من أعلى مستطيل الوجه — نفس ثوابت
# مسار person في server.py حتى تتطابق المعاينة مع التنفيذ.
BANDS = {
    "hair": (-1.05, 0.72),
    "chest": (1.02, 1.85),
    "torso": (1.02, 2.60),
    "arms": (1.02, 2.35),
    "legs": (2.10, 9.00),
}
BODY_PARTS = {"chest", "torso", "arms", "legs", "person"}

SUGGESTIONS = [
    "الرأس", "الوجه", "الشعر", "العينان", "الأنف", "الفم",
    "الصدر", "الجذع", "الذراعان", "الرجلان",
    "الشخص كاملاً", "الشخص الثاني", "الشخص على اليمين",
    "الخلفية", "الجهة اليسرى من الخلفية", "النصف العلوي",
    "القط / الكائن / الرسمة",
]

_ORDINALS = [
    ("الاول", 0), ("اول", 0),
    ("الثاني", 1), ("الثاني", 1), ("ثاني", 1),
    ("الثالث", 2), ("ثالث", 2),
    ("الرابع", 3), ("رابع", 3),
    ("الخامس", 4), ("خامس", 4),
]


def normalize_ar(text: str) -> str:
    """توحيد النص العربي: همزات، تشكيل، ة/ى/ؤ/ئ."""
    import re
    t = str(text or "")
    t = re.sub(r"[ًٌٍَُِّْـ]", "", t)
    t = t.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
    t = t.replace("ة", "ه").replace("ى", "ي").replace("ؤ", "و").replace("ئ", "ي")
    return re.sub(r"\s+", " ", t).strip().lower()


def parse_region_text(text, faces=None, W=1, H=1):
    """نص عربي → (spec, label) أو (None, None) إذا لم يُفهم.

    faces: قائمة وجوه insightface (لاختيار الشخص الأول/الثاني/يمين الصورة).
    """
    t = normalize_ar(text)
    if not t:
        return None, None
    faces = faces or []

    # شريط الأمان اللغوي: كلمات وظيفية يتكلم بها المستخدم («أخت عن المكان
    # يعني التحديد») كانت تُطابق حرفياً أجزاءً خاطئة («التحديد» تحتوي «يد»
    # → تطابق «الذراعان»!). تُحذف قبل أي مطابقة أجزاء.
    t = re.sub(r"التحديدات|التحديد|تحديدات|تحديد|متحدد|يتحدد|حدد|حديدان|يعني|ياعني|يارا|رجاء|لطفا|محتاج|ابغى|اريد", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    if not t:
        return {"part": "background"}, "الخلفية"

    def has(*ws):
        return any(w in t for w in ws)

    # --- نصف الصورة (بإحداثيات) ---
    if has("نصف", "نص الصوره"):
        if has("علوي", "فوق", "اعلي"):
            return {"part": "bbox", "bbox": [0, 0, 1, 0.5]}, "النصف العلوي من الصورة"
        if has("سفلي", "تحت", "اسفل"):
            return {"part": "bbox", "bbox": [0, 0.5, 1, 1]}, "النصف السفلي من الصورة"
        if has("يمين"):
            return {"part": "bbox", "bbox": [0.5, 0, 1, 1]}, "النصف الأيمن من الصورة"
        if has("يسار"):
            return {"part": "bbox", "bbox": [0, 0, 0.5, 1]}, "النصف الأيسر من الصورة"

    # --- الجهة (من منظور المشاهد) ---
    side = None
    if has("يسار"):
        side = "left"
    elif has("يمين"):
        side = "right"
    elif has("علوي", "اعلي", "فوقاني"):
        side = "top"
    elif has("سفلي", "اسفل", "تحتاني"):
        side = "bottom"

    # --- الجزء المطلوب ---
    # ملاحظة ترتيب حساسة: «الذراعين» تحتوي «عين» حرفياً — الأجزاء متعددة
    # الأحرف (ذراع/صدر/جذع/رجل/شعر/راس) تُفحص قبل الأجزاء الدقيقة للوجه.
    part = None
    if has("خلفيه", "مكان"):
        part = "background"
    elif has("شعر", "سبلت", "غره"):
        part = "hair"
    elif has("ذراع", "اذراع", "ايد", "يد", "كف"):
        part = "arms"
    elif has("صدر", "كتف"):
        part = "chest"
    elif has("جذع", "بطن", "وسط الجسم", "ملابس", "لبس", "تيشيرت", "قميص"):
        part = "torso"
    elif has("رجلين", "رجل", "ساق", "ارجل", "قدم"):
        part = "legs"
    elif has("راس", "قمه"):
        part = "head"
    elif has("وجه", "بشره", "ملامح"):
        part = "face"
    elif has("عيون", "عين"):
        part = "eyes"
    elif has("انف", "مناخير"):
        part = "nose"
    elif has("فم", "بوز", "شفاه", "شفايف", "فمك"):
        part = "mouth"
    elif has("شخص") or has("انسان"):
        part = "person"
    elif has("قط", "كلب", "حيوان", "طير", "طائر", "حصان", "كائن",
             "رسمه", "شعار", "سياره", "زهره", "منتج", "عربه", "دجاج"):
        part = "object"
    elif has("جسم"):
        part = "person"
    if part is None:
        return None, None

    spec = {"part": part}

    # --- ترتيب الوجه (الأول/الثاني/يمين الصورة) ---
    idx = None
    for w, i in _ORDINALS:
        if w in t:
            idx = i
            break
    if idx is None and side in ("left", "right") and len(faces) > 1 \
            and part in ("person", "head", "face", "hair"):
        # ترتيب الوجوه من يسار الصورة إلى يمينها
        order = sorted(range(len(faces)),
                       key=lambda i: float(np.asarray(faces[i].bbox).flatten()[0]))
        idx = order[-1] if side == "right" else order[0]
    if idx is not None:
        spec["faceIndex"] = idx

    if side:
        spec["side"] = side

    label = LABELS.get(part, part)
    if side:
        label += f" — {SIDE_AR[side]}"
    if idx is not None and len(faces) > 1:
        label += f" — الشخص رقم {idx + 1}"
    return spec, label


def needs_subject(part: str) -> bool:
    return part in ("head", "hair", "chest", "torso", "arms", "legs",
                    "person", "foreground", "object", "background")


# ------------------------------------------------------------- helpers
def _frect(f):
    b = np.asarray(f.bbox).flatten()
    return float(b[0]), float(b[1]), float(b[2]), float(b[3])


def _kps(f):
    try:
        return np.asarray(f.kps, dtype=np.float32)
    except Exception:
        return None


def _landmarks68(f):
    try:
        lm = np.asarray(f.landmark_3d_68, dtype=np.float32)
        return lm[:, :2]
    except Exception:
        return None


def _feather(m, frac=0.04):
    h, w = m.shape[:2]
    k = max(3, int(frac * max(h, w)) | 1)
    return cv2.GaussianBlur(m, (k, k), 0)


def _ramped_band(H, W, btop, bbot):
    """شريط أفقي بحواف متدرجة (بدون خط قطع حاد)."""
    band = np.zeros((H, W), np.uint8)
    band[max(0, btop):min(H, bbot), :] = 255
    ramp = max(2, int(0.16 * (bbot - btop)))
    for i in range(ramp):
        wgt = int(255 * (i + 1) / (ramp + 1))
        if btop + i < H:
            band[btop + i, :] = np.minimum(band[btop + i, :], wgt)
        j = bbot - 1 - i
        if 0 <= j < H:
            band[j, :] = np.minimum(band[j, :], wgt)
    return band


def _subject_components(subject):
    """مكونات متصلة لقناع الموضوع — الأكبر أولاً."""
    sm = (subject > 100).astype(np.uint8) * 255
    n, lab, stats, _ = cv2.connectedComponentsWithStats(sm, 8)
    if n <= 1:
        return None, None, None
    order = np.argsort(-stats[1:, cv2.CC_STAT_AREA]) + 1
    return lab, stats, order


def _apply_side(m, side, H, W):
    if not side or m is None:
        return m
    r = 0.06
    gx = np.linspace(0, 1, W, dtype=np.float32)[None, :]
    gy = np.linspace(0, 1, H, dtype=np.float32)[:, None]
    if side == "left":
        wgt = np.clip((0.5 - gx) / r, 0, 1)
    elif side == "right":
        wgt = np.clip((gx - 0.5) / r, 0, 1)
    elif side == "top":
        wgt = np.clip((0.5 - gy) / r, 0, 1)
    else:
        wgt = np.clip((gy - 0.5) / r, 0, 1)
    return (m.astype(np.float32) * wgt).astype(np.uint8)


# ------------------------------------------------------------- builder
def build_mask(img, spec, faces=None, subject=None):
    """spec → (mask uint8 0..255, label عربي) أو (None, سبب الفشل)."""
    H, W = img.shape[:2]
    faces = faces or []
    part = str((spec or {}).get("part") or "").lower()
    side = (spec or {}).get("side")
    label = LABELS.get(part, part)
    if part not in LABELS:
        return None, f"نوع غير مدعوم: {part}"

    fi = int((spec or {}).get("faceIndex") or 0)
    fi = max(0, min(fi, len(faces) - 1)) if faces else 0
    f = faces[fi] if faces else None

    m = None

    # ---- أجزاء الوجه الدقيقة (تحتاج وجهاً) ----
    if part == "face":
        if f is None:
            return None, "لم يُعثر على وجه لتحديد «الوجه»"
        lm = _landmarks68(f)
        if lm is not None and len(lm) >= 60:
            hull = cv2.convexHull(lm.reshape(-1, 1, 2).astype(np.float32))
            m = np.zeros((H, W), np.uint8)
            cv2.fillPoly(m, [hull.astype(np.int32)], 255)
            m = _feather(m, 0.05)
        else:
            x1, y1, x2, y2 = _frect(f)
            fw, fh = x2 - x1, y2 - y1
            m = np.zeros((H, W), np.uint8)
            cv2.ellipse(m, (int((x1 + x2) / 2), int((y1 + y2) / 2 + 0.03 * fh)),
                        (int(0.46 * fw), int(0.52 * fh)), 0, 0, 360, 255, -1)
            m = _feather(m, 0.06)

    elif part in ("eyes", "nose", "mouth"):
        if f is None:
            return None, f"لم يُعثر على وجه لتحديد «{label}»"
        kps = _kps(f)
        x1, y1, x2, y2 = _frect(f)
        fw, fh = x2 - x1, y2 - y1
        m = np.zeros((H, W), np.uint8)
        if part == "eyes":
            r = max(4, int(0.17 * fh))
            if kps is not None and len(kps) >= 2:
                for i in (0, 1):
                    cv2.circle(m, (int(kps[i][0]), int(kps[i][1])), r, 255, -1)
            else:
                ey = int(y1 + 0.38 * fh)
                cv2.circle(m, (int(x1 + 0.30 * fw), ey), r, 255, -1)
                cv2.circle(m, (int(x1 + 0.70 * fw), ey), r, 255, -1)
        elif part == "nose":
            c = kps[2] if kps is not None and len(kps) >= 3 else \
                ((x1 + x2) / 2.0, y1 + 0.55 * fh)
            cv2.ellipse(m, (int(c[0]), int(c[1])),
                        (max(4, int(0.12 * fw)), max(4, int(0.10 * fh))),
                        0, 0, 360, 255, -1)
        else:
            if kps is not None and len(kps) >= 5:
                c = ((kps[3][0] + kps[4][0]) / 2.0, (kps[3][1] + kps[4][1]) / 2.0)
            else:
                c = ((x1 + x2) / 2.0, y1 + 0.78 * fh)
            cv2.ellipse(m, (int(c[0]), int(c[1])),
                        (max(4, int(0.20 * fw)), max(4, int(0.11 * fh))),
                        0, 0, 360, 255, -1)
        m = _feather(m, 0.30)

    elif part in BANDS:
        # شعر/صدر/جذع/ذراعين/رجلين — نطاق نسبي لارتفاع الوجه
        if f is not None:
            x1, y1, x2, y2 = _frect(f)
            fh = max(4.0, y2 - y1)
            top_rel, bot_rel = BANDS[part]
            btop = max(0, int(y1 + top_rel * fh))
            bbot = min(H, int(y1 + bot_rel * fh))
            if bbot - btop < 8:
                return None, f"«{label}» خارج حدود الصورة"
        elif subject is not None:
            # بدون وجه (حيوان/كائن): الجزء العلوي/السفلي من الموضوع
            ys, xs = np.where(subject > 100)
            if len(xs) < 100:
                return None, f"لم أعثر على موضوع لتحديد «{label}»"
            sy1, sy2 = int(ys.min()), int(ys.max())
            sh = sy2 - sy1
            if part == "hair":
                btop, bbot = sy1, sy1 + int(0.45 * sh)
            elif part == "legs":
                btop, bbot = sy1 + int(0.62 * sh), sy2
            else:
                btop, bbot = sy1 + int(0.40 * sh), sy2
        else:
            return None, f"«{label}» يحتاج وجهاً واضحاً أو موضوعاً معروفاً"
        m = _ramped_band(H, W, btop, bbot)
        if subject is not None:
            m = (m.astype(np.float32) * (subject.astype(np.float32) / 255.0)).astype(np.uint8)
        if part == "hair" and f is not None:
            # استبعاد الوجه من قناع الشعر (بدون وجه شبحي)
            fw = max(4, x2 - x1)
            kf = np.zeros((H, W), np.uint8)
            cv2.rectangle(kf,
                          (max(0, int(x1 - 0.10 * fw)), max(0, int(y1 - 0.02 * fh))),
                          (min(W, int(x2 + 0.10 * fw)), min(H, int(y2 + 0.10 * fh))),
                          255, -1)
            kf = cv2.GaussianBlur(kf, (max(3, int(0.10 * fw)) | 1,) * 2, 0)
            m = (m.astype(np.float32) * (1.0 - kf.astype(np.float32) / 255.0)).astype(np.uint8)
        m = _feather(m, 0.02)

    elif part == "head":
        if f is not None:
            x1, y1, x2, y2 = _frect(f)
            fw, fh = x2 - x1, y2 - y1
            hx1, hy1 = max(0, int(x1 - 0.30 * fw)), max(0, int(y1 - 0.95 * fh))
            hx2, hy2 = min(W, int(x2 + 0.30 * fw)), min(H, int(y2 + 0.30 * fh))
            m = np.zeros((H, W), np.uint8)
            cv2.ellipse(m, (int((hx1 + hx2) / 2), int((hy1 + hy2) / 2)),
                        (max(4, int((hx2 - hx1) / 2)), max(4, int((hy2 - hy1) / 2))),
                        0, 0, 360, 255, -1)
        elif subject is not None:
            lab, stats, order = _subject_components(subject)
            if lab is None:
                return None, "لم أعثر على موضوع لتحديد «الرأس»"
            li = order[0]
            ys, xs = np.where(lab == li)
            sy1, sy2 = int(ys.min()), int(ys.max())
            sx1, sx2 = int(xs.min()), int(xs.max())
            sw, sh = sx2 - sx1, sy2 - sy1
            m = np.zeros((H, W), np.uint8)
            cv2.ellipse(m, (int(sx1 + sw / 2), int(sy1 + sh * 0.24)),
                        (max(4, int(sw * 0.42)), max(4, int(sh * 0.22))),
                        0, 0, 360, 255, -1)
        else:
            return None, "«الرأس» يحتاج وجهاً واضحاً أو موضوعاً معروفاً"
        if subject is not None:
            m = (m.astype(np.float32) * (subject.astype(np.float32) / 255.0)).astype(np.uint8)
        m = _feather(m, 0.05)

    elif part in ("person", "foreground", "object"):
        if subject is None:
            return None, "تعذر فصل الموضوع عن الخلفية (rembg) — جرّب صورة أوضح"
        lab, stats, order = _subject_components(subject)
        if lab is None:
            return None, "لم أعثر على موضوع واضح في الصورة"
        li = order[0]
        if f is not None and part == "person":
            fx1, fy1, fx2, fy2 = _frect(f)
            cx, cy = int((fx1 + fx2) / 2), int((fy1 + fy2) / 2)
            inside = lab[min(H - 1, max(0, cy)), min(W - 1, max(0, cx))]
            if inside != 0:
                li = inside
        m = (lab == li).astype(np.uint8) * 255
        m = _feather(m, 0.025)

    elif part == "background":
        if subject is None:
            m = np.full((H, W), 255, np.uint8)
        else:
            m = 255 - (subject > 100).astype(np.uint8) * 255
        m = _feather(m, 0.02)

    elif part == "bbox":
        bx = spec.get("bbox") or [0, 0, 1, 1]
        try:
            x1, y1, x2, y2 = [float(v) for v in bx[:4]]
        except Exception:
            return None, "إحداثيات المنطقة غير صالحة"
        x1, x2 = sorted((max(0.0, min(1.0, x1)), max(0.0, min(1.0, x2))))
        y1, y2 = sorted((max(0.0, min(1.0, y1)), max(0.0, min(1.0, y2))))
        m = np.zeros((H, W), np.uint8)
        cv2.rectangle(m, (int(x1 * W), int(y1 * H)),
                      (min(W - 1, int(x2 * W)), min(H - 1, int(y2 * H))), 255, -1)
        m = _feather(m, 0.03)
        label = "منطقة مخصصة"

    if m is None:
        return None, f"تعذر بناء تحديد «{label}»"

    # ---- معدّلات ----
    m = _apply_side(m, side, H, W)

    ex = float(spec.get("expand") or 0.0)
    if abs(ex) > 0.01:
        px = int(abs(ex) * max(H, W) * 0.25)
        if px > 0:
            kern = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (px * 2 + 1, px * 2 + 1))
            m = cv2.dilate(m, kern) if ex > 0 else cv2.erode(m, kern)

    exc = spec.get("exclude")
    if isinstance(exc, dict) and exc.get("part"):
        em, _ = build_mask(img, exc, faces, subject)
        if em is not None:
            m = (m.astype(np.float32) * (1.0 - em.astype(np.float32) / 255.0)).astype(np.uint8)

    if side:
        label += f" — {SIDE_AR.get(side, side)}"
    return m, label


# ------------------------------------------------------------- preview
def render_overlay(img, mask):
    """الصورة + تظليل أخضر شفاف على التحديد + حدود بارزة."""
    H, W = img.shape[:2]
    ov = img.astype(np.float32).copy()
    a = (mask.astype(np.float32) / 255.0) * 0.45
    color = np.array([70.0, 220.0, 110.0], np.float32)  # أخضر (BGR)
    for c in range(3):
        ov[:, :, c] = ov[:, :, c] * (1 - a) + color[c] * a
    ov = ov.astype(np.uint8)
    cnts, _ = cv2.findContours((mask > 110).astype(np.uint8),
                               cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(ov, cnts, -1, (40, 255, 160), max(2, W // 320))
    return ov


def bbox_norm(mask):
    ys, xs = np.where(mask > 60)
    if len(xs) == 0:
        return None
    H, W = mask.shape[:2]
    return [round(float(xs.min()) / W, 4), round(float(ys.min()) / H, 4),
            round(float(xs.max()) / W, 4), round(float(ys.max()) / H, 4)]
