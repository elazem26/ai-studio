"""
face-swap-pro — FastAPI service for swapping faces between two images.

Uses insightface + inswapper_128.onnx for actual face swapping.
Listens on port 3030.

Also provides:
  /detect         — numbered face boxes (normalized) for UI overlay
  /detect-persons — face-anchored TORSO boxes (for clothing swap UI)
  /swap           — face swap with per-face indices / multi-mappings
  /video-job      — background VIDEO jobs: face swap (tracking) or
                    garment recolor, with progress polling
"""
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import base64, io, os, traceback
import threading, time, uuid, subprocess, math


# ---------------------------------------------------------------------------
# onnxruntime tuning for small-core containers (2 vCPU).
# Default ORT worker threads BUSY-WAIT ("spin") between ops, which murders
# throughput when other processes (next-server, ffmpeg) share the same cores.
# Measured on this box: 1560ms → 824ms per 320px detection (1.9x faster).
# Must run BEFORE any InferenceSession is created.
# ---------------------------------------------------------------------------
def _tune_onnxruntime():
    try:
        import onnxruntime as ort

        # Patch the __init__ METHOD (not the class itself): insightface does
        # `class PickableInferenceSession(onnxruntime.InferenceSession)` at
        # import time — replacing the class with a function breaks that with
        # "TypeError: function() argument 'code' must be code, not str".
        _orig_init = ort.InferenceSession.__init__

        def _patched_init(self, path_or_bytes, sess_options=None, *args, **kw):
            try:
                if sess_options is None:
                    so = ort.SessionOptions()
                    so.intra_op_num_threads = 2
                    so.inter_op_num_threads = 1
                    so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
                    try:
                        so.add_session_config_entry("session.intra_op.allow_spinning", "0")
                    except Exception:
                        pass
                    so.log_severity_level = 3
                    sess_options = so
            except Exception:
                pass
            return _orig_init(self, path_or_bytes, sess_options=sess_options, *args, **kw)

        ort.InferenceSession.__init__ = _patched_init
    except Exception:
        pass


_tune_onnxruntime()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "inswapper_128.onnx")
SWAPPER = None
FACE_APP = None
FACE_APP_HQ = None


def _ensure_loaded():
    """Lazily load the model on first swap request (saves memory when unused)."""
    global SWAPPER, FACE_APP
    if SWAPPER is not None and FACE_APP is not None:
        return
    if not os.path.exists(MODEL_PATH):
        raise RuntimeError(
            f"Model file not found at {MODEL_PATH}. Download inswapper_128.onnx "
            "from https://huggingface.co/ModelsLab/inswapper/resolve/main/inswapper_128.onnx"
        )
    import cv2
    import numpy as np
    from PIL import Image
    from insightface.app import FaceAnalysis
    from insightface.model_zoo import get_model

    FACE_APP = FaceAnalysis(name="buffalo_l", providers=("CPUExecutionProvider",))
    FACE_APP.prepare(ctx_id=0, det_size=(320, 320))
    SWAPPER = get_model(MODEL_PATH, providers=("CPUExecutionProvider",))


def _ensure_hq():
    """Second FaceAnalysis with 640px detection — used for STILL images.

    Higher det_size finds smaller faces and produces tighter landmarks,
    which improves both the UI boxes and the swap crops. The video
    pipeline keeps the 320px app for per-frame speed.
    """
    global FACE_APP_HQ
    if FACE_APP_HQ is not None:
        return FACE_APP_HQ
    from insightface.app import FaceAnalysis

    FACE_APP_HQ = FaceAnalysis(name="buffalo_l", providers=("CPUExecutionProvider",))
    FACE_APP_HQ.prepare(ctx_id=0, det_size=(640, 640))
    return FACE_APP_HQ


