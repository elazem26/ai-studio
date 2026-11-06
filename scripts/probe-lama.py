#!/usr/bin/env python3
"""Probe lama_fp32.onnx expected input normalization."""
import numpy as np, cv2, onnxruntime as ort

sess = ort.InferenceSession("/home/z/my-project/data/models/lama_fp32.onnx", providers=["CPUExecutionProvider"])

# white image, black square in the middle, mask over the square
img = np.full((512, 512, 3), 255, np.uint8)
img[200:312, 200:312] = 0
mask = np.zeros((512, 512), np.uint8)
mask[190:322, 190:322] = 255

rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32)
m = (mask > 127).astype(np.float32)

for label, scale in [("0..1", 255.0), ("0..255", 1.0)]:
    x = (rgb / scale).transpose(2, 0, 1)[None]
    mi = m[None, None]
    out = sess.run(["output"], {"image": x.astype(np.float32), "mask": mi})[0]
    o = np.clip(out[0].transpose(1, 2, 0), 0, 1)
    center = o[240:270, 240:270].mean()
    corner = o[10:60, 10:60].mean()  # background area
    print(f"{label}: center={center*255:.1f} (want ~255) corner={corner*255:.1f} (want ~255) range=[{o.min()*255:.0f},{o.max()*255:.0f}]")
