# -*- coding: utf-8 -*-
"""استبدال كتلة وضع الرأس في server.py بمنهج هجين:
STEP 1: تبديل هوية الوجه عبر inswapper (paste_back) — دمج بكسلي بلا حواف.
STEP 2: نقل الشعر فقط (rembg ناقص بيضاوية الوجه) بمحاذاة العينين + مطابقة
        لون/إضاءة + دمج هرمي لابلاسي.
"""
import io, sys

PATH = "/home/z/my-project/mini-services/face-swap-pro/server.py"

START = "        # ---------------- HEAD mode ----------------"
END = "        # ---------------- PERSON mode ----------------"

NEW = '''        # ---------------- HEAD mode ----------------
        if mode == "head":
            # ============================================================
            # ONE-WHOLE-IMAGE head transplant (v3 — hybrid):
            #   STEP 1 — face core: inswapper identity swap (paste_back),
            #            the same proven path as /swap. The new identity is
            #            rendered INTO the source scene at pixel level, so
            #            skin/lighting continuity is guaranteed by design —
            #            no pasted rectangle, no old-face ghost.
            #   STEP 2 — hair / head shape: transfer ONLY the hair region
            #            (rembg subject MINUS the face-core ellipse), aligned
            #            by the eye-anchored similarity transform, color and
            #            lighting matched to the scene, then Laplacian-
            #            pyramid blended. Hair overlaps the existing head and
            #            fades out — it can never look like a pasted chunk.
            # Replaces the old "paste the whole warped head" pipeline whose
            # mask failures produced the "image pasted over image" look.
            # ============================================================
            if not _swapper_ready():
                _kick_self_heal()
                return JSONResponse(
                    {"ok": False,
                     "error": "نموذج تبديل الوجه قيد التحميل — أعد المحاولة بعد دقيقة"},
                    status_code=503)
            _ensure_loaded()
            faces_src, _, _ = _detect_sorted(src, hq=True)
            faces_ref, _, _ = _detect_sorted(ref, hq=True)
            if not faces_src:
                return JSONResponse({"ok": False, "error": "لم يُعثر على وجه في الصورة المصدر"}, status_code=422)
            if not faces_ref:
                return JSONResponse({"ok": False, "error": "لم يُعثر على وجه في الصورة المرجعية"}, status_code=422)
            fs = faces_src[min(src_idx, len(faces_src) - 1)]
            fr = faces_ref[min(ref_idx, len(faces_ref) - 1)]
            import numpy as np
            import cv2

            # ---- STEP 1: seamless face-core swap (paste_back=True) ----
            before = src
            core = SWAPPER.get(src, fs, fr, paste_back=True)
            try:
                b = np.asarray(fs.bbox).flatten()
                core = _enhance_face(core, before,
                                     (int(b[0]), int(b[1]), int(b[2]), int(b[3])))
            except Exception:
                pass

            result = core

            # ---- STEP 2: hair / head-shape overlay (best-effort) ----
            try:
                # eye-anchored similarity transform ref-face → src-face
                # (deterministic — exact midpoint, scale and angle match)
                kps_s = np.asarray(fs.kps, dtype=np.float32)
                kps_r = np.asarray(fr.kps, dtype=np.float32)
                em_r = (kps_r[0] + kps_r[1]) / 2.0     # ref eye midpoint
                em_s = (kps_s[0] + kps_s[1]) / 2.0     # src eye midpoint
                dr = kps_r[1] - kps_r[0]               # ref eye vector
                ds = kps_s[1] - kps_s[0]               # src eye vector
                s_fix = float(np.hypot(ds[0], ds[1])) / max(1e-3, float(np.hypot(dr[0], dr[1])))
                theta = float(np.arctan2(ds[1], ds[0]) - np.arctan2(dr[1], dr[0]))
                cth, sth = np.cos(theta), np.sin(theta)
                R = np.array([[cth, -sth], [sth, cth]], np.float32) * s_fix
                t = em_s - R @ em_r
                M = np.hstack([R, t.reshape(2, 1)]).astype(np.float32)

                rx1, ry1, rx2, ry2 = _face_rect(fr)
                fw, fh = max(4, rx2 - rx1), max(4, ry2 - ry1)

                # hair region in REF coords: rembg subject ∩ head band,
                # band bottom at ~72% of face height → NO neck/chest/hands,
                # then MINUS the face-core ellipse → hair + top-of-head only.
                gx1 = max(0, int(rx1 - 0.65 * fw))
                gy1 = max(0, int(ry1 - 1.05 * fh))
                gx2 = min(RW, int(rx2 + 0.65 * fw))
                gy2 = min(RH, int(ry1 + 0.72 * fh))
                fc = np.zeros((RH, RW), np.uint8)
                cv2.ellipse(fc, (int((rx1 + rx2) / 2), int((ry1 + ry2) / 2 + 0.06 * fh)),
                            (max(4, int(0.60 * fw)), max(4, int(0.62 * fh))),
                            0, 0, 360, 255, -1)
                hm = None
                ref_subject = _subject_mask_full(ref, None)   # rembg (cached)
                if ref_subject is not None:
                    lim = np.zeros((RH, RW), np.uint8)
                    cv2.rectangle(lim, (gx1, gy1), (gx2, gy2), 255, -1)
                    cand = cv2.bitwise_and(ref_subject, lim)
                    cand = _largest_component(cand, thresh=40)
                    cand = cv2.bitwise_and(cand, cv2.bitwise_not(fc))
                    if (cand > 100).sum() >= 0.004 * RH * RW:
                        k = max(3, (int(0.02 * max(RH, RW))) | 1)
                        hm = cv2.GaussianBlur(cand, (k, k), 0)
                if hm is None:
                    # fallback: GrabCut on the hair band, minus the face core
                    hm = _head_mask_grabcut(ref, (gx1, gy1, gx2 - gx1, gy2 - gy1))
                    hm = cv2.bitwise_and(hm, cv2.bitwise_not(fc))

                if hm is not None and (hm > 100).sum() >= 0.003 * RH * RW:
                    hm_w = cv2.warpAffine(hm, M, (SW, SH), flags=cv2.INTER_LINEAR)
                    grow = max(2, int(0.03 * fw))
                    hm_w = cv2.dilate(hm_w, cv2.getStructuringElement(
                        cv2.MORPH_ELLIPSE, (grow * 2 + 1, grow * 2 + 1)))
                    # re-feather after interpolation so edges stay soft
                    hm_w = cv2.GaussianBlur(hm_w, (max(3, int(0.05 * fw) | 1),) * 2, 0)
                    ys, xs = np.where(hm_w > 60)
                    if len(xs) > 80:
                        bx1, bx2 = int(xs.min()), int(xs.max())
                        by1, by2 = int(ys.min()), int(ys.max())
                        sub_mask = hm_w[by1:by2 + 1, bx1:bx2 + 1]
                        k = max(3, int(0.10 * (bx2 - bx1)) | 1)
                        sub_mask = cv2.GaussianBlur(sub_mask, (k, k), 0)
                        warped = cv2.warpAffine(ref, M, (SW, SH), flags=cv2.INTER_LANCZOS4,
                                                borderMode=cv2.BORDER_CONSTANT,
                                                borderValue=(0, 0, 0))
                        cut = warped[by1:by2 + 1, bx1:bx2 + 1]
                        result = _blend_onto(core, cut, sub_mask,
                                             (bx1, by1, bx2 - bx1 + 1, by2 - by1 + 1),
                                             color_strength=color_strength)
            except Exception:
                traceback.print_exc()   # hair overlay is best-effort; core swap already good

'''

with io.open(PATH, "r", encoding="utf-8") as f:
    lines = f.readlines()

si = next(i for i, l in enumerate(lines) if l.rstrip("\n") == START)
ei = next(i for i, l in enumerate(lines) if l.rstrip("\n") == END and i > si)

new_lines = lines[:si] + [NEW] + lines[ei:]
with io.open(PATH, "w", encoding="utf-8") as f:
    f.writelines(new_lines)

print("spliced OK: head block lines %d..%d replaced" % (si + 1, ei))