def _load_image(s: str):
    """Load an image from a data URL, base64 string, or file path."""
    import cv2
    import numpy as np
    from PIL import Image

    if s.startswith("data:"):
        b = s.split(",", 1)[1]
        pil = Image.open(io.BytesIO(base64.b64decode(b))).convert("RGB")
        return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
    if s.startswith("http://") or s.startswith("https://"):
        # Allow URLs (won't be used in our app, but supports external testing)
        import urllib.request

        arr = np.asarray(bytearray(urllib.request.urlopen(s).read()), dtype=np.uint8)
        return cv2.imdecode(arr, cv2.IMREAD_COLOR)
    # File path
    return cv2.imread(s)


def _encode_png(img) -> str:
    """Encode a BGR image as a data URL PNG."""
    import cv2
    _, buf = cv2.imencode(".png", img)
    return f"data:image/png;base64,{base64.b64encode(buf.tobytes()).decode()}"


def _detect_sorted(img, hq=False):
    """Detect faces in a BGR image, sorted by bbox area (largest first).

    The SAME ordering is used by /detect (which reports indices to the UI)
    and /swap (which resolves indices), so index N always refers to the
    same face in both endpoints.
    hq=True → 640px detector (still images). Default 320px (video frames).
    Returns (faces, img_w, img_h).
    """
    import numpy as np
    app = _ensure_hq() if hq else FACE_APP
    faces = app.get(img)
    h, w = img.shape[:2]
    def area(f):
        b = np.asarray(f.bbox).flatten()
        return max(0.0, float(b[2] - b[0])) * max(0.0, float(b[3] - b[1]))
    return sorted(faces, key=area, reverse=True), w, h


def _faces_payload(faces, img_w, img_h):
    """Serialize detected faces with NORMALIZED bboxes (0..1) for UI overlay."""
    import numpy as np
    out = []
    for i, f in enumerate(faces):
        b = np.asarray(f.bbox).flatten()
        x1, y1, x2, y2 = float(b[0]), float(b[1]), float(b[2]), float(b[3])
        out.append({
            "index": i,
            # normalized coordinates (relative to image dimensions)
            "bbox": [
                round(max(0.0, x1 / img_w), 4),
                round(max(0.0, y1 / img_h), 4),
                round(min(1.0, x2 / img_w), 4),
                round(min(1.0, y2 / img_h), 4),
            ],
            # pixel bbox too (handy for server-side cropping later)
            "bboxPx": [round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1)],
            "area": round((x2 - x1) * (y2 - y1), 1),
            "score": round(float(getattr(f, "det_score", 0.0)), 3),
        })
    return out


# ============================================================================
# QUALITY PASS — post-swap regional enhancement.
#   1) LAB mean/std color transfer toward the ORIGINAL region (scene light)
#   2) gentle unsharp mask to counteract inswapper's 128px softness
#   3) feathered-ellipse blend so ONLY the face area is touched
# This is what makes the result look natural/unedited instead of pasted.
# ============================================================================

