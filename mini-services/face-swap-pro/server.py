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
                    # ذاكرة 4GB: إيقاف arena ومخطط الذاكرة يقلل الذروة
                    # بمئات الميغابايتات (سبق أن كان يقتل العملية OOM
                    # أثناء تحميل inswapper مع rembg وbuffalo معاً)
                    try:
                        so.enable_cpu_mem_arena = False
                        so.enable_mem_pattern = False
                    except Exception:
                        pass
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


def _tune_malloc():
    """حدّ glibc arenas وأعد الذاكرة للنظام بعد الإفراج (حاويات 4GB)."""
    try:
        import ctypes
        libc = ctypes.CDLL("libc.so.6")
        libc.mallopt(-8, 2)        # M_ARENA_MAX = 2
        libc.mallopt(-1, 131072)   # M_TRIM_THRESHOLD = 128KB
        libc.mallopt(-2, 32768)    # M_TOP_PAD = 32KB
    except Exception:
        pass


_tune_malloc()


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def _find_model_path() -> str:
    """Locate inswapper_128.onnx across ALL deployment layouts.

    The service may run from the source tree, from a copied
    .next/standalone/mini-services bundle (models dir is NOT copied there),
    or on a host where the model was restored to ~/.insightface.
    Resolution order:
      1. FACE_SWAP_MODEL_PATH env var
      2. next to this file:  models/inswapper_128.onnx
      3. walking up from cwd: <root>/mini-services/face-swap-pro/models/inswapper_128.onnx
      4. ~/.insightface/models/inswapper_128.onnx
    Returns the first EXISTING path, else the best candidate for error text.
    """
    name = "inswapper_128.onnx"
    cands: list = []
    env = os.environ.get("FACE_SWAP_MODEL_PATH")
    if env:
        cands.append(env)
    cands.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", name))
    here = os.getcwd()
    for _ in range(5):
        cands.append(os.path.join(here, "mini-services", "face-swap-pro", "models", name))
        parent = os.path.dirname(here)
        if parent == here:
            break
        here = parent
    cands.append(os.path.expanduser(os.path.join("~", ".insightface", "models", name)))
    for c in cands:
        try:
            if c and os.path.isfile(c):
                return c
        except Exception:
            continue
    return cands[1] if len(cands) > 1 else name


MODEL_PATH = _find_model_path()
SWAPPER = None
FACE_APP = None
FACE_APP_HQ = None

# ---------------------------------------------------------------------------
# SELF-HEALING MODELS (2026-11-01) — fixes "تبديل الوجه لا يعمل" on every NEW
# session: the GitHub repo is intentionally CLEAN (no *.onnx — owner spec),
# so a fresh Codespace/session starts with NO models and every swap 500s
# until someone ran restore-models.sh by hand. Now the service downloads
# whatever is missing on startup (background thread) and /swap + /detect
# report download progress instead of hard-failing.
# Canonical location: ~/.insightface/models (outside .next — rebuilds never
# wipe it; same dir insightface natively uses for buffalo_l).
# Manual equivalent: bash scripts/download-models.sh
# ---------------------------------------------------------------------------
INSIGHTFACE_MODELS_DIR = os.path.expanduser(os.path.join("~", ".insightface", "models"))
BUFFALO_URL = "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip"
SWAP_MODEL_URL = "https://huggingface.co/ModelsLab/inswapper/resolve/main/inswapper_128.onnx"

_DL = {
    "buffalo": {"state": "idle", "progress": 0, "error": None},
    "inswapper": {"state": "idle", "progress": 0, "error": None},
}
_DL_LOCK = threading.Lock()
_SELF_HEAL_STARTED = [False]
# Visible diagnostics: the service may run with stdio:ignore (spawned by the
# Next server), so tracebacks would vanish. Log self-heal activity to a file.
_HEAL_LOG = os.path.join(INSIGHTFACE_MODELS_DIR, "self-heal.log")


def _hlog(msg: str):
    try:
        os.makedirs(INSIGHTFACE_MODELS_DIR, exist_ok=True)
        with open(_HEAL_LOG, "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")
    except Exception:
        pass


def _buffalo_ready() -> bool:
    return os.path.isfile(os.path.join(INSIGHTFACE_MODELS_DIR, "buffalo_l", "det_10g.onnx"))


def _swapper_ready() -> bool:
    """True when inswapper_128.onnx exists (re-resolves: may appear later)."""
    global MODEL_PATH
    if os.path.isfile(MODEL_PATH):
        return True
    p = _find_model_path()
    if p and os.path.isfile(p):
        MODEL_PATH = p
        return True
    return False


def _download(url: str, dest: str, key: str) -> bool:
    """Streaming download with resume (.tmp) + progress in _DL[key].

    Engine 1: urllib (Range resume, progress reporting).
    Engine 2 (fallback per attempt): curl subprocess — proven to work on
    hosts where python's network stack is restricted.
    """
    import urllib.request

    tmp = dest + ".tmp"

    def _curl_engine() -> bool:
        """curl -C - (resume) writing straight into tmp."""
        import subprocess

        rc = subprocess.run(
            ["curl", "-sL", "-C", "-", "--retry", "2", "--max-time", "600",
             "-o", tmp, url],
            timeout=660,
        ).returncode
        return rc == 0 and os.path.isfile(tmp) and os.path.getsize(tmp) > 1000

    try:
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with _DL_LOCK:
            _DL[key]["state"] = "downloading"
            _DL[key]["progress"] = 0
            _DL[key]["error"] = None
        _hlog(f"download start key={key} dest={dest}")
        last_err = "unknown"
        for attempt in range(10):
            req = urllib.request.Request(url)
            have = os.path.getsize(tmp) if os.path.isfile(tmp) else 0
            if have:
                req.add_header("Range", f"bytes={have}-")
            try:
                with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "ab" if have else "wb") as f:
                    total = None
                    if r.headers.get("Content-Range"):
                        try:
                            total = int(r.headers["Content-Range"].rsplit("/", 1)[1])
                        except Exception:
                            total = None
                    elif r.headers.get("Content-Length"):
                        total = have + int(r.headers["Content-Length"])
                    while True:
                        chunk = r.read(1024 * 512)
                        if not chunk:
                            break
                        f.write(chunk)
                        if total:
                            with _DL_LOCK:
                                _DL[key]["progress"] = min(99, int(f.tell() * 100 / total))
                os.replace(tmp, dest)
                with _DL_LOCK:
                    _DL[key]["state"] = "ready"
                    _DL[key]["progress"] = 100
                _hlog(f"download done key={key} ({os.path.getsize(dest)} bytes)")
                return True
            except Exception as e:
                last_err = f"{type(e).__name__}: {e}"
                _hlog(f"urllib attempt {attempt + 1} failed key={key}: {last_err}")
                traceback.print_exc()
                # Engine 2: curl with resume — different network path, often
                # succeeds where urllib is blocked.
                try:
                    if _curl_engine():
                        os.replace(tmp, dest)
                        with _DL_LOCK:
                            _DL[key]["state"] = "ready"
                            _DL[key]["progress"] = 100
                        _hlog(f"download done via curl key={key} ({os.path.getsize(dest)} bytes)")
                        return True
                    _hlog(f"curl attempt {attempt + 1} failed key={key}")
                except Exception as ce:
                    _hlog(f"curl attempt {attempt + 1} crashed key={key}: {ce}")
                time.sleep(2)
        with _DL_LOCK:
            _DL[key]["state"] = "error"
            _DL[key]["error"] = f"download failed after 10 attempts: {last_err}"
        _hlog(f"download GAVE UP key={key}: {last_err}")
        return False
    except Exception as e:
        with _DL_LOCK:
            _DL[key]["state"] = "error"
            _DL[key]["error"] = str(e)[:200]
        _hlog(f"download crashed key={key}: {e}")
        return False
    finally:
        try:
            if os.path.isfile(tmp) and os.path.getsize(tmp) == 0:
                os.remove(tmp)
        except Exception:
            pass


def _ensure_buffalo() -> bool:
    if _buffalo_ready():
        return True
    import zipfile

    zpath = os.path.join(INSIGHTFACE_MODELS_DIR, "buffalo_l.zip")
    if not _download(BUFFALO_URL, zpath, "buffalo"):
        return False
    try:
        bdir = os.path.join(INSIGHTFACE_MODELS_DIR, "buffalo_l")
        os.makedirs(bdir, exist_ok=True)
        with zipfile.ZipFile(zpath) as z:
            z.extractall(bdir)
        # some zip layouts extract flat — move the onnx files inside buffalo_l/
        if not _buffalo_ready():
            for f in os.listdir(INSIGHTFACE_MODELS_DIR):
                if f.endswith(".onnx"):
                    os.replace(os.path.join(INSIGHTFACE_MODELS_DIR, f), os.path.join(bdir, f))
        return _buffalo_ready()
    except Exception as e:
        traceback.print_exc()
        with _DL_LOCK:
            _DL["buffalo"]["state"] = "error"
            _DL["buffalo"]["error"] = str(e)[:200]
        return False


def _ensure_swapper_model() -> bool:
    if _swapper_ready():
        return True
    dest = os.path.join(INSIGHTFACE_MODELS_DIR, "inswapper_128.onnx")
    ok = _download(SWAP_MODEL_URL, dest, "inswapper")
    return ok and _swapper_ready()


def _self_heal_models():
    """Download whatever model is missing. Runs in a daemon thread."""
    _hlog("self-heal thread started")
    try:
        if not _buffalo_ready():
            _hlog("buffalo_l missing — downloading")
            _ensure_buffalo()
    except Exception:
        _hlog("buffalo heal crashed: " + traceback.format_exc(limit=2))
        traceback.print_exc()
    try:
        if not _swapper_ready():
            _hlog("inswapper missing — downloading")
            _ensure_swapper_model()
    except Exception:
        _hlog("inswapper heal crashed: " + traceback.format_exc(limit=2))
        traceback.print_exc()
    _hlog(f"self-heal finished: buffalo={_buffalo_ready()} swapper={_swapper_ready()}")


def _kick_self_heal():
    """Start the self-heal thread once (no-op afterwards)."""
    if _SELF_HEAL_STARTED[0]:
        return
    _SELF_HEAL_STARTED[0] = True
    threading.Thread(target=_self_heal_models, daemon=True).start()


def _model_state() -> dict:
    with _DL_LOCK:
        st = {k: dict(v) for k, v in _DL.items()}
    if _buffalo_ready():
        st["buffalo"]["state"] = "ready"
        st["buffalo"]["progress"] = 100
    if _swapper_ready():
        st["inswapper"]["state"] = "ready"
        st["inswapper"]["progress"] = 100
    return st

# Memory guard: warming all models costs ~1.7-2.0GB RSS. On small hosts
# (e.g. 4GB boxes where next-server itself needs ~1.5GB) a boot-time warm
# triggers the kernel OOM killer, which shoots next-server mid-request and
# the browser shows "Unexpected token '<'" (HTML proxy error page).
# Models stay LAZY: /swap and /detect load them on first real use.
MIN_TOTAL_GB_TO_WARM = 6.0   # deterministic: small hosts never warm (MemAvailable lies there)
MIN_FREE_GB_TO_WARM = 2.4    # big hosts: still need headroom right now


