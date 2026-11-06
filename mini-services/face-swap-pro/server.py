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


def _match_color_laba(region_ref, region_tgt, strength=0.55, mask=None):
    """Per-channel LAB mean/std transfer: shift region_tgt toward region_ref.

    region_ref = the SAME area BEFORE the swap (carries the scene's lighting
    on skin); region_tgt = after the swap. std ratio is capped to avoid
    halos. strength<1 keeps some of the new face's own color character.
    mask (optional): uint8 0/255, same size as the regions — when given the
    statistics come ONLY from that area (e.g. an inner skin ellipse) so
    hair/background pixels cannot bias the transfer.
    """
    import numpy as np
    import cv2
    a = cv2.cvtColor(region_ref, cv2.COLOR_BGR2LAB).astype(np.float32)
    b = cv2.cvtColor(region_tgt, cv2.COLOR_BGR2LAB).astype(np.float32)
    out = b.copy()
    sel = (mask > 127) if mask is not None else None
    for c in range(3):
        if sel is not None and int(sel.sum()) > 50:
            ma, sa = float(a[..., c][sel].mean()), float(a[..., c][sel].std()) + 1e-6
            mb, sb = float(b[..., c][sel].mean()), float(b[..., c][sel].std()) + 1e-6
        else:
            ma, sa = float(a[..., c].mean()), float(a[..., c].std()) + 1e-6
            mb, sb = float(b[..., c].mean()), float(b[..., c].std()) + 1e-6
        ratio = min(sb / sa, 1.25)  # cap: never blow contrast past 1.25x
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
    before : the SAME image BEFORE this swap (reference for scene color).
             MUST be a true pre-swap COPY — inswapper paste_back mutates
             the array in place, so passing the same object makes the
             transfer compare the face with itself (a no-op).
    bbox_px: (x1, y1, x2, y2) pixel bbox of the swapped face

    v2 — fixes the 'grainy dark ghost' look on strong scene-mismatch:
      • LAB stats from an inner SKIN ellipse — hair/background no longer
        bias the transfer
      • gentler strength (0.35) + luminance-gap damping — a pale face on
        a dark scene shifts smoothly instead of turning muddy
      • bilateral denoise BEFORE a mild unsharp — the 128px model's
        upscale grain is smoothed, not amplified
    """
    import numpy as np
    import cv2
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
    # inner skin ellipse for the statistics (~58% of the region)
    skin = np.zeros(tgt.shape[:2], np.uint8)
    cv2.ellipse(
        skin,
        (tgt.shape[1] // 2, tgt.shape[0] // 2),
        (max(2, int(tgt.shape[1] * 0.29)), max(2, int(tgt.shape[0] * 0.29))),
        0, 0, 360, 255, -1,
    )
    strength = 0.30
    try:
        lr = cv2.cvtColor(ref, cv2.COLOR_BGR2LAB)[..., 0]
        lt = cv2.cvtColor(tgt, cv2.COLOR_BGR2LAB)[..., 0]
        gap = abs(float(lr[skin > 127].mean()) - float(lt[skin > 127].mean()))
        if gap > 25:
            strength *= 0.5   # big exposure mismatch — damp the shift hard
    except Exception:
        pass
    adj = _match_color_laba(ref, tgt, strength=strength, mask=skin)
    try:
        adj = cv2.bilateralFilter(adj, 5, 40, 5)   # kill upscale grain
    except Exception:
        pass
    adj = _unsharp(adj, amount=0.22, radius=1.6)   # mild crispness only
    # CLAMP the luminance shift: the swap must keep the new identity's own
    # natural exposure — matching a pale face to a dark scene (or the
    # reverse) never helps; the paste-back already carries scene light.
    try:
        shifted = cv2.cvtColor(adj, cv2.COLOR_BGR2LAB)[..., 0].astype(np.float32)
        orig = cv2.cvtColor(tgt, cv2.COLOR_BGR2LAB)[..., 0].astype(np.float32)
        dl = np.clip(shifted - orig, -14.0, 14.0)
        lab = cv2.cvtColor(adj, cv2.COLOR_BGR2LAB).astype(np.float32)
        lab[..., 0] = np.clip(orig + dl, 0, 255)
        adj = cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2BGR)
    except Exception:
        pass
    # INNER-face feather mask (0.62 of the bbox): the old 0.90 covered hair
    # and background around the face and painted a dark veil over them.
    m = _feather_mask(adj.shape[1], adj.shape[0], feather=feather, shrink=0.62)
    a = (m.astype(np.float32) / 255.0)[..., None]
    blended = tgt.astype(np.float32) * (1 - a) + adj.astype(np.float32) * a
    result[ey1:ey2, ex1:ex2] = np.clip(blended, 0, 255).astype(np.uint8)
    return result


def _swap_with_strength(result, tgt_face, id_face, max_extra=2):
    """inswapper swap with a MANDATORY strengthening pass.

    inswapper_128 sometimes renders the requested identity only WEAKLY —
    a semi-transparent ghost of the original face stays visible (seen
    when the target/source scene gap is big: dark↔bright, heavy beard,
    strong expression). The nasty part: the ghost's embedding is already
    VERY close to the requested identity (0.81 vs 0.06 measured), so an
    embedding check alone can NOT tell a ghost from a full render.

    Fix (verified visually on both directions): ALWAYS apply a second
    pass — pass 2 turns the ghost into a full render, and on an already
    clean swap it merely re-renders the same identity (no harm). A third
    pass runs only when the embedding still leans toward the original
    face. Returns the strengthened image.
    """
    import numpy as np
    out = SWAPPER.get(result, tgt_face, id_face, paste_back=True)
    try:
        e_id = np.asarray(id_face.normed_embedding, dtype=np.float32).flatten()
        e_tgt = np.asarray(tgt_face.normed_embedding, dtype=np.float32).flatten()
        bx = np.asarray(tgt_face.bbox).flatten()
        for attempt in range(max_extra):
            res_faces, _, _ = _detect_sorted(out, hq=True)
            if not res_faces:
                break
            best = min(
                res_faces,
                key=lambda f: abs(f.bbox[0] - bx[0]) + abs(f.bbox[1] - bx[1]),
            )
            e_res = np.asarray(best.normed_embedding, dtype=np.float32).flatten()
            s_id = float(np.dot(e_res, e_id))
            s_tgt = float(np.dot(e_res, e_tgt))
            print(f"[SWAPGUARD] attempt={attempt} s_identity={s_id:.3f} s_target={s_tgt:.3f}", flush=True)
            # pass 2 is MANDATORY (ghost fix); pass 3 only when the face
            # still leans toward the ORIGINAL identity
            if attempt > 0 and s_id >= s_tgt:
                break
            out = SWAPPER.get(out, best, id_face, paste_back=True)
            print("[SWAPGUARD] strengthening pass applied", flush=True)
    except Exception:
        traceback.print_exc()
    return out


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
            # TRUE pre-swap snapshot: paste_back mutates the array in place,
            # so without .copy() the color reference would equal the result
            # and the enhancement pass would compare the face with itself.
            before = result.copy()
            result = _swap_with_strength(
                result,
                src_faces[m["sourceIndex"]],
                face_faces[m["faceIndex"]],
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


def _match_light_ramp(cut, ref_region, mask, strength=0.6):
    """Match the LIGHT DIRECTION: apply the reference region's luminance
    gradient (a linear L-plane fit) to the cutout.

    Color statistics alone can not align SHADOWS — a chest transplanted
    from a flat-lit photo into a side-lit photo keeps its own flat shading
    and reads as a separate image. Fitting a plane to the destination's L
    and adding the same (damped, zero-mean) ramp transfers the light
    direction feel onto the transplant.
    """
    import numpy as np
    import cv2
    try:
        if cut.size == 0 or ref_region.size == 0 or mask is None or mask.max() < 10:
            return cut
        if ref_region.shape[:2] != cut.shape[:2]:
            ref_region = cv2.resize(ref_region, (cut.shape[1], cut.shape[0]))
        if mask.shape[:2] != cut.shape[:2]:
            mask = cv2.resize(mask, (cut.shape[1], cut.shape[0]))
        rl = cv2.cvtColor(ref_region, cv2.COLOR_BGR2LAB)[..., 0].astype(np.float32)
        msel = mask > 100
        if int(msel.sum()) < 200:
            return cut
        ys, xs = np.where(msel)
        A = np.stack([np.ones_like(xs, np.float32),
                      xs.astype(np.float32), ys.astype(np.float32)], axis=1)
        b = rl[msel]
        sol, *_ = np.linalg.lstsq(A, b, rcond=None)
        h, w = cut.shape[:2]
        gx, gy = np.meshgrid(np.arange(w, dtype=np.float32),
                             np.arange(h, dtype=np.float32))
        ramp = sol[1] * gx + sol[2] * gy
        ramp -= float(ramp[msel].mean())          # zero-mean: no global shift
        amp = float(np.abs(ramp).max())
        if amp < 1.0:
            return cut                             # destination light is flat
        ramp = ramp / amp * min(amp, 12.0) * strength
        lab = cv2.cvtColor(cut, cv2.COLOR_BGR2LAB).astype(np.float32)
        lab[..., 0] = np.clip(lab[..., 0] + ramp, 0, 255)
        return cv2.cvtColor(lab.astype(np.uint8), cv2.COLOR_LAB2BGR)
    except Exception:
        return cut


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
                pad_frac=0.8, levels=6, guard=None, color_ref=None):
    """Scale `cut`/`mask` into `box`=(x,y,w,h) on dst and HARMONIZE it.

    The "one whole image" pipeline (no visible part boundary):
      1. resize + generous feathering of the mask
      2. LAB color transfer toward the reference — `color_ref` (the
         DESTINATION region the part replaces, carrying its exact
         lighting/color/shadows) when given, else the ring AROUND the box
      3. luminance histogram match — inherits scene exposure/lighting
      4. light-direction ramp — the destination's L-gradient transfers
         onto the transplant so shadows agree (no "flat pasted slab")
      5. anti-desaturation — the transplant keeps its own chroma energy
         (ring/histogram matches used to wash the colors out)
      6. sensor-grain matching — same camera noise feel everywhere
      7. Laplacian-pyramid blending — low frequencies bleed wide, edges
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
    # color reference: the DESTINATION region the part replaces (exact
    # scene light/color) when provided, else the ring around the box
    ref_img = ring_s
    if color_ref is not None:
        try:
            if color_ref.shape[:2] != (bh, bw):
                color_ref = cv2.resize(color_ref, (bw, bh), interpolation=cv2.INTER_AREA)
            if color_ref.size and color_ref.mean() > 1:
                ref_img = color_ref
        except Exception:
            ref_img = ring_s
    cut_r = _match_color_to(cut_r, ref_img, mask=mask_r, strength=color_strength)
    cut_r = _match_lighting_to(cut_r, ref_img, mask_r, strength=color_strength)
    cut_r = _match_light_ramp(cut_r, ref_img, mask_r, strength=0.6)
    # ANTI-DESATURATION: the color/histogram matches toward a mixed or
    # neutral reference wash the transplant's colors out (the "faded
    # pasted slab" look). Restore the crop's own chroma energy (±25%).
    try:
        mo = mask_r > 100
        if int(mo.sum()) > 100:
            lab_o = cv2.cvtColor(orig_cut, cv2.COLOR_BGR2LAB).astype(np.float32)
            lab_m = cv2.cvtColor(cut_r, cv2.COLOR_BGR2LAB).astype(np.float32)
            for c in (1, 2):
                so = float(lab_o[..., c][mo].std()) + 1e-6
                sm = float(lab_m[..., c][mo].std()) + 1e-6
                gain = min(1.25, max(0.85, so / sm))
                lab_m[..., c] = 128.0 + (lab_m[..., c] - 128.0) * gain
            cut_r = cv2.cvtColor(np.clip(lab_m, 0, 255).astype(np.uint8),
                                 cv2.COLOR_LAB2BGR)
    except Exception:
        pass
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




