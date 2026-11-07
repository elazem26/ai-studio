"""
object-remover — FastAPI service for MASK-BASED object removal (inpainting).

Listens on port 3031.

Pipeline (the whole point — surrounding pixels must stay IDENTICAL):
  1. Frontend sends the photo + a brush mask (white = object to remove).
  2. We find the mask bounding-box, crop a context window around it.
  3. LaMa (big-lama, ONNX fp32, 512x512) reconstructs ONLY inside the mask.
  4. The result is pasted back through a feathered mask — every pixel
     outside the mask stays the original photo's pixels, bit-for-bit.

Use cases: text / logo / emoji / sticker removal, tattoos, earrings,
watches, bracelets — anything brushable. LaMa regenerates plausible skin /
texture behind the object (e.g. earlobe behind an earring) while the rest
of the body is untouched by construction.

Fallback: OpenCV Telea inpainting (no model needed) if LaMa is missing or
fails — same paste-back guarantees.

Endpoints:
  GET  /health   → {ok, model, device}
  GET  /warm     → preloads the LaMa session (fire-and-forget from ensure-services)
  POST /inpaint  → {image_b64, mask_b64, grow_px?, feather_px?} → {image_b64, ...}
"""
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import base64, io, os, time, traceback, threading

import numpy as np
import cv2

MODEL_CANDIDATES = [
    "/home/z/my-project/data/models/lama_fp32.onnx",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "models", "lama_fp32.onnx"),
    "data/models/lama_fp32.onnx",
]

# onnxruntime tuning — same rationale as face-swap-pro (2 vCPU box, ORT
# spin-waiting starves next-server). Must run BEFORE session creation.
def _tune_onnxruntime():
    try:
        import onnxruntime as ort
        so = ort.SessionOptions()
        so.intra_op_num_threads = 2
        so.inter_op_num_threads = 1
        so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        return so
    except Exception:
        return None

_ORT_SO = _tune_onnxruntime()

app = FastAPI()
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

_state = {
    "session": None,       # ort.InferenceSession | None
    "status": "lazy",      # lazy | loading | ready | missing | error
    "error": None,
    "lock": threading.Lock(),
}

MODEL_INPUT = 512


def _find_model_path():
    for p in MODEL_CANDIDATES:
        try:
            if os.path.isfile(p) and os.path.getsize(p) > 1_000_000:
                return os.path.abspath(p)
        except Exception:
            continue
    return None


def _load_session():
    """Lazy-load the LaMa ONNX session. Thread-safe."""
    if _state["session"] is not None:
        return _state["session"]
    with _state["lock"]:
        if _state["session"] is not None:
            return _state["session"]
        if _state["status"] == "loading":
            return None
        path = _find_model_path()
        if not path:
            _state["status"] = "missing"
            return None
        _state["status"] = "loading"
        try:
            import onnxruntime as ort
            opts = _ORT_SO or ort.SessionOptions()
            sess = ort.InferenceSession(path, sess_options=opts, providers=["CPUExecutionProvider"])
            _state["session"] = sess
            _state["status"] = "ready"
            _state["error"] = None
            return sess
        except Exception as e:
            _state["status"] = "error"
            _state["error"] = str(e)
            traceback.print_exc()
            return None


# ---------------------------------------------------------------------------
# Mask utilities
# ---------------------------------------------------------------------------

def _grow_mask(mask: np.ndarray, px: int) -> np.ndarray:
    """Dilate the mask so brush edges fully cover the object's anti-aliased rim."""
    if px <= 0:
        return mask
    k = max(1, int(px))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * k + 1, 2 * k + 1))
    return cv2.dilate(mask, kernel, iterations=1)