def _mem_gb():
    """(total_gb, available_gb). psutil → /proc/meminfo → assume big PC."""
    total, avail = 16.0, 8.0
    try:
        import psutil
        vm = psutil.virtual_memory()
        return vm.total / (1024 ** 3), vm.available / (1024 ** 3)
    except Exception:
        pass
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemTotal"):
                    total = int(line.split()[1]) / (1024 ** 2)
                elif line.startswith("MemAvailable"):
                    avail = int(line.split()[1]) / (1024 ** 2)
    except Exception:
        pass
    return total, avail


def _ensure_face_app():
    """Load ONLY the buffalo_l face detector — never the swap model.

    Detection (/detect, /detect-persons) must keep working even when the
    555MB inswapper_128.onnx is missing (fresh Codespace / clean repo
    before restore-models.sh). Numbered boxes are a detector feature.
    """
    global FACE_APP
    if FACE_APP is not None:
        return
    from insightface.app import FaceAnalysis

    FACE_APP = FaceAnalysis(name="buffalo_l", providers=("CPUExecutionProvider",))
    FACE_APP.prepare(ctx_id=0, det_size=(320, 320))


def _ensure_loaded():
    """Lazily load detector + swapper on first swap request (saves memory)."""
    global SWAPPER, FACE_APP
    if SWAPPER is not None and FACE_APP is not None:
        return
    if not os.path.exists(MODEL_PATH):
        raise RuntimeError(
            f"Swap model not found (looked at: {MODEL_PATH}). Restore it with "
            "scripts/restore-models.sh, or download inswapper_128.onnx from "
            "https://huggingface.co/ModelsLab/inswapper/resolve/main/inswapper_128.onnx "
            "into mini-services/face-swap-pro/models/"
        )
    from insightface.model_zoo import get_model

    _ensure_face_app()
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
        "model_found": os.path.exists(MODEL_PATH),
        "model_loaded": os.path.exists(MODEL_PATH),  # legacy field name
        "models_loaded": SWAPPER is not None and FACE_APP is not None,
        "hq_loaded": FACE_APP_HQ is not None,
        "model_path": MODEL_PATH,
        "swap_ready": _swapper_ready(),
        "buffalo_ready": _buffalo_ready(),
        "model_state": _model_state(),
        "service": "face-swap-pro",
        "port": 3030,
    }


@app.get("/warm")
def warm():
    """Preload ALL models in a background thread and return immediately.

    Called by ensure-services on page load so the 10-30s model load happens
    while the user is still browsing — by the time they upload, detection
    responds in ~1s instead of ~40s.

    LOW-MEMORY HOSTS: skipped when free RAM < MIN_FREE_GB_TO_WARM so the
    boot warm-up can never OOM-kill next-server. Models then load lazily
    on the first face-swap/detect request instead.
    """
    already = SWAPPER is not None and FACE_APP is not None and FACE_APP_HQ is not None
    total_gb, free_gb = _mem_gb()
    if not already and (total_gb < MIN_TOTAL_GB_TO_WARM or free_gb < MIN_FREE_GB_TO_WARM):
        return {
            "ok": True, "alreadyWarm": False, "warming": False,
            "skipped": "low-memory",
            "totalGb": round(total_gb, 2),
            "availableGb": round(free_gb, 2),
        }

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

        # Detection needs ONLY buffalo_l — never require the swap model here,
        # otherwise numbered boxes vanish on hosts without inswapper_128.onnx.
        # SELF-HEAL: detector missing on a fresh session → report download
        # progress instead of a hard 500.
        if not _buffalo_ready():
            _kick_self_heal()
            st = _model_state().get("buffalo", {})
            return JSONResponse(
                {"ok": False,
                 "error": "نموذج كشف الوجوه قيد التحميل (%d%%) — أعد المحاولة بعد قليل" % st.get("progress", 0),
                 "downloading": True, "progress": st.get("progress", 0)},
                status_code=503)
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

        # SELF-HEAL: swap model missing on a fresh session (clean repo, no
        # *.onnx on GitHub) → kick the download and report progress instead of
        # the old hard failure "Swap model not found" on EVERY new session.
        if not _swapper_ready():
            _kick_self_heal()
            st = _model_state().get("inswapper", {})
            prog = st.get("progress", 0)
            state = st.get("state", "downloading")
            msg = ("نموذج تبديل الوجه قيد التحميل (%d%%) — سيكتمل تلقائياً، أعد المحاولة بعد دقيقة" % prog)
            if state == "error":
                msg = "فشل تحميل نموذج تبديل الوجه — سيُعاد المحاولة تلقائياً"
            return JSONResponse(
                {"ok": False, "error": msg,
                 "downloading": True, "progress": prog, "modelState": state},
                status_code=503)

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

        # Same rule as /detect: buffalo_l only — no swap model required.
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
def _find_results_dir() -> str:
    """Locate <project>/data/results without hardcoding /home/z/my-project.

    Works on the local box, inside .next/standalone layouts, and on
    Codespaces where the repo lives under /workspaces/<name>.
    """
    here = os.getcwd()
    dirs = [os.path.dirname(os.path.abspath(__file__))]
    p = here
    for _ in range(6):
        dirs.append(p)
        parent = os.path.dirname(p)
        if parent == p:
            break
        p = parent
    for d in dirs:
        cand = os.path.join(d, "data", "results")
        if os.path.isdir(cand):
            return cand
    # Nothing found — create it next to the service source, then fall back.
    fallback = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "results")
    try:
        os.makedirs(fallback, exist_ok=True)
        return fallback
    except Exception:
        return "/tmp/ai-studio-results"


RESULTS_DIR = _find_results_dir()


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


# ===========================================================================
# PART TRANSPLANT (نقل الأجزاء) — /transplant
#
# Move a PART from a reference image onto a source image and blend it so the
# result looks real: auto-resize, skin-tone / lighting / color harmonization
# and Poisson (seamless) cloning. Works for heads, whole persons, animals,
# objects and backgrounds.
#
# Modes:
#   head       → reference HEAD (face+hair) replaces the source head,
#                aligned via 5-point landmarks, scaled automatically.
#   person     → reference PERSON (GrabCut cutout, face-guided) replaces the
#                source person, scaled to the source body.
#   object     → dominant subject of the reference (animal / object) is
#                placed onto the source at a target box (default: center).
#   background → keep the SOURCE person, transplant the REFERENCE
#                background behind them (subject composited onto ref).
#
# Payload (JSON):
#   source, ref          → data URLs (required)
#   mode                 → "head" | "person" | "object" | "background"
#   sourceIndex/faceIndex→ face indices (head/person modes, default 0 = largest)
#   scale                → size multiplier on the auto-fitted size (default 1.0)
#   targetBox            → optional {x,y,w,h} normalized — where to place
#   colorStrength        → 0..1 skin/light harmonization strength (default .6)
# ===========================================================================

def _rounded_mask(w, h, radius_frac=0.22, blur_frac=0.06):
    """Feathered rounded-rectangle mask (0..255) covering most of a box."""
    import numpy as np
    import cv2
    m = np.zeros((int(h), int(w)), np.uint8)
    r = int(min(w, h) * radius_frac)
    cv2.rectangle(m, (r, 0), (int(w) - r, int(h)), 255, -1)
    cv2.rectangle(m, (0, r), (int(w), int(h) - r), 255, -1)
    for cx, cy in ((r, r), (int(w) - r, r), (r, int(h) - r), (int(w) - r, int(h) - r)):
        cv2.circle(m, (cx, cy), r, 255, -1)
    k = max(3, int(min(w, h) * blur_frac) | 1)
    return cv2.GaussianBlur(m, (k, k), 0)