# ============================================================================
# GARMENT COMPOSITE (نقل الملابس — طلب المالك 2026-11-07):
# «حذف الجزء الذي سيتم دمجه من صورة المصدر ووضع الملابس من صورة المرجع مكانه
#  ثم تعديل درجة الألوان والإضاءة والظل حتى تظهر وكأنها صورة واحدة».
#
# المدخل: صورة المصدر الحالية + قصاصة الملابس (على أبيض من extractGarmentOnWhite)
#         + صندوق الشخص المستهدف (normalized) من كشف الأشخاص.
# الخطوات: 1) استخراج ألفا للملابس من الخلفية البيضاء  2) ملاءمة الحجم داخل
# الصندوق  3) _blend_onto — نقل لون/إضاءة/ظل/حبيبات + دمج هرمي (نفس عدّة
# النقل المجربة) بمرجع لوني = منطقة الملابس القديمة نفسها (تحمل إضاءة المشهد).
# الناتج: تركيبة تُمرَّر بعدها على نموذج التعديل للتنسيق النهائي (harmonize).
# ============================================================================
def _garment_cutout_from_white(gbgr):
    """Garment RGBA cutout from a white-background product photo.

    Returns (bgr, alpha) cropped to content, or None when the cutout is not
    usable (no clear garment blob / covers everything)."""
    import cv2
    import numpy as np
    gray = cv2.cvtColor(gbgr, cv2.COLOR_BGR2GRAY).astype(np.float32)
    # near-white -> transparent (soft ramp keeps anti-aliased edges alive)
    soft = np.clip((240.0 - gray) * (255.0 / 40.0), 0, 255).astype(np.uint8)
    _, hard = cv2.threshold(soft, 40, 255, cv2.THRESH_BINARY)
    hard = _largest_component(hard, thresh=30)
    if hard is None or hard.max() == 0:
        return None
    if float((hard > 0).mean()) > 0.92:  # background not white at all
        return None
    # close pinholes, fill the garment interior so internal white details
    # (patterns, prints) stay opaque, then forbid anything outside it
    closed = cv2.morphologyEx(hard, cv2.MORPH_CLOSE,
                              cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
    cnts, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None
    solid = np.zeros_like(closed)
    cv2.drawContours(solid, [max(cnts, key=cv2.contourArea)], -1, 255, -1)
    alpha = cv2.bitwise_and(cv2.max(soft, solid), solid)
    if float((alpha > 128).mean()) < 0.02:
        return None
    k = max(3, int(0.02 * max(alpha.shape)) | 1)
    alpha = cv2.GaussianBlur(alpha, (k, k), 0)
    ys, xs = np.where(alpha > 20)
    if len(xs) < 50:
        return None
    m = 2
    x0, y0 = max(0, int(xs.min()) - m), max(0, int(ys.min()) - m)
    x1, y1 = min(alpha.shape[1] - 1, int(xs.max()) + m), min(alpha.shape[0] - 1, int(ys.max()) + m)
    return gbgr[y0:y1 + 1, x0:x1 + 1].copy(), alpha[y0:y1 + 1, x0:x1 + 1].copy()


@app.post("/garment/composite")
async def garment_composite(req: Request):
    """Cut the old garment area out of the source and composite the reference
    garment in its place with full scene harmonization (one-whole-image)."""
    try:
        body = await req.json()
    except Exception:
        return JSONResponse({"ok": False, "error": "invalid JSON body"}, status_code=400)
    from starlette.concurrency import run_in_threadpool
    return await run_in_threadpool(_garment_composite_impl, body)


def _garment_composite_impl(body: dict):
    import cv2
    import numpy as np
    try:
        src_data = body.get("source")
        gar_data = body.get("garment")
        bbox = body.get("bbox")
        if not src_data or not gar_data or not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
            return JSONResponse(
                {"ok": False, "error": "source, garment and bbox[4] are required"}, status_code=400)
        src = _load_image(src_data)
        gar = _load_image(gar_data)
        if src is None or gar is None:
            return JSONResponse({"ok": False, "error": "decode failed"}, status_code=400)
        H, W = src.shape[:2]
        x1n, y1n, x2n, y2n = [float(v) for v in bbox]
        bx = max(0, min(W - 8, int(round(x1n * W))))
        by = max(0, min(H - 8, int(round(y1n * H))))
        bw = max(8, min(W - bx, int(round((x2n - x1n) * W))))
        bh = max(8, min(H - by, int(round((y2n - y1n) * H))))

        cut = _garment_cutout_from_white(gar)
        if cut is None:
            return JSONResponse({"ok": False, "error": "garment cutout failed"})
        gar_bgr, gar_alpha = cut
        gh, gw = gar_bgr.shape[:2]

        # ملاءمة: عرض الصندوق كاملًا مع سقف ارتفاع 1.45×، وتعليق من أعلى
        # الصندوق (الملابس تتدلى من الكتفين).
        scale = bw / float(gw)
        if gh * scale > 1.45 * bh:
            scale = (1.45 * bh) / float(gh)
        tw, th = max(8, int(gw * scale)), max(8, int(gh * scale))
        tx = bx + (bw - tw) // 2
        ty = by + int(0.03 * bh)

        # المرجع اللوني = منطقة الملابس القديمة نفسها في المصدر (تحمل إضاءة
        # المشهد ودرجته الحرارية وظله) — هنا تُلصق القطعة فتتلوَّن كجزء أصلي.
        color_ref = src[by:by + bh, bx:bx + bw].copy()
        if color_ref.size == 0:
            color_ref = None

        dst = src.copy()
        dst = _blend_onto(dst, gar_bgr, gar_alpha, (tx, ty, tw, th),
                          color_strength=0.72, context_pad=0.5,
                          pad_frac=0.55, levels=5, color_ref=color_ref)
        return {"ok": True, "image": _encode_png(dst)}
    except Exception as e:
        traceback.print_exc()
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


if __name__ == "__main__":
    import uvicorn

    # SELF-HEAL: fetch any missing model in the background so a fresh
    # session / Codespace recovers on its own (no manual restore-models.sh).
    _kick_self_heal()
    uvicorn.run(app, host="0.0.0.0", port=3030, log_level="info")