def _feather_mask(w, h, feather=21, shrink=0.90):
    """Elliptical feathered mask (uint8 0..255) for blending a region back."""
    import numpy as np
    import cv2
    mask = np.zeros((int(h), int(w)), np.uint8)
    cv2.ellipse(
        mask,
        (int(w) // 2, int(h) // 2),
        (max(2, int(w * shrink / 2)), max(2, int(h * shrink / 2))),
        0, 0, 360, 255, -1,
    )
    k = max(3, int(feather) | 1)
    return cv2.GaussianBlur(mask, (k, k), 0)


def _match_color_laba(region_ref, region_tgt, strength=0.55):
    """Per-channel LAB mean/std transfer: shift region_tgt toward region_ref.

    region_ref = the SAME area BEFORE the swap (carries the scene's lighting
    on skin); region_tgt = after the swap. std ratio is capped to avoid
    halos. strength<1 keeps some of the new face's own color character.
    """
    import numpy as np
    import cv2
    a = cv2.cvtColor(region_ref, cv2.COLOR_BGR2LAB).astype(np.float32)
    b = cv2.cvtColor(region_tgt, cv2.COLOR_BGR2LAB).astype(np.float32)
    out = b.copy()
    for c in range(3):
        ma, sa = float(a[..., c].mean()), float(a[..., c].std()) + 1e-6
        mb, sb = float(b[..., c].mean()), float(b[..., c].std()) + 1e-6
        ratio = min(sb / sa, 1.6)  # cap: never blow contrast past 1.6x
        out[..., c] = (b[..., c] - mb) * ratio + ma
    blended = b * (1.0 - strength) + out * strength
    return cv2.cvtColor(np.clip(blended, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)


def _unsharp(region, amount=0.40, radius=2.5):
    """Gentle unsharp mask — restores crispness lost by the 128px model."""
    import cv2
    blur = cv2.GaussianBlur(region, (0, 0), radius)
    return cv2.addWeighted(region, 1.0 + amount, blur, -amount, 0)


def _enhance_face(result, before, bbox_px, feather=21):
    """Enhance ONE swapped face region in-place (returns the image).

    result : image AFTER the swap
    before : the SAME image BEFORE this swap (reference for scene color)
    bbox_px: (x1, y1, x2, y2) pixel bbox of the swapped face
    """
    import numpy as np
    h, w = before.shape[:2]
    x1, y1, x2, y2 = [int(v) for v in bbox_px]
    pw, ph = max(4, x2 - x1), max(4, y2 - y1)
    ex1 = int(max(0, x1 - pw * 0.10))
    ey1 = int(max(0, y1 - ph * 0.10))
    ex2 = int(min(w, x2 + pw * 0.10))
    ey2 = int(min(h, y2 + ph * 0.10))
    if ex2 - ex1 < 12 or ey2 - ey1 < 12:
        return result
    tgt = result[ey1:ey2, ex1:ex2]
    ref = before[ey1:ey2, ex1:ex2]
    if tgt.size == 0 or ref.size == 0:
        return result
    adj = _match_color_laba(ref, tgt, strength=0.55)
    adj = _unsharp(adj)
    m = _feather_mask(adj.shape[1], adj.shape[0], feather=feather)
    a = (m.astype(np.float32) / 255.0)[..., None]
    blended = tgt.astype(np.float32) * (1 - a) + adj.astype(np.float32) * a
    result[ey1:ey2, ex1:ex2] = np.clip(blended, 0, 255).astype(np.uint8)
    return result


def _clean_index(v, name, count):
    """Validate a face index coming from the API layer."""
    try:
        iv = int(v)
    except (TypeError, ValueError):
        raise ValueError(f"Invalid {name}: {v!r}")
    if iv < 0 or iv >= count:
        raise ValueError(f"{name}={iv} out of range (0..{count - 1})")
    return iv


@app.get("/health")
def health():
    return {
        "ok": True,
        "model_loaded": os.path.exists(MODEL_PATH),
        "models_loaded": SWAPPER is not None and FACE_APP is not None,
        "hq_loaded": FACE_APP_HQ is not None,
        "model_path": MODEL_PATH,
        "service": "face-swap-pro",
        "port": 3030,
    }


@app.get("/warm")
def warm():
    """Preload ALL models in a background thread and return immediately.

    Called by ensure-services on page load so the 10-30s model load happens
    while the user is still browsing — by the time they upload, detection
    responds in ~1s instead of ~40s.
    """
    already = SWAPPER is not None and FACE_APP is not None and FACE_APP_HQ is not None

    def _load():
        try:
            _ensure_loaded()
            _ensure_hq()
        except Exception:
            traceback.print_exc()

    threading.Thread(target=_load, daemon=True).start()
    return {"ok": True, "alreadyWarm": already, "warming": True}


@app.post("/detect")
async def detect(req: Request):
    """Detect all faces in an image (for numbered-box UI overlay).

    Body:
        { "image": "<data URL | path>" }

    Returns:
        { "ok": true, "width": int, "height": int,
          "faces": [ { index, bbox[4] normalized, bboxPx, area, score } ] }

    Faces are ordered by bbox area, largest first (index 0 = الأكبر).
    """
    try:
        body = await req.json()
        img_url = body.get("image") or body.get("source") or body.get("face")
        if not img_url:
            return JSONResponse({"ok": False, "error": "'image' is required"}, status_code=400)

        _ensure_loaded()
        _ensure_hq()
        img = _load_image(img_url)
        if img is None:
            return JSONResponse({"ok": False, "error": "Could not load image"}, status_code=400)

        faces, w, h = _detect_sorted(img, hq=True)
        return {"ok": True, "width": int(w), "height": int(h), "faces": _faces_payload(faces, w, h)}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            {"ok": False, "error": str(e), "trace": traceback.format_exc(limit=3)},
            status_code=500,
        )


@app.post("/swap")
async def swap(req: Request):
    """Swap face(s) from `face` image onto face(s) in `source` image.

    Body:
        { "source": "<data URL | path>", "face": "<data URL | path>",
          "sourceIndex": 0,          # optional — which face in source (default largest)
          "faceIndex": 0,            # optional — which face in reference (default largest)
          "mappings": [              # optional — multi-merge, applied in order
              { "sourceIndex": 0, "faceIndex": 0 },
              { "sourceIndex": 2, "faceIndex": 0 },
          ] }

    Indices follow /detect ordering (largest face = 0).
    Returns:
        { "ok": true, "result": "<data URL PNG>", "swapped": [ {sourceIndex, faceIndex} ] }
    """
    try:
        body = await req.json()
        source_url = body.get("source") or body.get("sourceUrl") or body.get("sourcePath")
        face_url = body.get("face") or body.get("faceUrl") or body.get("facePath")
        if not source_url or not face_url:
            return JSONResponse(
                {"ok": False, "error": "Both 'source' and 'face' are required"},
                status_code=400,
            )

        _ensure_loaded()
        import numpy as np

        src = _load_image(source_url)
        face = _load_image(face_url)
        if src is None:
            return JSONResponse({"ok": False, "error": "Could not load source image"}, status_code=400)
        if face is None:
            return JSONResponse({"ok": False, "error": "Could not load face image"}, status_code=400)

        src_faces, _, _ = _detect_sorted(src, hq=True)
        face_faces, _, _ = _detect_sorted(face, hq=True)
        if not src_faces:
            return JSONResponse(
                {"ok": False, "error": "No face detected in source image"},
                status_code=422,
            )
        if not face_faces:
            return JSONResponse(
                {"ok": False, "error": "No face detected in reference face image"},
                status_code=422,
            )

        # Resolve the swap plan (list of {sourceIndex, faceIndex}).
        mappings_in = body.get("mappings")
        plan = []
        if isinstance(mappings_in, list) and mappings_in:
            for m in mappings_in:
                if not isinstance(m, dict):
                    continue
                plan.append({
                    "sourceIndex": _clean_index(m.get("sourceIndex"), "sourceIndex", len(src_faces)),
                    "faceIndex": _clean_index(m.get("faceIndex"), "faceIndex", len(face_faces)),
                })
            if not plan:
                return JSONResponse(
                    {"ok": False, "error": "mappings must be a non-empty list of {sourceIndex, faceIndex}"},
                    status_code=400,
                )
        else:
            # Legacy single-swap path: explicit indices or largest-by-area.
            si = body.get("sourceIndex")
            fi = body.get("faceIndex")
            plan.append({
                "sourceIndex": _clean_index(si, "sourceIndex", len(src_faces)) if si is not None else 0,
                "faceIndex": _clean_index(fi, "faceIndex", len(face_faces)) if fi is not None else 0,
            })

        result = src
        for m in plan:
            before = result
            result = SWAPPER.get(
                result,
                src_faces[m["sourceIndex"]],
                face_faces[m["faceIndex"]],
                paste_back=True,
            )
            # QUALITY PASS: color-match + sharpen the swapped face only
            try:
                b = np.asarray(src_faces[m["sourceIndex"]].bbox).flatten()
                result = _enhance_face(
                    result, before,
                    (b[0], b[1], b[2], b[3]),
                )
            except Exception:
                traceback.print_exc()

        return {
            "ok": True,
            "result": _encode_png(result),
            "swapped": plan,
            "sourceFacesCount": len(src_faces),
            "faceFacesCount": len(face_faces),
            "quality": "color-match+unsharp",
        }

    except ValueError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            {"ok": False, "error": str(e), "trace": traceback.format_exc(limit=3)},
            status_code=500,
        )


