#!/usr/bin/env python3
"""E2E test for the /agent-transplant endpoint (port 3030)."""
import base64
import json
import sys
import urllib.request
import urllib.error

import cv2
import numpy as np

BASE = "http://localhost:3030"


def post(path, payload, timeout=240):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


def data_url(img_bgr):
    ok, buf = cv2.imencode(".png", img_bgr)
    return "data:image/png;base64," + base64.b64encode(buf.tobytes()).decode()


def main():
    # synthetic pair for background/object commands
    src = np.zeros((800, 1200, 3), np.uint8)
    for x in range(1200):
        src[:, x] = (40, 120 + int(80 * x / 1200), 60)
    cv2.circle(src, (600, 400), 130, (60, 60, 220), -1)
    ref = np.full((900, 900, 3), (180, 90, 40), np.uint8)
    cv2.circle(ref, (450, 450), 140, (60, 200, 60), -1)

    src_real = cv2.imread("scripts/studio-multi-ref.png")
    ref_real = cv2.imread("scripts/face-multi-ref.png")

    tests = [
        ("انقل الخلفية", data_url(src), data_url(ref), True),
        ("انقل الرسمة", data_url(src), data_url(ref), True),
        ("انقل الرأس", data_url(src_real), data_url(ref_real), True),
        ("انقل الصدر", data_url(src_real), data_url(ref_real), True),
        ("انقل الزراعين", data_url(src_real), data_url(ref_real), True),
        ("صوت: ابعت الراس", data_url(src_real), data_url(ref_real), True),  # parsing robustness
    ]
    all_ok = True
    for i, (cmd, s, r, expect_ok) in enumerate(tests, 1):
        st, data = post("/agent-transplant", {"source": s, "reference": r, "command": cmd})
        ok = (st == 200 and data.get("ok")) if expect_ok else (st != 200)
        if ok and expect_ok:
            b64 = data["result"].split(",", 1)[1]
            arr = np.frombuffer(base64.b64decode(b64), np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            cv2.imwrite(f"/tmp/agent-{i}.png", img)
        print(f"[{i}] '{cmd}' → part={data.get('part', '?')} HTTP {st} ok={data.get('ok')} "
              f"steps={len(data.get('steps', []))} stages={len(data.get('stages', []))} "
              f"{'PASS' if ok else 'FAIL: ' + str(data.get('error', ''))[:80]}")
        if ok and expect_ok:
            ids = [s.get("id") for s in data.get("stages", [])]
            if ids != ["reading", "analysis", "thinking", "understanding", "execution"]:
                print(f"    STAGES MISMATCH: {ids}")
                all_ok = False
            else:
                for s in data["stages"]:
                    print(f"    - {s.get('title')}: {s.get('summary')} ({s.get('ms')}ms, {len(s.get('items', []))} بنود)")
        all_ok = all_ok and ok

    # empty command → 400
    st, data = post("/agent-transplant", {"source": data_url(src), "reference": data_url(ref), "command": " "})
    ok400 = st == 400
    print(f"[7] empty command → HTTP {st} {'PASS' if ok400 else 'FAIL'}")
    print("PASS" if (all_ok and ok400) else "FAIL")
    sys.exit(0 if (all_ok and ok400) else 1)


if __name__ == "__main__":
    main()