def _grabcut_subject(img, rect=None, iters=4):
    """Extract the dominant subject inside `rect` via GrabCut.

    Returns (cut_bgr, cut_mask) — the tight bounding crop of the subject and
    its feathered alpha mask — or (None, None) when nothing solid is found.
    """
    import numpy as np
    import cv2
    h, w = img.shape[:2]
    if rect is None:
        rect = (int(w * 0.10), int(h * 0.05), int(w * 0.80), int(h * 0.92))
    x, y, rw, rh = [int(v) for v in rect]
    x, y = max(0, x), max(0, y)
    rw, rh = min(w - x - 1, rw), min(h - y - 1, rh)
    if rw < 12 or rh < 12:
        return None, None
    gc = np.zeros((h, w), np.uint8)
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(img, gc, (x, y, rw, rh), bgd, fgd, iters, cv2.GC_INIT_WITH_RECT)
    m = np.where((gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None, None
    c = max(cnts, key=cv2.contourArea)
    # reject only when the found component is tiny RELATIVE TO THE SEARCH
    # RECT (not the whole image — a face-guided rect in a large photo is
    # legitimately much smaller than the frame).
    if cv2.contourArea(c) < max(0.02 * w * h * 0.25, 0.15 * rw * rh) * 0.25:
        return None, None
    comp = np.zeros_like(m)
    cv2.drawContours(comp, [c], -1, 255, -1)
    m = cv2.bitwise_and(m, comp)
    ys, xs = np.where(comp > 0)
    x1, x2, y1, y2 = xs.min(), xs.max(), ys.min(), ys.max()
    pad = int(0.02 * max(w, h))
    x1, y1 = max(0, x1 - pad), max(0, y1 - pad)
    x2, y2 = min(w - 1, x2 + pad), min(h - 1, y2 + pad)
    cut = img[y1:y2 + 1, x1:x2 + 1].copy()
    cm = m[y1:y2 + 1, x1:x2 + 1]
    k = max(3, (int(0.015 * max(w, h))) | 1)
    cm = cv2.GaussianBlur(cm, (k, k), 0)
    return cut, cm


def _match_color_to(img_cut, img_context, mask=None, strength=0.6):
    """Shift the cutout's color stats toward the destination scene.

    L (luminance) follows the scene STRONGLY (lighting match), a/b (color)
    shifts gently so a transplanted part keeps its own hue. Masked stats
    ignore the black/transparent padding around the cutout.
    """
    import numpy as np
    import cv2
    if img_cut.size == 0 or img_context.size == 0:
        return img_cut
    a = cv2.cvtColor(img_context, cv2.COLOR_BGR2LAB).astype(np.float32)
    b = cv2.cvtColor(img_cut, cv2.COLOR_BGR2LAB).astype(np.float32)
    out = b.copy()
    msel = None
    if mask is not None and mask.shape[:2] == b.shape[:2] and mask.max() > 10:
        msel = mask > 100
        if int(msel.sum()) < 50:
            msel = None
    # s_l tracks the scene luminance; strength<=0 must mean FULLY OFF
    # (the hair overlay calls with 0.0 after its own hair-anchored match —
    # the old "+0.30 bias even at zero" re-lightened dark hair into the
    # pale translucent veil over the head).
    s_l = 0.0 if strength <= 0 else min(1.0, strength + 0.30)
    s_ab = max(0.0, strength) * 0.75            # chroma keeps most of its own hue
    gains = (s_l, s_ab, s_ab)
    for c in range(3):
        ma, sa = float(a[..., c].mean()), float(a[..., c].std()) + 1e-6
        if msel is not None:
            mb = float(b[..., c][msel].mean())
            sb = float(b[..., c][msel].std()) + 1e-6
        else:
            mb, sb = float(b[..., c].mean()), float(b[..., c].std()) + 1e-6
        ratio = min(sb / sa, 1.6)
        shifted = (b[..., c] - mb) * ratio + ma
        out[..., c] = b[..., c] * (1 - gains[c]) + shifted * gains[c]
    res = cv2.cvtColor(np.clip(out, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)
    if mask is not None:
        mf = (cv2.cvtColor(mask, cv2.COLOR_GRAY2BGR).astype(np.float32) / 255.0)
        res = (res.astype(np.float32) * mf + img_cut.astype(np.float32) * (1 - mf)).astype(np.uint8)
    return res


def _match_color_to_pixels(img, sel_mask, target_pixels, strength=0.6):
    """LAB mean/std shift of `img` (inside sel_mask) toward a pixel LIST.

    Used by the hair overlay: the transplanted hair must adopt the color
    and lighting of the DESTINATION'S OWN HAIR (the pixels it grows into),
    not of the background ring around it — matching the ring turned blonde
    hair into a translucent beige veil ("wig dropped on top" look).
    """
    import numpy as np
    import cv2
    if img.size == 0 or target_pixels is None or len(target_pixels) < 50:
        return img
    if sel_mask is None or sel_mask.max() == 0:
        return img
    t = np.asarray(target_pixels, np.float32)
    t_lab = cv2.cvtColor(
        np.clip(t, 0, 255).astype(np.uint8).reshape(-1, 1, 3), cv2.COLOR_BGR2LAB
    ).reshape(-1, 3).astype(np.float32)
    b = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
    msel = sel_mask if sel_mask.dtype == bool else sel_mask > 120
    out = b.copy()
    s_l = min(1.0, strength + 0.20)
    s_ab = strength * 0.85
    gains = (s_l, s_ab, s_ab)
    for c in range(3):
        mt, st = float(t_lab[:, c].mean()), float(t_lab[:, c].std()) + 1e-6
        mb = float(b[..., c][msel].mean())
        sb = float(b[..., c][msel].std()) + 1e-6
        ratio = min(sb / st, 1.6)
        shifted = (b[..., c] - mb) * ratio + mt
        out[..., c] = b[..., c] * (1 - gains[c]) + shifted * gains[c]
    res = cv2.cvtColor(np.clip(out, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR)
    mf = (sel_mask.astype(np.float32) if sel_mask.dtype == bool
          else (sel_mask > 120).astype(np.float32))[..., None]
    return (res.astype(np.float32) * mf + img.astype(np.float32) * (1 - mf)).astype(np.uint8)


def _hist_match_channel(src_vals, ref_vals):
    """Remap 1-D values of src onto the distribution of ref (quantile map)."""
    import numpy as np
    s = np.sort(np.asarray(src_vals, np.float32))
    r = np.sort(np.asarray(ref_vals, np.float32))
    n = int(s.size)
    if n == 0 or r.size == 0:
        return np.asarray(src_vals, np.float32)
    ranks = np.clip(np.linspace(0, r.size - 1, n).astype(int), 0, r.size - 1)
    mapped = r[ranks]
    pos = np.clip(np.searchsorted(s, np.asarray(src_vals, np.float32)), 0, n - 1)
    return mapped[pos]


def _match_lighting_to(cut, context, mask, strength=0.9):
    """Histogram-match the cutout luminance to the scene luminance.

    This is what removes the "pasted brightness" look: the transplanted
    part inherits the exact brightness distribution of the destination
    photo (shadows, highlights, exposure).
    """
    import numpy as np
    import cv2
    if context.size == 0 or cut.size == 0 or mask.max() < 10 or strength <= 0:
        return cut
    msel = mask > 100
    if int(msel.sum()) < 100 or int(msel.sum()) >= mask.size:
        return cut
    cut_lab = cv2.cvtColor(cut, cv2.COLOR_BGR2LAB)
    ctx_lab = cv2.cvtColor(context, cv2.COLOR_BGR2LAB)
    L = cut_lab[..., 0].astype(np.float32)
    ref_L = ctx_lab[..., 0].reshape(-1).astype(np.float32)
    matched = _hist_match_channel(L[msel], ref_L)
    # bounded shift: align overall exposure WITHOUT flattening the part's
    # own internal shading (shadows/highlights keep their relationships)
    delta = np.clip(matched - L[msel], -35.0, 35.0)
    newL = L.copy()
    newL[msel] = L[msel] + delta * strength
    cut_lab[..., 0] = np.clip(newL, 0, 255).astype(np.uint8)
    return cv2.cvtColor(cut_lab, cv2.COLOR_LAB2BGR)


def _noise_level(gray):
    """Sensor-noise std estimate from the Laplacian high-pass."""
    import numpy as np
    import cv2
    lap = cv2.Laplacian(gray, cv2.CV_32F)
    return float(lap.std()) / np.sqrt(20.0)


def _match_grain(cut, context, mask):
    """Add destination-matching sensor grain to the cutout.

    A clean cutout inside a noisy photo screams "pasted". Matching the
    grain makes both areas feel like one capture.
    """
    import numpy as np
    import cv2
    if context.size == 0 or cut.size == 0 or mask.max() < 10:
        return cut
    msel = mask > 100
    if int(msel.sum()) < 100:
        return cut
    n_dst = _noise_level(cv2.cvtColor(context, cv2.COLOR_BGR2GRAY))
    n_cut = _noise_level(cv2.cvtColor(cut, cv2.COLOR_BGR2GRAY))
    extra = n_dst - n_cut
    if extra < 0.15:
        return cut
    extra = min(extra, 6.0)
    rng = np.random.default_rng(7)
    noise = rng.normal(0.0, extra, cut.shape).astype(np.float32)
    mf = (mask.astype(np.float32) / 255.0)[..., None]
    out = np.clip(cut.astype(np.float32) + noise * mf, 0, 255)
    return out.astype(np.uint8)


def _pyramid_blend(base, top, mask, levels=6):
    """Laplacian-pyramid blending — the core of the "one whole image" look.

    Low frequencies of the transplanted part bleed over a WIDE area into
    the destination while high frequencies (edges, texture) stay sharp,
    so no visible seam or cutout boundary remains.
    """
    import numpy as np
    import cv2
    base = base.astype(np.float32)
    top = top.astype(np.float32)
    mask = mask.astype(np.float32) / 255.0
    h, w = base.shape[:2]
    levels = max(2, min(int(levels), int(np.log2(max(2, min(h, w)))) - 3))
    lb, lt, gm = [], [], []
    b, t, m = base, top, mask
    for _ in range(levels):
        b_d, t_d, m_d = cv2.pyrDown(b), cv2.pyrDown(t), cv2.pyrDown(m)
        size = (b.shape[1], b.shape[0])
        lb.append(b - cv2.pyrUp(b_d, dstsize=size))
        lt.append(t - cv2.pyrUp(t_d, dstsize=size))
        gm.append(m)
        b, t, m = b_d, t_d, m_d
    lb.append(b)
    lt.append(t)
    gm.append(m)
    out = lb[-1] * (1 - gm[-1][..., None]) + lt[-1] * gm[-1][..., None]
    for i in range(levels - 1, -1, -1):
        size = (lb[i].shape[1], lb[i].shape[0])
        out = cv2.pyrUp(out, dstsize=size)
        m = gm[i][..., None]
        out = out + m * lt[i] + (1 - m) * lb[i]
    return np.clip(out, 0, 255).astype(np.uint8)


def _blend_onto(dst, cut, mask, box, color_strength=0.6, context_pad=0.5,
                pad_frac=0.8, levels=6, guard=None):
    """Scale `cut`/`mask` into `box`=(x,y,w,h) on dst and HARMONIZE it.

    The "one whole image" pipeline (no visible part boundary):
      1. resize + generous feathering of the mask
      2. LAB color transfer toward the ring AROUND the box (excluded box)
      3. luminance histogram match — inherits scene exposure/lighting
      4. sensor-grain matching — same camera noise feel everywhere
      5. Laplacian-pyramid blending — low frequencies bleed wide, edges
         stay sharp → no seam, no cutout look

    guard: full-size (H,W) 0..255 mask in DESTINATION coordinates — the
    blend may only paint where guard allows (e.g. destination hair zone),
    so a hand-edited hair transplant can never spill over face/background.
    """
    import numpy as np
    import cv2
    H, W = dst.shape[:2]
    x, y, bw, bh = [int(round(v)) for v in box]
    x, y = max(0, x), max(0, y)
    bw, bh = min(W - x, max(4, bw)), min(H - y, max(4, bh))
    if bw < 8 or bh < 8:
        return dst

    cut_r = cv2.resize(cut, (bw, bh), interpolation=cv2.INTER_LANCZOS4)
    mask_r = cv2.resize(mask, (bw, bh), interpolation=cv2.INTER_LANCZOS4)
    mask_r = cv2.normalize(mask_r, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    if guard is not None:
        gx1_, gy1_ = max(0, x), max(0, y)
        gx2_, gy2_ = min(W, x + bw), min(H, y + bh)
        if gx2_ > gx1_ and gy2_ > gy1_:
            g_sub = guard[gy1_:gy2_, gx1_:gx2_]
            g_full = np.zeros((bh, bw), np.float32)
            g_full[:g_sub.shape[0], :g_sub.shape[1]] = g_sub.astype(np.float32) / 255.0
            mask_r = (mask_r.astype(np.float32) * g_full).astype(np.uint8)
    k = max(3, int(0.055 * min(bw, bh)) | 1)
    mask_r = cv2.GaussianBlur(mask_r, (k, k), 0)

    # ring context AROUND the box, with the box itself neutralized so the
    # stats describe the SURROUNDINGS the part must merge into
    px, py = max(4, int(bw * context_pad)), max(4, int(bh * context_pad))
    ex1, ey1 = max(0, x - px), max(0, y - py)
    ex2, ey2 = min(W, x + bw + px), min(H, y + bh + py)
    ring = dst[ey1:ey2, ex1:ex2].copy()
    rx0, ry0 = x - ex1, y - ey1
    ring_s = ring
    border = np.concatenate([
        ring[:ry0].reshape(-1, 3), ring[ry0 + bh:].reshape(-1, 3),
        ring[ry0:ry0 + bh, :rx0].reshape(-1, 3),
        ring[ry0:ry0 + bh, rx0 + bw:].reshape(-1, 3)])
    if border.size and border.shape[0] >= 0.3 * bw * bh:
        fill = np.median(border, axis=0).astype(np.uint8)
        ring_s = ring.copy()
        ring_s[ry0:ry0 + bh, rx0:rx0 + bw] = fill

    orig_cut = cut_r.copy()
    cut_r = _match_color_to(cut_r, ring_s, mask=mask_r, strength=color_strength)
    cut_r = _match_lighting_to(cut_r, ring_s, mask_r, strength=color_strength)
    # restore the fine detail (skin texture, hair strands, shading) that
    # global harmonization tends to flatten
    fine = orig_cut.astype(np.float32) - cv2.GaussianBlur(orig_cut, (0, 0), 4.0).astype(np.float32)
    mfine = (mask_r.astype(np.float32) / 255.0)[..., None]
    cut_r = np.clip(cut_r.astype(np.float32) + 0.40 * fine * mfine, 0, 255).astype(np.uint8)
    cut_r = _match_grain(cut_r, ring_s, mask_r)

    # working region: box + margin, so pyramid blending can bleed the low
    # frequencies well beyond the part boundary
    pad = int(pad_frac * max(bw, bh))
    wx1, wy1 = max(0, x - pad), max(0, y - pad)
    wx2, wy2 = min(W, x + bw + pad), min(H, y + bh + pad)
    work = dst[wy1:wy2, wx1:wx2].copy()
    h2, w2 = work.shape[:2]
    canvas = np.zeros((h2, w2, 3), np.uint8)
    mcanvas = np.zeros((h2, w2), np.uint8)
    ox, oy = x - wx1, y - wy1
    cw, ch = min(bw, w2 - ox), min(bh, h2 - oy)
    canvas[oy:oy + ch, ox:ox + cw] = cut_r[:ch, :cw]
    mcanvas[oy:oy + ch, ox:ox + cw] = mask_r[:ch, :cw]
    try:
        blended = _pyramid_blend(work, canvas, mcanvas, levels=levels)
        dst[wy1:wy2, wx1:wx2] = blended
    except Exception:
        mf = (mcanvas.astype(np.float32) / 255.0)[..., None]
        out = canvas.astype(np.float32) * mf + work.astype(np.float32) * (1 - mf)
        dst[wy1:wy2, wx1:wx2] = out.astype(np.uint8)
    return dst


def _head_mask_grabcut(img, rect, iters=5):
    """Full-size (0/255, lightly feathered) mask of the HEAD inside `rect`.

    GrabCut separates hair+face from the reference background so the
    transplant carries NO rectangular background patch. Falls back to a
    filled rect when GrabCut finds nothing solid.
    """
    import numpy as np
    import cv2
    h, w = img.shape[:2]
    fallback = np.zeros((h, w), np.uint8)
    x, y, rw, rh = [int(v) for v in rect]
    x, y = max(0, x), max(0, y)
    rw, rh = min(w - x - 1, rw), min(h - y - 1, rh)
    cv2.rectangle(fallback, (x, y), (x + rw, y + rh), 255, -1)
    if rw < 12 or rh < 12:
        return fallback
    gc = np.zeros((h, w), np.uint8)
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(img, gc, (x, y, rw, rh), bgd, fgd, iters, cv2.GC_INIT_WITH_RECT)
    m = np.where((gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return fallback
    c = max(cnts, key=cv2.contourArea)
    if cv2.contourArea(c) < 0.10 * rw * rh:
        return fallback
    comp = np.zeros_like(m)
    cv2.drawContours(comp, [c], -1, 255, -1)
    m = cv2.bitwise_and(m, comp)
    k = max(3, (int(0.04 * min(rw, rh))) | 1)
    return cv2.GaussianBlur(m, (k, k), 0)


_REMBG_SESSION = None


def _rembg_mask(img):
    """Full-size subject alpha mask via rembg U2Net (0..255 uint8) or None.

    U2Net gives FAR cleaner subject silhouettes than GrabCut — this is what
    removes the "rectangular patch pasted on top" failure mode.

    MEMORY GUARD: the sandbox has only 4GB and the swap models already hold
    ~2GB — running U2Net on a 1600px+ image OOM-kills the whole service.
    Masks are low-frequency: run rembg on a ≤1024px copy and upscale the
    alpha back (no visible quality loss, ~2.4× less peak memory).
    """
    global _REMBG_SESSION
    try:
        from rembg import remove, new_session
        import numpy as np
        import cv2
        if _REMBG_SESSION is None:
            _REMBG_SESSION = new_session("u2net")
        h, w = img.shape[:2]
        s = min(1.0, 1024.0 / max(h, w))
        if s < 1.0:
            small = cv2.resize(img, (int(w * s), int(h * s)),
                               interpolation=cv2.INTER_AREA)
        else:
            small = img
        out = remove(small, session=_REMBG_SESSION)
        alpha = np.asarray(out)[..., 3].copy()
        del out, small
        if s < 1.0:
            alpha = cv2.resize(alpha, (w, h), interpolation=cv2.INTER_LINEAR)
        return alpha
    except Exception:
        return None


def _largest_component(mask, thresh=100):
    """Keep only the largest connected bright component of a soft mask."""
    import numpy as np
    import cv2
    m = (mask > thresh).astype(np.uint8) * 255
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return np.zeros_like(mask)
    c = max(cnts, key=cv2.contourArea)
    comp = np.zeros_like(m)
    cv2.drawContours(comp, [c], -1, 255, -1)
    return cv2.bitwise_and(mask, comp)


def _subject_mask_full(img, rect=None):
    """Full-size subject mask: rembg (U2Net) first, GrabCut fallback.

    rect=(x,y,w,h) optionally limits the subject to a region (e.g. the head
    bounding area). Result is soft-feathered so blending never shows a hard
    cutout edge.
    """
    import numpy as np
    import cv2
    h, w = img.shape[:2]
    m = _rembg_mask(img)
    if m is not None:
        m = _largest_component(m, thresh=60)
        if rect is not None:
            lim = np.zeros((h, w), np.uint8)
            rx, ry, rw, rh = [int(v) for v in rect]
            cv2.rectangle(lim, (rx, ry), (rx + rw, ry + rh), 255, -1)
            m = cv2.bitwise_and(m, lim)
            m = _largest_component(m, thresh=40)
        if (m > 100).sum() >= 0.02 * h * w:
            k = max(3, (int(0.03 * max(h, w))) | 1)
            return cv2.GaussianBlur(m, (k, k), 0)
    return _head_mask_grabcut(
        img, rect if rect is not None else
        (int(w * 0.10), int(h * 0.05), int(w * 0.80), int(h * 0.92)))


def _extract_subject(img, rect=None):
    """(cut, mask) tight crop of the subject: rembg first, GrabCut fallback."""
    import numpy as np
    import cv2
    h, w = img.shape[:2]
    m_full = _subject_mask_full(img, rect)
    m_hard = (m_full > 100).astype(np.uint8) * 255
    cnts, _ = cv2.findContours(m_hard, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if m_hard.sum() < 0.01 * h * w or not cnts:
        return _grabcut_subject(img, rect=rect)
    c = max(cnts, key=cv2.contourArea)
    comp = np.zeros_like(m_hard)
    cv2.drawContours(comp, [c], -1, 255, -1)
    m_hard = cv2.bitwise_and(m_hard, comp)
    ys, xs = np.where(m_hard > 0)
    x1, x2, y1, y2 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    pad = int(0.02 * max(h, w))
    x1, y1 = max(0, x1 - pad), max(0, y1 - pad)
    x2, y2 = min(w - 1, x2 + pad), min(h - 1, y2 + pad)
    cut = img[y1:y2 + 1, x1:x2 + 1].copy()
    cm = m_full[y1:y2 + 1, x1:x2 + 1]
    k = max(3, (int(0.02 * max(w, h))) | 1)
    cm = cv2.GaussianBlur(cm, (k, k), 0)
    return cut, cm


def _face_rect(f):
    """(x1,y1,x2,y2) ints from an insightface bbox."""
    import numpy as np
    b = np.asarray(f.bbox).flatten()
    return int(b[0]), int(b[1]), int(b[2]), int(b[3])


# ======================================================================
# Selection engine (نص عربي → قناع + معاينة) — /regions/select
# ======================================================================

def _regions_mod():
    """Import regions.py regardless of how the service was launched."""
    import importlib
    import os
    import sys
    if "regions" in sys.modules:
        return sys.modules["regions"]
    d = os.path.dirname(os.path.abspath(__file__))
    if d not in sys.path:
        sys.path.insert(0, d)
    return importlib.import_module("regions")


def _cap_img(img, max_dim=1600):
    """نفس قص الأبعاد المستخدم في /transplant حتى تتطابق الأقنعة."""
    import cv2
    h, w = img.shape[:2]
    s = max_dim / max(h, w)
    if s < 1.0:
        img = cv2.resize(img, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    return img, s


def _encode_gray_png(m) -> str:
    import cv2
    ok, buf = cv2.imencode(".png", m)
    if not ok:
        return ""
    return f"data:image/png;base64,{base64.b64encode(buf.tobytes()).decode()}"


def _load_mask_png(s: str, w: int, h: int):
    """فك قناع PNG (data URL) وتحويله لمقاس الصورة."""
    import cv2
    import numpy as np
    m = _load_image(s)
    if m is None:
        return None
    if m.ndim == 3:
        m = cv2.cvtColor(m, cv2.COLOR_BGR2GRAY)
    if m.shape[:2] != (h, w):
        m = cv2.resize(m, (w, h), interpolation=cv2.INTER_LINEAR)
    return m


@app.post("/regions/select")
async def regions_select(req: Request):
    """تحديد منطقة بالنص العربي أو بمواصفات جاهزة — يعيد قناعاً ومعاينة.

    Body:
        { "image": "<data URL>",            # الصورة المراد التحديد عليها
          "text": "الرأس",                  # النص العربي (اختياري إذا أرسلت spec)
          "spec": {"part": "head", ...} }   # أو مواصفات جاهزة من المحلل اللغوي

    Returns:
        { ok, label, spec, overlay, mask, bbox, areaPct, width, height, faces }
        أو { ok:false, unparsed:true, faces, hint } إذا لم يُفهم النص.
    """
    try:
        body = await req.json()
    except Exception:
        return JSONResponse({"ok": False, "error": "invalid JSON body"}, status_code=400)
    from starlette.concurrency import run_in_threadpool
    return await run_in_threadpool(_regions_select_impl, body)


def _regions_select_impl(body: dict):
    import numpy as np
    import cv2
    import re
    try:
        R = _regions_mod()
        img_data = body.get("image") or body.get("source") or body.get("ref")
        if not img_data:
            return JSONResponse({"ok": False, "error": "'image' مطلوب"}, status_code=400)
        img = _load_image(img_data)
        if img is None:
            return JSONResponse({"ok": False, "error": "تعذر قراءة الصورة"}, status_code=400)
        img, _s = _cap_img(img)
        H, W = img.shape[:2]

        text = str(body.get("text") or "").strip()
        spec_in = body.get("spec")

        # وجوه الصورة (للأجزاء المرتبطة بالوجه واختيار الشخص)
        faces = []
        try:
            faces, _, _ = _detect_sorted(img, hq=True)
        except Exception:
            faces = []
        faces_payload = _faces_payload(faces, W, H)

        spec, label = None, None
        if isinstance(spec_in, dict) and spec_in.get("part"):
            spec = dict(spec_in)
            label = R.LABELS.get(str(spec.get("part")), str(spec.get("part")))
        elif text:
            tn = R.normalize_ar(text)
            prev = body.get("prevSpec")
            if isinstance(prev, dict) and prev.get("part"):
                # ---- تعديل على تحديد قائم (معاينة تكرارية) ----
                if "تحديد" in tn and any(w in tn for w in ("كبر", "وسع", "زود")):
                    prev = dict(prev)
                    prev["expand"] = float(prev.get("expand") or 0.0) + 0.15
                    spec = prev
                elif "تحديد" in tn and any(w in tn for w in ("صغر", "ضيق", "قلل")):
                    prev = dict(prev)
                    prev["expand"] = float(prev.get("expand") or 0.0) - 0.15
                    spec = prev
                elif any(w in tn for w in ("بدون", "غير ", "استثني", "استبعد")):
                    # استثناء جزء داخلي: «بدون الوجه» / «الرأس بدون الشعر»
                    rest = re.split(r"بدون|غير |استثني|استبعد", tn, maxsplit=1)[-1].strip()
                    inner, _il = R.parse_region_text(rest, faces, W, H) if rest else (None, None)
                    prev = dict(prev)
                    if inner is not None:
                        prev["exclude"] = inner
                    spec = prev
                else:
                    spec, label = R.parse_region_text(text, faces, W, H)
            else:
                spec, label = R.parse_region_text(text, faces, W, H)
            if spec is None:
                return JSONResponse({
                    "ok": False, "unparsed": True,
                    "error": "لم أفهم المكان المطلوب — جرّب مثلاً: «الرأس»، «الشعر»، "
                             "«الذراعين»، «الخلفية»، «الشخص الثاني»، «النصف العلوي»",
                    "hint": R.SUGGESTIONS, "faces": faces_payload,
                    "width": int(W), "height": int(H),
                })

        # قناع الموضوع (rembg — مكلف، يُحسب فقط عند الحاجة)
        subject = None
        if R.needs_subject(str(spec.get("part"))):
            try:
                subject = _subject_mask_full(img, None)
            except Exception:
                subject = None

        mask, label = R.build_mask(img, spec, faces, subject)
        if mask is None:
            return JSONResponse({
                "ok": False, "error": label or "تعذر بناء التحديد",
                "hint": R.SUGGESTIONS, "faces": faces_payload,
                "width": int(W), "height": int(H),
            })
        if (mask > 60).sum() < 0.002 * W * H:
            return JSONResponse({
                "ok": False,
                "error": f"تحديد «{label}» صغير جداً أو فارغ في هذه الصورة — عدّل الكتابة",
                "hint": R.SUGGESTIONS, "faces": faces_payload,
                "width": int(W), "height": int(H),
            })

        overlay = R.render_overlay(img, mask)
        return {
            "ok": True,
            "label": label,
            "spec": spec,
            "overlay": _encode_png(overlay),
            "mask": _encode_gray_png(mask),
            "bbox": R.bbox_norm(mask),
            "areaPct": round(100.0 * float((mask > 60).sum()) / float(W * H), 1),
            "width": int(W), "height": int(H),
            "faces": faces_payload,
        }
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.post("/transplant")
async def transplant(req: Request):
    """نقل جزء من صورة مرجعية إلى الصورة المصدر مع دمج واقعي كامل.

    Heavy work (model load, GrabCut, Poisson) runs in the threadpool so the
    event loop stays free — /health must keep answering while we work,
    otherwise the guardian thinks the service is dead and kills it mid-job.
    """
    try:
        body = await req.json()
    except Exception:
        return JSONResponse({"ok": False, "error": "invalid JSON body"}, status_code=400)
    from starlette.concurrency import run_in_threadpool
    return await run_in_threadpool(_transplant_impl, body)


def _transplant_impl(body: dict):
    try:
        src_data = body.get("source")
        ref_data = body.get("ref")
        mode = str(body.get("mode") or "head").lower()
        if not src_data or not ref_data:
            return JSONResponse({"ok": False, "error": "source and ref are required"}, status_code=400)
        if mode not in ("head", "person", "object", "background", "custom"):
            return JSONResponse({"ok": False, "error": f"unknown mode: {mode}"}, status_code=400)
        # "face" region is served by the superior inswapper head pipeline —
        # a pasted face band can never match it for realism.
        if mode == "person" and str(body.get("region") or "full").lower() == "face":
            mode = "head"
        # تحديد «الخلفية» من وكيل الدردشة → المسار المجرب للخلفية كاملة
        # وتحديد «الرأس/الوجه/الشعر» النصي → مسار الرأس المتفوق (inswapper)
        # إلا إذا عدّل المستخدم القناع يدوياً بالماوس أو حدد مكان وضع صريحاً.
        if mode == "custom":
            _sp = body.get("refSpec") or body.get("spec") or {}
            _part = str(_sp.get("part") or "").lower() if isinstance(_sp, dict) else ""
            if _part == "background":
                mode = "background"
            elif _part in ("head", "face") and not body.get("edited") \
                    and not body.get("placeBox") and not body.get("srcMask") \
                    and not body.get("srcSpec"):
                # «الشعر» يبقى في المسار المخصص (قناع + حارس) حتى لا يبدّل
                # هوية الوجه — مسار الرأس يبدّل الوجه كاملاً وهو مطلوب فقط
                # عند اختيار «الرأس» أو «الوجه».
                mode = "head"

        scale = max(0.2, min(3.0, float(body.get("scale") or 1.0)))
        color_strength = max(0.0, min(1.0, float(body.get("colorStrength", 0.6))))
        tbox = body.get("targetBox") or None
        src_idx = _clean_index(body.get("sourceIndex"), "sourceIndex", 99) if body.get("sourceIndex") is not None else 0
        ref_idx = _clean_index(body.get("faceIndex"), "faceIndex", 99) if body.get("faceIndex") is not None else 0

        src = _load_image(src_data)
        ref = _load_image(ref_data)
        if src is None or ref is None:
            return JSONResponse({"ok": False, "error": "could not decode images"}, status_code=400)
        SH, SW = src.shape[:2]
        RH, RW = ref.shape[:2]

        # cap work size (speed) — kept high enough for quality
        def _cap(img, max_dim=1600):
            import cv2
            h, w = img.shape[:2]
            s = max_dim / max(h, w)
            if s < 1.0:
                img = cv2.resize(img, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
            return img, s

        src, s_src = _cap(src)
        ref, s_ref = _cap(ref)
        SH, SW = src.shape[:2]
        RH, RW = ref.shape[:2]

        result = None

        # ---------------- CUSTOM mode (تحديد المستخدم من وكيل الدردشة) ------
        if mode == "custom":
            import numpy as np
            import cv2
            R = _regions_mod()
            rspec = body.get("refSpec") or body.get("spec")
            rmask = None
            if body.get("refMask"):
                rmask = _load_mask_png(body["refMask"], RW, RH)
            if rmask is None and isinstance(rspec, dict) and rspec.get("part"):
                try:
                    faces_ref_c, _, _ = _detect_sorted(ref, hq=True)
                except Exception:
                    faces_ref_c = []
                try:
                    sub_ref = _subject_mask_full(ref, None)
                except Exception:
                    sub_ref = None
                rmask, _lbl = R.build_mask(ref, rspec, faces_ref_c, sub_ref)
            if rmask is None:
                return JSONResponse(
                    {"ok": False,
                     "error": "لا يوجد تحديد معتمد — حدد المكان أولاً من المساعد الذكي ثم اضغط نقل"},
                    status_code=400)
            rmask = rmask.astype(np.float32)
            ys_c, xs_c = np.where(rmask > 60)
            if len(xs_c) < 200:
                return JSONResponse({"ok": False, "error": "التحديد صغير جداً أو فارغ في صورة المرجع"}, status_code=422)
            bx1r, bx2r = int(xs_c.min()), int(xs_c.max())
            by1r, by2r = int(ys_c.min()), int(ys_c.max())
            crop_i = ref[by1r:by2r + 1, bx1r:bx2r + 1]
            crop_m = np.clip(rmask[by1r:by2r + 1, bx1r:bx2r + 1], 0, 255).astype(np.uint8)
            ch_r, cw_r = crop_m.shape[:2]

            part = str((rspec or {}).get("part") or "").lower() if isinstance(rspec, dict) else ""
            faces_src_c, faces_ref_c = [], []
            try:
                faces_ref_c, _, _ = _detect_sorted(ref, hq=True)
            except Exception:
                pass
            try:
                faces_src_c, _, _ = _detect_sorted(src, hq=True)
            except Exception:
                pass

            # ---- موضع الوضع على المصدر ----
            pbox = body.get("placeBox")
            target = None
            if isinstance(pbox, (list, tuple)) and len(pbox) >= 4:
                px_, py_, pw_, ph_ = [float(v) for v in pbox[:4]]
                target = (int(px_ * SW), int(py_ * SH),
                          max(8, int(pw_ * SW)), max(8, int(ph_ * SH)))
            elif body.get("srcMask") or (isinstance(body.get("srcSpec"), dict) and body["srcSpec"].get("part")):
                smask = None
                if body.get("srcMask"):
                    smask = _load_mask_png(body["srcMask"], SW, SH)
                if smask is None:
                    try:
                        sub_src = _subject_mask_full(src, None)
                    except Exception:
                        sub_src = None
                    smask, _ = R.build_mask(src, body["srcSpec"], faces_src_c, sub_src)
                if smask is not None:
                    ys2, xs2 = np.where(smask > 60)
                    if len(xs2) >= 100:
                        target = (int(xs2.min()), int(ys2.min()),
                                  int(xs2.max() - xs2.min() + 1), int(ys2.max() - ys2.min() + 1))
            if target is None and faces_src_c and faces_ref_c:
                # موضع نسبي لمرجع الوجه: مركز التحديد نسبةً لوجه المرجع
                # (بوحدات ارتفاع الوجه) يُطبق على وجه المصدر
                frf = faces_ref_c[min(ref_idx, len(faces_ref_c) - 1)]
                fsf = faces_src_c[min(src_idx, len(faces_src_c) - 1)]
                rx1_, ry1_, rx2_, ry2_ = _face_rect(frf)
                sx1_, sy1_, sx2_, sy2_ = _face_rect(fsf)
                rfh_ = max(4.0, float(ry2_ - ry1_))
                sfh_ = max(4.0, float(sy2_ - sy1_))
                ux = ((bx1r + bx2r) / 2.0 - (rx1_ + rx2_) / 2.0) / rfh_
                uy = ((by1r + by2r) / 2.0 - (ry1_ + ry2_) / 2.0) / rfh_
                s_r = (sfh_ / rfh_) * scale
                bw_, bh_ = max(8, int(cw_r * s_r)), max(8, int(ch_r * s_r))
                tcx = (sx1_ + sx2_) / 2.0 + ux * sfh_
                tcy = (sy1_ + sy2_) / 2.0 + uy * sfh_
                if part == "hair":
                    # الشعر ينزل أطول من الرأس في المرجع — ارفع الوضع قليلاً
                    # حتى لا يغطي جبهة المصدر (والمستخدم يضبط بالماوس على أي حال)
                    tcy -= 0.10 * bh_
                target = (int(tcx - bw_ / 2.0), int(tcy - bh_ / 2.0), bw_, bh_)
            elif target is None:
                s_r = (0.55 * SH / max(1, ch_r)) * scale
                bw_, bh_ = max(8, int(cw_r * s_r)), max(8, int(ch_r * s_r))
                if faces_src_c:
                    sx1_, sy1_, sx2_, sy2_ = _face_rect(faces_src_c[min(src_idx, len(faces_src_c) - 1)])
                    target = (int((sx1_ + sx2_) / 2 - bw_ / 2), min(SH - bh_, int(sy2_ + 0.2 * (sy2_ - sy1_))), bw_, bh_)
                else:
                    target = ((SW - bw_) // 2, (SH - bh_) // 2, bw_, bh_)

            # ---- إزالة الجزء القديم من المصدر (يمنع «صورة فوق صورة») ----
            erase = body.get("erase")
            if erase is None:
                erase = (part in R.BODY_PARTS and bool(faces_src_c) and bool(faces_ref_c))
            if erase:
                try:
                    s_subj = _subject_mask_full(src, None)
                    if s_subj is not None:
                        ex1_, ey1_ = max(0, int(target[0] - 0.10 * target[2])), max(0, int(target[1] - 0.10 * target[3]))
                        ex2_, ey2_ = min(SW, int(target[0] + 1.10 * target[2])), min(SH, int(target[1] + 1.10 * target[3]))
                        lim = np.zeros((SH, SW), np.uint8)
                        cv2.rectangle(lim, (ex1_, ey1_), (ex2_, ey2_), 255, -1)
                        em = _largest_component(cv2.bitwise_and(s_subj, lim), thresh=60)
                        if (em > 100).sum() > 500:
                            erase_m = (em > 100).astype(np.uint8) * 255
                            pe = max(3, int(0.02 * max(SH, SW)))
                            erase_m = cv2.dilate(erase_m, cv2.getStructuringElement(
                                cv2.MORPH_ELLIPSE, (pe * 2 + 1, pe * 2 + 1)))
                            src = cv2.inpaint(src, erase_m, 9, cv2.INPAINT_TELEA)
                except Exception:
                    traceback.print_exc()

            # ---- حارس الشعر: قص القناع داخل شعر المصدر نفسه ----
            # (للقناع المعدل يدوياً) حتى لا يرش الشعر المنقول على الوجه
            # أو الخلفية — نفس منطق مسار الرأس.
            guard = None
            if part == "hair" and faces_src_c:
                try:
                    core_subject = _subject_mask_full(src, None)
                    _f = faces_src_c[min(src_idx, len(faces_src_c) - 1)]
                    _fx1, _fy1, _fx2, _fy2 = _face_rect(_f)
                    _sfw, _sfh = max(4, _fx2 - _fx1), max(4, _fy2 - _fy1)
                    if core_subject is not None:
                        lim = np.zeros((SH, SW), np.uint8)
                        cv2.rectangle(lim, (max(0, int(_fx1 - 0.65 * _sfw)), max(0, int(_fy1 - 1.05 * _sfh))),
                                      (min(SW, int(_fx2 + 0.65 * _sfw)), min(SH, int(_fy1 + 0.72 * _sfh))), 255, -1)
                        dh = cv2.bitwise_and(core_subject, lim)
                        dh = _largest_component(dh, thresh=40)
                        if (dh > 110).sum() > 100:
                            pe2 = max(2, int(0.018 * _sfw))
                            dh = cv2.erode((dh > 110).astype(np.uint8) * 255,
                                           cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (pe2 * 2 + 1, pe2 * 2 + 1)))
                            guard = cv2.GaussianBlur(dh, (max(3, int(0.03 * _sfw) | 1),) * 2, 0)
                except Exception:
                    traceback.print_exc()

            result = _blend_onto(src, crop_i, crop_m, target,
                                 color_strength=color_strength, guard=guard)

        # ---------------- HEAD mode ----------------
        elif mode == "head":
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
                mo_r = (kps_r[3] + kps_r[4]) / 2.0     # ref mouth midpoint
                mo_s = (kps_s[3] + kps_s[4]) / 2.0     # src mouth midpoint
                dr = kps_r[1] - kps_r[0]               # ref eye vector (roll)
                ds = kps_s[1] - kps_s[0]               # src eye vector
                # SCALE from the eye→mouth distance: inter-eye distance
                # shrinks with head yaw (foreshortening) — a tilted reference
                # rendered the overlay ~1.2× too big ("pasted image" look).
                # eye→mouth stays stable under yaw.
                d_r = float(np.hypot(mo_r[0] - em_r[0], mo_r[1] - em_r[1]))
                d_s = float(np.hypot(mo_s[0] - em_s[0], mo_s[1] - em_s[1]))
                s_fix = d_s / max(1e-3, d_r)
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
                # FACE KILL MASK (ref coords, SOFT): the old small ellipse left
                # the temple/jaw corners of the REF FACE inside the hair mask —
                # those corners warped onto the destination as a semi-
                # transparent "ghost face" beside the new head (the user's
                # "صورة فوق صورة" bug). A grown rect kills the WHOLE face
                # (temples, cheeks, jaw, chin, neck) while hair above the
                # hairline survives. Soft edges keep the hair→face transition
                # smooth instead of a hard hole.
                fc = np.zeros((RH, RW), np.uint8)
                kx1 = max(0, int(rx1 - 0.18 * fw))
                kx2 = min(RW, int(rx2 + 0.18 * fw))
                ky1 = max(0, int(ry1 - 0.04 * fh))
                ky2 = min(RH, int(ry2 + 0.28 * fh))
                cv2.rectangle(fc, (kx1, ky1), (kx2, ky2), 255, -1)
                fk = max(3, (int(0.12 * fw)) | 1)
                fc = cv2.GaussianBlur(fc, (fk, fk), 0)
                hm = None
                ref_subject = _subject_mask_full(ref, None)   # rembg (cached)
                if ref_subject is not None:
                    lim = np.zeros((RH, RW), np.uint8)
                    cv2.rectangle(lim, (gx1, gy1), (gx2, gy2), 255, -1)
                    cand = cv2.bitwise_and(ref_subject, lim)
                    # hard binarization (>100) drops the uncertain low-alpha
                    # halo rembg leaves around close-up subjects — that halo
                    # carries ref background into the blend as a bright haze
                    cand = _largest_component(cand, thresh=100)
                    cand = (cand.astype(np.float32) *
                            (1.0 - fc.astype(np.float32) / 255.0)).astype(np.uint8)
                    if (cand > 100).sum() >= 0.004 * RH * RW:
                        k = max(3, (int(0.02 * max(RH, RW))) | 1)
                        hm = cv2.GaussianBlur(cand, (k, k), 0)
                if hm is None:
                    # fallback: GrabCut on the hair band, minus the face core
                    hm = _head_mask_grabcut(ref, (gx1, gy1, gx2 - gx1, gy2 - gy1))
                    hm = (hm.astype(np.float32) *
                          (1.0 - fc.astype(np.float32) / 255.0)).astype(np.uint8)

                if hm is not None and (hm > 100).sum() >= 0.003 * RH * RW:
                    # DESTINATION HAIR ZONE: rembg on the ALREADY-SWAPPED core
                    # ∩ head band. The transplant may only modify pixels where
                    # the SOURCE person already has hair — it changes color and
                    # texture there but can never draw a foreign hair
                    # silhouette over the background (the "wig outline" look).
                    dh = None
                    try:
                        core_subject = _subject_mask_full(core, None)
                        sfx1, sfy1, sfx2, sfy2 = _face_rect(fs)
                        sfw2, sfh2 = max(4, sfx2 - sfx1), max(4, sfy2 - sfy1)
                        if core_subject is not None:
                            dl1 = np.zeros((SH, SW), np.uint8)
                            dx1 = max(0, int(sfx1 - 0.65 * sfw2))
                            dy1 = max(0, int(sfy1 - 1.05 * sfh2))
                            dx2 = min(SW, int(sfx2 + 0.65 * sfw2))
                            dy2 = min(SH, int(sfy1 + 0.72 * sfh2))
                            cv2.rectangle(dl1, (dx1, dy1), (dx2, dy2), 255, -1)
                            dh = cv2.bitwise_and(core_subject, dl1)
                            dh = _largest_component(dh, thresh=40)
                            if (dh > 110).sum() > 100:
                                # NO dilate + slight ERODE: rembg leaves a
                                # soft low-alpha halo AROUND the head — a
                                # dilated halo let the overlay paint hair
                                # color over the BACKGROUND above the head
                                # (the pale translucent veil bug).
                                pe2 = max(2, int(0.018 * sfw2))
                                dh = cv2.erode((dh > 110).astype(np.uint8) * 255,
                                               cv2.getStructuringElement(
                                                   cv2.MORPH_ELLIPSE, (pe2 * 2 + 1, pe2 * 2 + 1)))
                                dh = cv2.GaussianBlur(dh, (max(3, int(0.03 * sfw2) | 1),) * 2, 0)
                            else:
                                dh = None
                    except Exception:
                        traceback.print_exc()
                        dh = None

                    hm_w = cv2.warpAffine(hm, M, (SW, SH), flags=cv2.INTER_LINEAR)
                    # NO dilation: dilating the warped silhouette drags REF
                    # BACKGROUND pixels inside the mask → a dark "wig rim".
                    # Erode slightly instead so the mask stays INSIDE the
                    # hair, then a narrow feather.
                    er = max(1, int(0.012 * fw))
                    hm_w = cv2.erode(hm_w, cv2.getStructuringElement(
                        cv2.MORPH_ELLIPSE, (er * 2 + 1, er * 2 + 1)))
                    hm_w = cv2.GaussianBlur(hm_w, (max(3, int(0.04 * fw) | 1),) * 2, 0)
                    # DESTINATION-SIDE protection: kill the transformed ref
                    # face zone in destination coords as well — the inswapper
                    # face core must never receive ref pixels (double face).
                    fc_w = cv2.warpAffine(fc, M, (SW, SH), flags=cv2.INTER_LINEAR)
                    hm_w = (hm_w.astype(np.float32) *
                            (1.0 - fc_w.astype(np.float32) / 255.0)).astype(np.uint8)

                    # DRASTIC-HAIRSTYLE GUARD: a reference hairstyle much
                    # BIGGER than the destination hair zone would paint a
                    # foreign silhouette over the background no matter how
                    # soft the blend is. In that case keep the destination
                    # hair and transfer the identity only (face core) —
                    # that always reads as one natural photo.
                    a_ref = int((hm_w > 110).sum())
                    a_dst = int((dh > 110).sum()) if dh is not None else a_ref
                    # BOTH bounds matter for the "one whole image" look:
                    #  • a_ref > 1.6*a_dst → a foreign silhouette over the
                    #    background ("wig dropped on top")
                    #  • a_ref < 0.55*a_dst → a PATCH inside the destination
                    #    hair — a partial hairstyle of a different color sits
                    #    visibly inside the existing hair ("piece pasted on
                    #    the head"). In both cases the core swap alone reads
                    #    as one natural photo.
                    if 0.55 * max(a_dst, 1) <= a_ref <= 1.6 * max(a_dst, 1):
                        if dh is not None:
                            # arithmetic clip to the eroded destination hair
                            # zone (bitwise_and on soft masks produced
                            # phantom mid-alpha values above the head)
                            hm_w = (hm_w.astype(np.float32) *
                                    (dh.astype(np.float32) / 255.0)).astype(np.uint8)
                        ys, xs = np.where(hm_w > 110)
                        if len(xs) > 80:
                            bx1, bx2 = int(xs.min()), int(xs.max())
                            by1, by2 = int(ys.min()), int(ys.max())
                            sub_mask = hm_w[by1:by2 + 1, bx1:bx2 + 1]
                            # island case (destination hair zone larger than
                            # the transplanted hair): use a WIDE feather so
                            # the transplant fades gradually into the
                            # destination hair instead of sitting as a patch
                            k = max(3, int((0.10 if a_dst > a_ref else 0.06) * (bx2 - bx1)) | 1)
                            sub_mask = cv2.GaussianBlur(sub_mask, (k, k), 0)
                            # re-anchor to the CORE of the mask: after the
                            # wide feather the outer 30% is translucent mist;
                            # blending from the mist is what painted the veil
                            sub_mask = np.clip(sub_mask.astype(np.float32) * 1.6 - 60, 0, 255).astype(np.uint8)
                            warped = cv2.warpAffine(ref, M, (SW, SH), flags=cv2.INTER_LANCZOS4,
                                                    borderMode=cv2.BORDER_CONSTANT,
                                                    borderValue=(0, 0, 0))
                            cut = warped[by1:by2 + 1, bx1:bx2 + 1]
                            # HAIR-ANCHORED harmonization: match the
                            # transplanted hair to the DESTINATION'S OWN HAIR
                            # pixels (color + lighting) — NOT to the
                            # background ring. Ring-matching turned the hair
                            # into a translucent beige veil; hair-anchored
                            # matching makes it read as the same photo while
                            # keeping the hair's own hue (لون الشعر يتعدل
                            # ليتوافق مع المشهد دون شحوب).
                            try:
                                ctx_img = core[by1:by2 + 1, bx1:bx2 + 1]
                                sel = sub_mask > 120
                                if body.get("debug"):
                                    print(f"[TPDBG] ctx {ctx_img.shape} sub {sub_mask.shape} "
                                          f"selpx {int(sel.sum())} cutmean "
                                          f"{cut[sel].mean(0).round(1) if sel.sum() else None}",
                                          flush=True)
                                if int(sel.sum()) > 300:
                                    cut = _match_color_to_pixels(
                                        cut, sel, ctx_img[sel], strength=0.55)
                                    if body.get("debug"):
                                        print(f"[TPDBG] matched cutmean {cut[sel].mean(0).round(1)}",
                                              flush=True)
                            except Exception:
                                traceback.print_exc()
                            if body.get("debug"):
                                try:
                                    cv2.imwrite("/tmp/dbg_hm_w.png", hm_w)
                                    if dh is not None:
                                        cv2.imwrite("/tmp/dbg_dh.png", dh)
                                    cv2.imwrite("/tmp/dbg_submask.png", sub_mask)
                                    cv2.imwrite("/tmp/dbg_cut.png", cut)
                                    cv2.imwrite("/tmp/dbg_core.png", core)
                                except Exception:
                                    pass
                            # tight pad + fewer pyramid levels: the wide
                            # low-frequency bleed painted a pale halo of hair
                            # color over the BACKGROUND above the head.
                            # color_strength=0: the hair-anchored match above
                            # already set the right color; the RING match
                            # (beige background) re-lightened the dark hair
                            # into the pale translucent veil.
                            result = _blend_onto(core, cut, sub_mask,
                                                 (bx1, by1, bx2 - bx1 + 1, by2 - by1 + 1),
                                                 color_strength=0.0,
                                                 pad_frac=0.25, levels=3)
            except Exception:
                traceback.print_exc()   # hair overlay is best-effort; core swap already good

        # ---------------- PERSON mode ----------------
        elif mode == "person":
            import numpy as np
            import cv2
            # reference subject: face-guided GrabCut when a face exists
            try:
                _ensure_loaded()
                faces_ref, _, _ = _detect_sorted(ref, hq=True)
            except Exception:
                faces_ref = []
            rect = None
            if faces_ref:
                fx1, fy1, fx2, fy2 = _face_rect(faces_ref[min(ref_idx, len(faces_ref) - 1)])
                fw, fh = fx2 - fx1, fy2 - fy1
                rx = max(0, int(fx1 - 2.0 * fw))
                ry = max(0, int(fy1 - 0.8 * fh))
                rect = (rx, ry,
                        max(24, min(RW - rx - 1, int(5.0 * fw))),
                        max(24, min(RH - ry - 1, int(7.0 * fh))))
            cut, cm = _extract_subject(ref, rect=rect)
            if cut is None:
                return JSONResponse({"ok": False, "error": "تعذر استخراج الجسم من الصورة المرجعية"}, status_code=422)
            ch, cw = cut.shape[:2]

            # ---- REGION mode (ذراعين/صدر/جذع/رجلين/شعر/وجه) ----
            # Crop the subject to a proportional band anchored on the
            # reference face, then paste it at the SAME proportional spot on
            # the source person (auto-registered by face height).
            region = str(body.get("region") or "full").lower()
            # source faces are needed by BOTH the region and full paths
            try:
                faces_src, _, _ = _detect_sorted(src, hq=True)
            except Exception:
                faces_src = []
            if region != "full":
                REGION_BANDS = {
                    "hair": (-0.85, 0.30),
                    "face": (-0.15, 1.40),
                    # body regions start BELOW the chin (1.0×face-height):
                    # a crop that includes the reference face pasted over the
                    # source face IS the "double face / image over image" bug
                    "chest": (1.02, 1.85),
                    "torso": (1.02, 2.60),
                    "arms": (1.02, 2.35),
                    "legs": (2.10, 9.00),
                }  # (top_rel, bottom_rel) × face-height, from ref face TOP
                if region not in REGION_BANDS:
                    return JSONResponse({"ok": False, "error": f"منطقة غير مدعومة: {region}"}, status_code=400)
                if not faces_ref:
                    return JSONResponse({"ok": False, "error": "تحديد المنطقة يحتاج وجهاً واضحاً في صورة المرجع"}, status_code=422)
                top_rel, bot_rel = REGION_BANDS[region]
                fx1r, fy1r, fx2r, fy2r = _face_rect(faces_ref[min(ref_idx, len(faces_ref) - 1)])
                rfh_r = max(4, fy2r - fy1r)
                band_top = max(0, int(fy1r + top_rel * rfh_r))
                band_bot = min(RH, int(fy1r + bot_rel * rfh_r))
                if band_bot - band_top < 8:
                    return JSONResponse({"ok": False, "error": "منطقة النقل خارج حدود صورة المرجع"}, status_code=422)
                m_full = _subject_mask_full(ref, rect)  # full-size subject mask
                # soft-ramped band: top/bottom edges fade over ~18% of the
                # band height so the transplant never shows a hard straight
                # cut line across the subject
                band = np.zeros((RH, RW), np.uint8)
                band[band_top:band_bot, :] = 255
                ramp = max(2, int(0.18 * (band_bot - band_top)))
                for i in range(ramp):
                    wgt = int(255 * (i + 1) / (ramp + 1))
                    if band_top + i < RH:
                        band[band_top + i, :] = np.minimum(band[band_top + i, :], wgt)
                    j = band_bot - 1 - i
                    if 0 <= j < RH:
                        band[j, :] = np.minimum(band[j, :], wgt)
                region_mask = cv2.multiply(m_full, band, scale=1.0 / 255.0)
                if region == "hair" and faces_ref:
                    # keep the REF FACE out of the hair crop — otherwise the
                    # ref's forehead/eyes land on the source face (double face)
                    hfx1, hfy1, hfx2, hfy2 = _face_rect(faces_ref[min(ref_idx, len(faces_ref) - 1)])
                    hfw, hfh2 = max(4, hfx2 - hfx1), max(4, hfy2 - hfy1)
                    killf = np.zeros((RH, RW), np.uint8)
                    cv2.rectangle(killf,
                                  (max(0, int(hfx1 - 0.10 * hfw)), max(0, int(hfy1 - 0.02 * hfh2))),
                                  (min(RW, int(hfx2 + 0.10 * hfw)), min(RH, int(hfy2 + 0.10 * hfh2))),
                                  255, -1)
                    region_mask = (region_mask.astype(np.float32) *
                                   (1.0 - killf.astype(np.float32) / 255.0)).astype(np.uint8)
                ys_r, xs_r = np.where(region_mask > 100)
                if len(xs_r) < 200:
                    return JSONResponse({"ok": False, "error": "لم يتم العثور على المنطقة المطلوبة في صورة المرجع"}, status_code=422)
                bx1r, bx2r = int(xs_r.min()), int(xs_r.max())
                by1r, by2r = int(ys_r.min()), int(ys_r.max())
                crop_m = region_mask[by1r:by2r + 1, bx1r:bx2r + 1]
                crop_i = ref[by1r:by2r + 1, bx1r:bx2r + 1]
                ch_r, cw_r = crop_m.shape[:2]
                if faces_src:
                    sxc1, syc1, sxc2, syc2 = _face_rect(faces_src[min(src_idx, len(faces_src) - 1)])
                    sfh_r = max(4, syc2 - syc1)
                    s_r = (sfh_r / rfh_r) * scale
                    bw, bh = int(cw_r * s_r), int(ch_r * s_r)
                    bx = int((sxc1 + sxc2) / 2 - bw / 2)
                    by = int(syc1 + (by1r - fy1r) / rfh_r * sfh_r)
                else:
                    s_r = (0.60 * SH / ch_r) * scale
                    bw, bh = int(cw_r * s_r), int(ch_r * s_r)
                    bx, by = (SW - bw) // 2, (SH - bh) // 2
                if tbox:
                    bx, by = int(tbox["x"] * SW), int(tbox["y"] * SH)
                    bw, bh = int(tbox["w"] * SW), int(tbox["h"] * SH)
                # ERASE the source's own corresponding region first: the old
                # limbs/torso are inpainted away so they can never peek around
                # the transplant (the "image pasted over image" look).
                # hair/face excluded: erasing near the head risks eating the
                # source face; the pasted band covers those areas anyway.
                if region not in ("face", "hair"):
                    try:
                        s_subj = _subject_mask_full(src, None)
                        if s_subj is not None and faces_src:
                            _f = faces_src[min(src_idx, len(faces_src) - 1)]
                            _fx1, _fy1, _fx2, _fy2 = _face_rect(_f)
                            _sfh = max(4, _fy2 - _fy1)
                            e_t = max(0, int(_fy1 + max(top_rel, 0.95) * _sfh))
                            e_b = min(SH, int(_fy1 + bot_rel * _sfh + 0.15 * _sfh))
                            if e_b - e_t > 8:
                                eb = np.zeros((SH, SW), np.uint8)
                                eb[e_t:e_b, :] = 255
                                em = _largest_component(cv2.bitwise_and(s_subj, eb), thresh=60)
                                if (em > 100).sum() > 500:
                                    erase = (em > 100).astype(np.uint8) * 255
                                    pe = max(3, int(0.02 * max(SH, SW)))
                                    erase = cv2.dilate(erase, cv2.getStructuringElement(
                                        cv2.MORPH_ELLIPSE, (pe * 2 + 1, pe * 2 + 1)))
                                    src = cv2.inpaint(src, erase, 9, cv2.INPAINT_TELEA)
                    except Exception:
                        traceback.print_exc()
                result = _blend_onto(src, crop_i, crop_m, (bx, by, bw, bh), color_strength=color_strength)
                if s_src < 1.0:
                    result = cv2.resize(result, (int(SW / s_src), int(SH / s_src)), interpolation=cv2.INTER_LANCZOS4)
                return {"ok": True, "result": _encode_png(result), "mode": mode, "region": region}

            # target: source person (face-guided) or default placement
            if faces_src and faces_ref and _swapper_ready():
                # ============================================================
                # v4 — WHOLE-BODY transplant via the PROVEN HEAD PIPELINE.
                # The old erase+paste produced "صورة فوق صورة" (a separate
                # person pasted over the scene). The head mode fixed the same
                # bug with two steps, and we reuse EXACTLY the same method:
                #   STEP 1 — identity core: inswapper renders the reference
                #            identity INTO the source scene (paste_back=True)
                #            → skin/lighting continuity by design, no pasted
                #            rectangle, no ghost face.
                #   STEP 2 — body transfer constrained to the DESTINATION
                #            silhouette: the reference body (clothing/texture,
                #            below the chin) is blended ONLY where the source
                #            person already has a body (rembg subject ∩
                #            below-chin band, soft-ramped). It changes what
                #            the source person wears / their body texture but
                #            can NEVER draw a foreign silhouette over the
                #            background — the "pasted person" look becomes
                #            impossible. Color/lighting/grain harmonized and
                #            Laplacian-pyramid blended by _blend_onto.
                # ============================================================
                import numpy as np
                import cv2
                _ensure_loaded()
                fs_p = faces_src[min(src_idx, len(faces_src) - 1)]
                fr_p = faces_ref[min(ref_idx, len(faces_ref) - 1)]

                # ---- STEP 1: seamless identity core (same as head STEP 1) --
                before = src
                core = SWAPPER.get(src, fs_p, fr_p, paste_back=True)
                try:
                    b = np.asarray(fs_p.bbox).flatten()
                    core = _enhance_face(core, before,
                                         (int(b[0]), int(b[1]), int(b[2]), int(b[3])))
                except Exception:
                    pass

                sx1, sy1, sx2, sy2 = _face_rect(fs_p)
                rfx1, rfy1, rfx2, rfy2 = _face_rect(fr_p)
                sfw, sfh = max(4, sx2 - sx1), max(4, sy2 - sy1)
                rfw, rfh = max(4, rfx2 - rfx1), max(4, rfy2 - rfy1)

                # ---- STEP 2a: REF body crop (below the chin, face killed) --
                ref_subject = _subject_mask_full(ref, None)
                if ref_subject is None:
                    result = core   # rembg unavailable → identity core only
                else:
                    band_r = np.zeros((RH, RW), np.uint8)
                    band_r[max(0, int(rfy2 - 0.10 * rfh)):, :] = 255
                    rb = cv2.bitwise_and(ref_subject, band_r)
                    # kill the WHOLE ref face (+ small neck margin) exactly
                    # like the head pipeline's face-kill — the inswapper core
                    # already carries the identity; ref skin here would be a
                    # double face.
                    fc = np.zeros((RH, RW), np.uint8)
                    kx1 = max(0, int(rfx1 - 0.18 * rfw))
                    kx2 = min(RW, int(rfx2 + 0.18 * rfw))
                    ky1 = max(0, int(rfy1 - 0.04 * rfh))
                    ky2 = min(RH, int(rfy2 + 0.15 * rfh))
                    cv2.rectangle(fc, (kx1, ky1), (kx2, ky2), 255, -1)
                    fk = max(3, (int(0.12 * rfw)) | 1)
                    fc = cv2.GaussianBlur(fc, (fk, fk), 0)
                    rb = (rb.astype(np.float32) *
                          (1.0 - fc.astype(np.float32) / 255.0)).astype(np.uint8)
                    rb = _largest_component(rb, thresh=100)
                    ys_r, xs_r = np.where(rb > 100)
                    if len(xs_r) < 500:
                        result = core   # no usable ref body → identity only
                    else:
                        bx1r, bx2r = int(xs_r.min()), int(xs_r.max())
                        by1r, by2r = int(ys_r.min()), int(ys_r.max())
                        crop_i = ref[by1r:by2r + 1, bx1r:bx2r + 1]
                        crop_m = np.clip(rb[by1r:by2r + 1, bx1r:bx2r + 1],
                                         0, 255).astype(np.uint8)
                        cw_r, ch_r = crop_m.shape[:2]

                        # ---- STEP 2b: placement — chin-anchored alignment ----
                        s = (sfh / rfh) * scale
                        bw, bh = int(cw_r * s), int(ch_r * s)
                        rcx = (rfx1 + rfx2) / 2.0
                        rcy = float(rfy2)
                        ccx = rcx - bx1r
                        ccy = rcy - by1r
                        scx = (sx1 + sx2) / 2.0
                        scy = float(sy2)
                        bx = int(scx - ccx * s)
                        by = int(scy - ccy * s)
                        if tbox:
                            bx, by = int(tbox["x"] * SW), int(tbox["y"] * SH)
                            bw, bh = int(tbox["w"] * SW), int(tbox["h"] * SH)

                        # ---- STEP 2c: DESTINATION body zone (the GUARD) ----
                        # the blend may only paint where the (already
                        # swapped) source person has a body below the chin —
                        # identical to the head pipeline's destination-hair
                        # zone, applied to the whole body.
                        guard = None
                        try:
                            dst_subject = _subject_mask_full(core, None)
                            if dst_subject is not None:
                                band_d = np.zeros((SH, SW), np.uint8)
                                top_d = max(0, int(sy2 - 0.10 * sfh))
                                band_d[top_d:, :] = 255
                                g = cv2.bitwise_and(dst_subject, band_d)
                                g = _largest_component(g, thresh=60)
                                if (g > 100).sum() > 500:
                                    # soft ramp below the chin: the face→
                                    # body transition fades over ~0.5×face
                                    # height so no collar line is visible
                                    ramp_h = max(4, int(0.50 * sfh))
                                    ramp = np.ones((SH, SW), np.float32)
                                    for i in range(ramp_h):
                                        wgt = (i + 1) / (ramp_h + 1)
                                        row = min(SH - 1, top_d + i)
                                        ramp[row, :] = np.minimum(ramp[row, :], wgt)
                                    pe = max(2, int(0.02 * max(SH, SW)))
                                    g = cv2.erode((g > 100).astype(np.uint8) * 255,
                                                  cv2.getStructuringElement(
                                                      cv2.MORPH_ELLIPSE,
                                                      (pe * 2 + 1, pe * 2 + 1)))
                                    k = max(3, (int(0.04 * max(SH, SW))) | 1)
                                    g = cv2.GaussianBlur(g, (k, k), 0)
                                    g = (g.astype(np.float32) * ramp).astype(np.uint8)
                                    guard = g
                        except Exception:
                            traceback.print_exc()
                            guard = None

                        # ---- STEP 2d: harmonized pyramid blend (the SAME
                        # _blend_onto the head pipeline uses), guard-clipped.
                        result = _blend_onto(core, crop_i, crop_m,
                                             (bx, by, bw, bh),
                                             color_strength=color_strength,
                                             guard=guard)

            else:
                # FALLBACK (no faces / model loading): the legacy erase+paste
                # pipeline — kept so the feature never hard-fails.
                if faces_src:
                    sx1, sy1, sx2, sy2 = _face_rect(faces_src[min(src_idx, len(faces_src) - 1)])
                    sfw, sfh = sx2 - sx1, sy2 - sy1
                    # map: ref face height → src face height (auto resize)
                    if faces_ref:
                        rfx1, rfy1, rfx2, rfy2 = _face_rect(faces_ref[min(ref_idx, len(faces_ref) - 1)])
                        rfh = max(4, rfy2 - rfy1)
                    else:
                        rfh = max(4, ch * 0.16)
                    s = (sfh / rfh) * scale
                    bw, bh = int(cw * s), int(ch * s)
                    # anchor: center the new body on the source face, feet lower
                    bx = int((sx1 + sx2) / 2 - bw / 2)
                    by = int(sy1 - 0.55 * sfh - (ch * s) * 0.12)
                else:
                    s = (0.85 * SH / ch) * scale
                    bw, bh = int(cw * s), int(ch * s)
                    bx, by = (SW - bw) // 2, max(0, SH - bh)
                if tbox:
                    bx, by = int(tbox["x"] * SW), int(tbox["y"] * SH)
                    bw, bh = int(tbox["w"] * SW), int(tbox["h"] * SH)
                # ERASE the source person first (inpaint): the new person then
                # stands in a CLEAN scene — no old face/limbs peeking around the
                # transplanted body ("image over image" becomes impossible).
                try:
                    s_subj = _subject_mask_full(src, None)
                    if s_subj is not None:
                        erase = (s_subj > 100).astype(np.uint8) * 255
                        pe = max(3, int(0.02 * max(SH, SW)))
                        erase = cv2.dilate(erase, cv2.getStructuringElement(
                            cv2.MORPH_ELLIPSE, (pe * 2 + 1, pe * 2 + 1)))
                        src = cv2.inpaint(src, erase, 9, cv2.INPAINT_TELEA)
                except Exception:
                    traceback.print_exc()
                result = _blend_onto(src, cut, cm, (bx, by, bw, bh), color_strength=color_strength)

        # ---------------- OBJECT / ANIMAL mode ----------------
        elif mode == "object":
            cut, cm = _extract_subject(ref, rect=None)
            if cut is None:
                return JSONResponse({"ok": False, "error": "تعذر استخراج الكائن من الصورة المرجعية"}, status_code=422)
            ch, cw = cut.shape[:2]
            if tbox:
                bx, by = int(tbox["x"] * SW), int(tbox["y"] * SH)
                bw, bh = int(tbox["w"] * SW), int(tbox["h"] * SH)
            else:
                s = (0.55 * SH / ch) * scale
                bw, bh = int(cw * s), int(ch * s)
                bx, by = (SW - bw) // 2, (SH - bh) // 2
            result = _blend_onto(src, cut, cm, (bx, by, bw, bh), color_strength=color_strength * 0.7)

        # ---------------- BACKGROUND mode ----------------
        else:
            # keep the SOURCE person, put them on the REFERENCE background
            import numpy as np
            import cv2
            try:
                _ensure_loaded()
                faces_src, _, _ = _detect_sorted(src, hq=True)
            except Exception:
                faces_src = []
            rect = None
            if faces_src:
                fx1, fy1, fx2, fy2 = _face_rect(faces_src[min(src_idx, len(faces_src) - 1)])
                fw, fh = fx2 - fx1, fy2 - fy1
                rx = max(0, int(fx1 - 2.0 * fw))
                ry = max(0, int(fy1 - 0.8 * fh))
                rect = (rx, ry,
                        max(24, min(SW - rx - 1, int(5.0 * fw))),
                        max(24, min(SH - ry - 1, int(7.0 * fh))))
            cut, cm = _extract_subject(src, rect=rect)
            if cut is None:
                return JSONResponse({"ok": False, "error": "تعذر استخراج الشخص من الصورة المصدر"}, status_code=422)
            ch, cw = cut.shape[:2]
            try:
                faces_ref, _, _ = _detect_sorted(ref, hq=True)
            except Exception:
                faces_ref = []
            if faces_ref:
                rx1, ry1, rx2, ry2 = _face_rect(faces_ref[0])
                s = ((ry2 - ry1) / max(4.0, ch * 0.16)) * scale
                bw, bh = int(cw * s), int(ch * s)
                bx = int((rx1 + rx2) / 2 - bw / 2)
                by = int(ry1 - 0.55 * (ry2 - ry1))
            else:
                s = (0.85 * RH / ch) * scale
                bw, bh = int(cw * s), int(ch * s)
                bx, by = (RW - bw) // 2, max(0, RH - bh)
            if tbox:
                bx, by = int(tbox["x"] * RW), int(tbox["y"] * RH)
                bw, bh = int(tbox["w"] * RW), int(tbox["h"] * RH)
            result = _blend_onto(ref, cut, cm, (bx, by, bw, bh), color_strength=color_strength)

        # restore original output size when we downscaled for processing
        if s_src < 1.0 and mode != "background":
            import cv2
            result = cv2.resize(result, (int(SW / s_src), int(SH / s_src)), interpolation=cv2.INTER_LANCZOS4)
        elif mode == "background" and s_ref < 1.0:
            import cv2
            result = cv2.resize(result, (int(RW / s_ref), int(RH / s_ref)), interpolation=cv2.INTER_LANCZOS4)

        return {"ok": True, "result": _encode_png(result), "mode": mode}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


if __name__ == "__main__":
    import uvicorn

    # SELF-HEAL: fetch any missing model in the background so a fresh
    # session / Codespace recovers on its own (no manual restore-models.sh).
    _kick_self_heal()
    uvicorn.run(app, host="0.0.0.0", port=3030, log_level="info")