# ============================================================================
# Person (torso) detection — for the CLOTHING-swap numbered boxes.
# The box anchors on the face and extends downward to cover the torso
# (clothing area). Ordering matches /detect (largest face first), so the
# numbering is consistent across all endpoints.
# ============================================================================

def _torso_boxes(faces, img_w, img_h):
    """Face-anchored torso boxes, normalized 0..1. Same ordering as faces."""
    import numpy as np
    out = []
    for f in faces:
        b = np.asarray(f.bbox).flatten()
        x1, y1, x2, y2 = float(b[0]), float(b[1]), float(b[2]), float(b[3])
        fw, fh = max(1.0, x2 - x1), max(1.0, y2 - y1)
        # Torso: slightly wider than the face, from mid-face down to ~3.6x face height
        tx1 = x1 - 0.35 * fw
        ty1 = y1 + 0.55 * fh
        tx2 = x2 + 0.35 * fw
        ty2 = y1 + 4.1 * fh
        out.append([
            round(max(0.0, tx1 / img_w), 4),
            round(max(0.0, ty1 / img_h), 4),
            round(min(1.0, tx2 / img_w), 4),
            round(min(1.0, ty2 / img_h), 4),
        ])
    return out


@app.post("/detect-persons")
async def detect_persons(req: Request):
    """Detect PERSONS (face-anchored torso boxes) for clothing-swap UI.

    Body: { "image": "<data URL | path>" }
    Returns: { ok, width, height, persons: [ { index, bbox[4] normalized, faceBbox, score } ] }
    """
    try:
        body = await req.json()
        img_url = body.get("image") or body.get("source") or body.get("face")
        if not img_url:
            return JSONResponse({"ok": False, "error": "'image' is required"}, status_code=400)

        _ensure_loaded()
        _ensure_hq()
        import numpy as np
        img = _load_image(img_url)
        if img is None:
            return JSONResponse({"ok": False, "error": "Could not load image"}, status_code=400)

        faces, w, h = _detect_sorted(img, hq=True)
        torsos = _torso_boxes(faces, w, h)
        persons = []
        for i, f in enumerate(faces):
            fb = np.asarray(f.bbox).flatten()
            persons.append({
                "index": i,
                "bbox": torsos[i],
                "faceBbox": [
                    round(max(0.0, float(fb[0]) / w), 4),
                    round(max(0.0, float(fb[1]) / h), 4),
                    round(min(1.0, float(fb[2]) / w), 4),
                    round(min(1.0, float(fb[3]) / h), 4),
                ],
                "score": round(float(getattr(f, "det_score", 0.0)), 3),
            })
        return {"ok": True, "width": int(w), "height": int(h), "persons": persons}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse(
            {"ok": False, "error": str(e), "trace": traceback.format_exc(limit=3)},
            status_code=500,
        )


