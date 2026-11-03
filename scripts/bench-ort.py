#!/usr/bin/env python3
"""Benchmark: does disabling ORT thread-spinning speed up detection on 2 cores?"""
import os, time, json, base64
import numpy as np
import cv2

IMG = cv2.imread("/tmp/bench-frame.png")
assert IMG is not None

def bench(tag, spin_disable):
    import onnxruntime as ort
    from insightface.app import FaceAnalysis
    if spin_disable:
        # Patch InferenceSession to use tuned SessionOptions
        orig = ort.InferenceSession
        def patched(path, **kw):
            so = ort.SessionOptions()
            so.intra_op_num_threads = 2
            so.inter_op_num_threads = 1
            so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            so.add_session_config_entry("session.intra_op.allow_spinning", "0")
            so.log_severity_level = 3
            kw["sess_options"] = so
            return orig(path, **kw)
        ort.InferenceSession = patched
    app = FaceAnalysis(name="buffalo_l", root=os.path.expanduser("~/.insightface"),
                       providers=["CPUExecutionProvider"])
    app.prepare(ctx_id=0, det_size=(320, 320))
    # warmup
    app.get(IMG)
    t = time.time()
    for _ in range(4):
        app.get(IMG)
    dt = (time.time() - t) / 4
    print(f"{tag}: {dt*1000:.0f} ms/detect")
    return dt

bench("default ORT       ", False)
bench("tuned (no spinning)", True)