def _mask_bbox(mask: np.ndarray, margin_ratio: float = 0.55, min_ctx: int = 96):
    """Bounding box of mask pixels, expanded with context margin, clamped to frame."""
    ys, xs = np.where(mask > 0)
    if len(xs) == 0:
        return None
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    h, w = mask.shape[:2]
    # context margin: bigger of (55% of mask span, min_ctx) — LaMa needs surroundings
    mx = max(int((x1 - x0) * margin_ratio), min_ctx)
    my = max(int((y1 - y0) * margin_ratio), min_ctx)
    # make the window as square as possible (better for the 512 model)
    span = max(x1 - x0 + 2 * mx, y1 - y0 + 2 * my)
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    left = max(0, cx - span // 2)
    top = max(0, cy - span // 2)
    right = min(w, left + span)
    bottom = min(h, top + span)
    # shift window back into frame if it hit an edge
    if right - left < span:
        left = max(0, right - span)
    if bottom - top < span:
        top = max(0, bottom - span)
    return left, top, right, bottom


def _lama_inpaint_crop(sess, img_crop_bgr: np.ndarray, mask_crop: np.ndarray) -> np.ndarray:
    """Run LaMa on one crop. Model input is FIXED 512x512 (Carve fp32 export).

    Preprocessing per the official Carve demo: RGB, CHW, float32 / 255 (0..1),
    mask binary 0/1. The crop window is square by construction, so a direct
    512x512 resize is aspect-true.
    OUTPUT SCALE (verified against the official demo): the ONNX model emits
    0..255 floats — clip + uint8 directly, do NOT rescale.
    """
    h, w = img_crop_bgr.shape[:2]
    rgb = cv2.cvtColor(img_crop_bgr, cv2.COLOR_BGR2RGB)

    img_r = cv2.resize(rgb, (MODEL_INPUT, MODEL_INPUT), interpolation=cv2.INTER_AREA if max(h, w) > MODEL_INPUT else cv2.INTER_CUBIC)
    mask_r = cv2.resize(mask_crop, (MODEL_INPUT, MODEL_INPUT), interpolation=cv2.INTER_NEAREST)

    x = (img_r.astype(np.float32) / 255.0).transpose(2, 0, 1)[None].astype(np.float32)
    m = ((mask_r > 127).astype(np.float32))[None, None].astype(np.float32)
    out = sess.run(["output"], {"image": x, "mask": m})[0]

    out = np.clip(out[0].transpose(1, 2, 0), 0, 255).astype(np.uint8)
    out = cv2.resize(out, (w, h), interpolation=cv2.INTER_CUBIC)
    return cv2.cvtColor(out, cv2.COLOR_RGB2BGR)


def _feather_paste(base: np.ndarray, patch: np.ndarray, mask: np.ndarray, feather_px: float) -> np.ndarray:
    """Alpha-blend `patch` into `base` ONLY inside `mask`, with soft edges.

    Outside the mask base pixels are returned untouched (copy semantics).
    """
    alpha = (mask > 0).astype(np.float32)
    if feather_px > 0.5:
        k = int(max(3, feather_px * 2))
        if k % 2 == 0:
            k += 1
        alpha = cv2.GaussianBlur(alpha, (k, k), 0)
    alpha = alpha[..., None]
    out = base.astype(np.float32) * (1.0 - alpha) + patch.astype(np.float32) * alpha
    return np.clip(out, 0, 255).astype(np.uint8)


def _telea_inpaint(img_bgr: np.ndarray, mask: np.ndarray) -> np.ndarray:
    return cv2.inpaint(img_bgr, (mask > 0).astype(np.uint8) * 255, 7, cv2.INPAINT_TELEA)


# ---------------------------------------------------------------------------
# Core entry
# ---------------------------------------------------------------------------

def inpaint(image_bgr: np.ndarray, mask_bin: np.ndarray, grow_px: int, feather_px: float):
    """Returns (result_bgr, method_str). Only masked pixels may change."""
    h, w = image_bgr.shape[:2]
    mask_bin = (mask_bin > 127).astype(np.uint8) * 255
    if mask_bin.shape[:2] != (h, w):
        mask_bin = cv2.resize(mask_bin, (w, h), interpolation=cv2.INTER_NEAREST)
    if cv2.countNonZero(mask_bin) == 0:
        return image_bgr.copy(), "noop-empty-mask"

    mask_grown = _grow_mask(mask_bin, grow_px)
    bbox = _mask_bbox(mask_grown)
    if bbox is None:
        return image_bgr.copy(), "noop-empty-mask"
    left, top, right, bottom = bbox
    crop = image_bgr[top:bottom, left:right].copy()
    mcrop = mask_grown[top:bottom, left:right].copy()

    # patched = original with the inpainted crop pasted back in place;
    # blending it through the FULL-SIZE feathered mask keeps every pixel
    # outside the mask bit-identical to the original photo.
    def _paste_back(filled_crop: np.ndarray):
        patched = image_bgr.copy()
        patched[top:bottom, left:right] = filled_crop
        return _feather_paste(image_bgr, patched, mask_grown, feather_px)

    sess = _state["session"] or _load_session()
    if sess is not None:
        try:
            filled = _lama_inpaint_crop(sess, crop, mcrop)
            return _paste_back(filled), "lama"
        except Exception:
            traceback.print_exc()
            _state["status"] = "error"
            _state["session"] = None

    # Fallback: OpenCV on the crop, same paste-back guarantees
    filled = _telea_inpaint(crop, (mcrop > 0).astype(np.uint8) * 255)
    return _paste_back(filled), "opencv-telea"


# ---------------------------------------------------------------------------
# HTTP layer
# ---------------------------------------------------------------------------

def _decode_b64(data: str) -> np.ndarray:
    if "," in data and data.strip().startswith("data:"):
        data = data.split(",", 1)[1]
    arr = np.frombuffer(base64.b64decode(data), dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("cannot decode image")
    return img


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "object-remover",
        "port": 3031,
        "model": _state["status"],
        "modelFound": _find_model_path() is not None,
        "error": _state["error"],
    }


@app.get("/warm")
def warm():
    def _w():
        s = _load_session()
        # dummy forward pass to JIT-allocate ORT arenas (first real request then ~1-2s)
        if s is not None:
            try:
                dummy = np.zeros((1, 3, MODEL_INPUT, MODEL_INPUT), dtype=np.float32)
                m = np.zeros((1, 1, MODEL_INPUT, MODEL_INPUT), dtype=np.float32)
                s.run(["output"], {"image": dummy, "mask": m})
            except Exception:
                pass
    threading.Thread(target=_w, daemon=True).start()
    return {"ok": True, "warming": True}


@app.post("/unload")
def unload():
    """تحرير ذاكرة نموذج LaMa (~1.2GB) — يُستخدم من وكيل الدمج قبل عمليات
    تبديل الوجوه الثقيلة لتفادي OOM على صندوق 4GB. النموذج يعود للتحميل
    الكسول تلقائيًا عند أول طلب /inpaint (أو عبر /warm)، فلا توجد مخاطرة."""
    try:
        _state["session"] = None
        _state["status"] = "lazy"
        import gc as _gc
        _gc.collect()
        return {"ok": True, "status": "lazy", "unloaded": True}
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.post("/inpaint")
async def inpaint_endpoint(req: Request):
    t0 = time.time()
    try:
        body = await req.json()
    except Exception:
        return JSONResponse({"ok": False, "error": "invalid json"}, status_code=400)
    try:
        img_b64 = body.get("image_b64")
        mask_b64 = body.get("mask_b64")
        if not img_b64 or not mask_b64:
            return JSONResponse({"ok": False, "error": "image_b64 and mask_b64 are required"}, status_code=400)
        grow_px = int(body.get("growPx", 6))
        feather_px = float(body.get("featherPx", 4.0))

        image = _decode_b64(img_b64)
        mask = _decode_b64(mask_b64)
        if mask.shape[:2] != image.shape[:2]:
            mask = cv2.resize(mask, (image.shape[1], image.shape[0]), interpolation=cv2.INTER_NEAREST)
        mask_gray = cv2.cvtColor(mask, cv2.COLOR_BGR2GRAY)

        result, method = inpaint(image, mask_gray, grow_px, feather_px)
        ok, buf = cv2.imencode(".png", result)
        if not ok:
            raise RuntimeError("encode failed")
        return {
            "ok": True,
            "image_b64": base64.b64encode(buf.tobytes()).decode("ascii"),
            "width": result.shape[1],
            "height": result.shape[0],
            "method": method,
            "elapsedMs": int((time.time() - t0) * 1000),
        }
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3031, log_level="info")