# ============================================================================
# VIDEO JOBS — background processing with progress polling.
#   mode="face"    → per-frame face swap with centroid tracking
#   mode="garment" → per-frame clothing recolor toward the reference
#                    garment's dominant color (keeps folds/shadows)
# ============================================================================

VIDEO_JOBS = {}
VIDEO_JOBS_LOCK = threading.Lock()
RESULTS_DIR = "/home/z/my-project/data/results"


def _job_update(job_id, **kw):
    with VIDEO_JOBS_LOCK:
        job = VIDEO_JOBS.get(job_id)
        if job:
            job.update(kw)


def _job_get(job_id):
    with VIDEO_JOBS_LOCK:
        return dict(VIDEO_JOBS.get(job_id) or {})


def _cleanup_old_jobs():
    with VIDEO_JOBS_LOCK:
        now = time.time()
        for jid in [j for j, v in VIDEO_JOBS.items() if now - v.get("ts", now) > 3600]:
            del VIDEO_JOBS[jid]


def _iou(a, b):
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    return inter / max(1e-6, area_a + area_b - inter)


def _match_detection(det_boxes, last_box):
    """Find the detection matching a tracked box (IoU first, then nearest centroid)."""
    if not det_boxes:
        return None
    best_i, best_score = None, 0.25
    for i, b in enumerate(det_boxes):
        s = _iou(last_box, b)
        if s > best_score:
            best_i, best_score = i, s
    if best_i is not None:
        return best_i
    # fallback: nearest centroid within a radius
    lcx, lcy = (last_box[0] + last_box[2]) / 2, (last_box[1] + last_box[3]) / 2
    diag = math.hypot(last_box[2] - last_box[0], last_box[3] - last_box[1])
    best_i, best_d = None, diag * 0.9
    for i, b in enumerate(det_boxes):
        cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        d = math.hypot(cx - lcx, cy - lcy)
        if d < best_d:
            best_i, best_d = i, d
    return best_i


