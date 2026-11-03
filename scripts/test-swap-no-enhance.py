"""Standalone swap test: isolate whether the ghost artifact comes from
_enhance_face (color-transfer pass) or from inswapper paste_back itself.
Runs the model directly — does NOT touch the running 3030 service."""
import sys, time
import numpy as np
import cv2

MODEL = "/home/z/.insightface/models/inswapper_128.onnx"
t0 = time.time()
from insightface.app import FaceAnalysis
from insightface.model_zoo import get_model

app = FaceAnalysis(name="buffalo_l", providers=("CPUExecutionProvider",))
app.prepare(ctx_id=0, det_size=(640, 640))
swapper = get_model(MODEL, providers=("CPUExecutionProvider",))
print("models loaded in %.1fs" % (time.time() - t0), flush=True)

src = cv2.imread("/home/z/my-project/.next/standalone/data/uploads/mw0nshul-29f7963dc012.jpg")   # MAN
ref = cv2.imread("/home/z/my-project/.next/standalone/data/uploads/mw0nshur-a822c1b8b6c3.jpg")   # WOMAN

src_faces = sorted(app.get(src), key=lambda f: (f.bbox[2]-f.bbox[0])*(f.bbox[3]-f.bbox[1]), reverse=True)
ref_faces = sorted(app.get(ref), key=lambda f: (f.bbox[2]-f.bbox[0])*(f.bbox[3]-f.bbox[1]), reverse=True)
print("src faces:", len(src_faces), "ref faces:", len(ref_faces))

res = swapper.get(src.copy(), src_faces[0], ref_faces[0], paste_back=True)
cv2.imwrite("/tmp/no_enhance_result.png", res)
print("saved /tmp/no_enhance_result.png")