def _dominant_garment_color(img, torso_box):
    """Dominant HSV color of the garment region of a reference person."""
    import numpy as np
    import cv2
    h, w = img.shape[:2]
    x1 = int(max(0, torso_box[0] * w)); y1 = int(max(0, torso_box[1] * h))
    x2 = int(min(w, torso_box[2] * w)); y2 = int(min(h, torso_box[3] * h))
    if x2 - x1 < 4 or y2 - y1 < 4:
        return None
    import numpy as np
    roi = img[y1:y2, x1:x2]
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    H, S, V = hsv[..., 0].astype(int), hsv[..., 1].astype(int), hsv[..., 2].astype(int)
    # exclude skin-ish and near-black/white pixels
    skin = (((H <= 20) | (H >= 155)) & (S >= 40) & (V >= 70)) | (V < 35) | ((S < 20) & (V > 235))
    cloth = ~skin
    if int(cloth.sum()) < 80:
        return None
    hh = H[cloth].astype(float); ss = S[cloth].astype(float); vv = V[cloth].astype(float)
    # circular mean for hue (OpenCV H: 0..179)
    ang = hh * (2 * math.pi / 180.0)
    mean_ang = math.atan2(float(np.sin(ang).mean()), float(np.cos(ang).mean()))
    hue = (mean_ang * (180.0 / math.pi)) % 180
    return (hue, float(np.median(ss)), float(np.median(vv)))


def _recolor_torso(frame, face_box, target_hsv):
    """Recolor the clothing area below the face box toward target_hsv (keeps shading)."""
    import numpy as np
    import cv2
    fh = face_img_h = max(1.0, face_box[3] - face_box[1])
    H, W = frame.shape[:2]
    x1 = int(max(0, (face_box[0] - 0.30 * fh) * W))
    x2 = int(min(W, (face_box[2] + 0.30 * fh) * W))
    y1 = int(max(0, (face_box[1] + 0.75 * fh) * H))
    y2 = int(min(H, (face_box[1] + 3.9 * fh) * H))
    if x2 - x1 < 4 or y2 - y1 < 4:
        return frame
    roi = frame[y1:y2, x1:x2]
    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV).astype(int)
    Hh, Ss, Vv = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    skin = (((Hh <= 20) | (Hh >= 155)) & (Ss >= 40) & (Vv >= 70)) | (Vv < 30) | ((Ss < 18) & (Vv > 240))
    mask = (~skin).astype(np.uint8) * 255
    if int((mask > 0).sum()) < 50:
        return frame
    mask = cv2.GaussianBlur(mask, (21, 21), 0)
    t_h, t_s, t_v = target_hsv
    a = mask.astype(float) / 255.0
    new_h = np.full_like(Hh, int(round(t_h)), dtype=float)
    new_s = Ss * 0.30 + t_s * 0.70
    new_v = Vv * (0.55 + 0.45 * (t_v / 255.0))
    blended = np.empty_like(hsv, dtype=float)
    blended[..., 0] = Hh * (1 - a) + new_h * a
    blended[..., 1] = Ss * (1 - a) + new_s * a
    blended[..., 2] = Vv * (1 - a) + new_v * a
    out = cv2.cvtColor(np.clip(blended, 0, 179).astype(np.uint8), cv2.COLOR_HSV2BGR)
    frame[y1:y2, x1:x2] = out
    return frame


def _run_video_job(job_id, mode, video_path, ref_data_url, mappings, max_frames):
    """Background worker for /video-job. Updates VIDEO_JOBS[job_id]."""
    try:
        _ensure_loaded()
        import numpy as np
        import cv2
        _job_update(job_id, status="processing", phase="prepare", progress=1, ts=time.time())

        ref = _load_image(ref_data_url)
        if ref is None:
            raise RuntimeError("Could not load reference image")
        ref_faces, _, _ = _detect_sorted(ref)
        if not ref_faces:
            raise RuntimeError("No face detected in reference image")

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise RuntimeError("Could not open video")
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        vw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        vh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        limit = min(total, max_frames) if total > 0 else max_frames

        # Reference payload per mode
        if mode == "face":
            ref_by_index = {}
            for mp in mappings:
                ri = int(mp.get("refIndex", 0))
                if 0 <= ri < len(ref_faces):
                    ref_by_index[int(mp.get("videoIndex", 0))] = ref_faces[ri]
            if not ref_by_index:
                ref_by_index[0] = ref_faces[0]
        else:
            torsos = _torso_boxes(ref_faces, ref.shape[1], ref.shape[0])
            colors = {}
            for mp in mappings:
                vi, ri = int(mp.get("videoIndex", 0)), int(mp.get("refIndex", 0))
                if 0 <= ri < len(torsos):
                    c = _dominant_garment_color(ref, torsos[ri])
                    if c:
                        colors[vi] = c
            if not colors:
                colors[0] = (110.0, 160.0, 150.0)

        os.makedirs(RESULTS_DIR, exist_ok=True)
        stamp = f"{int(time.time())}-{uuid.uuid4().hex[:6]}"
        tmp_path = os.path.join(RESULTS_DIR, f"tmp-video-{stamp}.mp4")
        out_name = f"video-{mode}-swap-{stamp}.mp4"
        out_path = os.path.join(RESULTS_DIR, out_name)

        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(tmp_path, fourcc, fps, (vw, vh))

        tracks = {int(mp.get("videoIndex", 0)): None for mp in mappings} or {0: None}
        processed, swapped_frames = 0, 0
        while True:
            ok, frame = cap.read()
            if not ok or processed >= limit:
                break
            processed += 1
            faces, _, _ = _detect_sorted(frame)
            boxes = []
            for f in faces:
                b = np.asarray(f.bbox).flatten()
                boxes.append([float(b[0]) / vw, float(b[1]) / vh,
                              float(b[2]) / vw, float(b[3]) / vh])
            if mode == "face":
                out_frame = frame
                for vi, ref_face in ref_by_index.items():
                    last = tracks.get(vi)
                    if last is None:
                        # initialize on the first frame that has detections
                        idx = 0 if vi < len(boxes) else None
                        if vi == 0 and boxes:
                            idx = 0
                        if idx is None:
                            continue
                    else:
                        idx = _match_detection(boxes, last)
                        if idx is None:
                            continue
                    tracks[vi] = boxes[idx]
                    if idx < len(faces):
                        prev = out_frame
                        out_frame = SWAPPER.get(out_frame, faces[idx], ref_face, paste_back=True)
                        # QUALITY PASS per frame: color-match + sharpen (face area only)
                        try:
                            fb = np.asarray(faces[idx].bbox).flatten()
                            out_frame = _enhance_face(
                                out_frame, prev,
                                (fb[0], fb[1], fb[2], fb[3]),
                                feather=15,
                            )
                        except Exception:
                            pass
                        swapped_frames += 1
                frame = out_frame
            else:
                for vi, tcolor in colors.items():
                    last = tracks.get(vi)
                    if last is None:
                        idx = 0 if (vi == 0 and boxes) else (vi if vi < len(boxes) else None)
                        if idx is None:
                            continue
                    else:
                        idx = _match_detection(boxes, last)
                        if idx is None:
                            continue
                    tracks[vi] = boxes[idx]
                    if idx < len(faces):
                        fb_px = boxes[idx]
                        frame = _recolor_torso(frame, fb_px, tcolor)
                        swapped_frames += 1
            writer.write(frame)
            if processed % 5 == 0 or processed == limit:
                prog = 5 + int((processed / max(1, limit)) * 80)
                _job_update(job_id, phase="processing", progress=min(85, prog),
                            processedFrames=processed, totalFrames=limit, ts=time.time())
        cap.release()
        writer.release()

        if processed == 0:
            raise RuntimeError("No frames could be read from the video")

        _job_update(job_id, phase="encoding", progress=88, ts=time.time())
        # Re-encode H.264 (HIGH QUALITY: crf 18 + preset medium) + copy
        # original audio when present.
        cmd = ["ffmpeg", "-y", "-i", tmp_path, "-i", video_path,
               "-map", "0:v:0", "-map", "1:a:0?",
               "-c:v", "libx264", "-preset", "fast", "-crf", "18",
               "-profile:v", "high", "-pix_fmt", "yuv420p",
               "-movflags", "+faststart",
               "-c:a", "aac", "-b:a", "192k", "-shortest", out_path]
        enc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        if enc.returncode != 0 or not os.path.exists(out_path):
            raise RuntimeError("ffmpeg encoding failed: " + (enc.stderr or "")[-300:])

        _job_update(job_id, status="done", progress=100, phase="done", ts=time.time(),
                    result={"url": f"/results/{out_name}", "path": out_path,
                            "processedFrames": processed, "totalFrames": total,
                            "fps": round(fps, 2), "width": vw, "height": vh,
                            "mode": mode})
    except Exception as ex:
        traceback.print_exc()
        _job_update(job_id, status="error", phase="error", error=str(ex)[:500], ts=time.time())


@app.post("/video-job")
async def video_job(req: Request):
    """Start a background video job.

    Body: { mode: "face"|"garment", video: "<absolute path>",
            ref: "<data URL>", mappings: [{ videoIndex, refIndex }],
            maxFrames?: int (default 400) }
    Returns: { ok, jobId }
    """
    try:
        body = await req.json()
        mode = body.get("mode", "face")
        video_path = body.get("video") or body.get("videoPath")
        ref = body.get("ref") or body.get("reference")
        mappings = body.get("mappings") or []
        if mode not in ("face", "garment"):
            return JSONResponse({"ok": False, "error": "mode must be face|garment"}, status_code=400)
        if not video_path or not os.path.exists(video_path):
            return JSONResponse({"ok": False, "error": "video file not found"}, status_code=404)
        if not ref:
            return JSONResponse({"ok": False, "error": "reference image required"}, status_code=400)

        _cleanup_old_jobs()
        # NOTE: no synchronous _ensure_loaded() here — model load takes 20-40s
        # on 2 vCPU and would blow the 30s client timeout in the Next.js route.
        # The background worker calls _ensure_loaded() itself; the job simply
        # reports status="queued" while models warm up.
        job_id = f"vj-{uuid.uuid4().hex[:12]}"
        with VIDEO_JOBS_LOCK:
            VIDEO_JOBS[job_id] = {"id": job_id, "status": "queued", "phase": "queued",
                                  "progress": 0, "ts": time.time()}
        max_frames = int(body.get("maxFrames") or 400)
        threading.Thread(target=_run_video_job,
                         args=(job_id, mode, video_path, ref, mappings, max_frames),
                         daemon=True).start()
        return {"ok": True, "jobId": job_id}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.get("/video-job/{job_id}")
async def video_job_status(job_id: str):
    job = _job_get(job_id)
    if not job:
        return JSONResponse({"ok": False, "error": "job not found"}, status_code=404)
    return {"ok": True, **job}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=3030, log_level="info")
