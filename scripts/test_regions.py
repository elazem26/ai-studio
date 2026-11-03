#!/usr/bin/env python3
"""اختبار شامل: تحديد المناطق بالنص العربي + النقل المخصص (custom)."""
import base64
import json
import sys
import time
import urllib.request

BASE = "http://localhost:3030"
OUT = "/tmp/region-tests"


def post(path, payload, timeout=180):
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
    except Exception as e:
        return 0, {"error": str(e)}


def get(path, timeout=10):
    try:
        with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except Exception as e:
        return 0, {"error": str(e)}


def data_url(path):
    ext = ".png" if path.lower().endswith(".png") else ".jpg"
    with open(path, "rb") as f:
        return f"data:image/{ext[1:]};base64," + base64.b64encode(f.read()).decode()


def save_b64(dataurl, path):
    with open(path, "wb") as f:
        f.write(base64.b64decode(dataurl.split(",", 1)[1]))


def main():
    import os
    os.makedirs(OUT, exist_ok=True)

    # 1) انتظار الخدمة
    print("waiting for service...", flush=True)
    for i in range(60):
        st, h = get("/health", timeout=4)
        if st == 200:
            print("health OK:", h, flush=True)
            break
        time.sleep(2)
    else:
        print("SERVICE DID NOT START")
        sys.exit(1)

    src = data_url("data/test-transplant/gen_man.png")
    ref = data_url("data/test-transplant/gen_woman.png")

    # 2) اختبارات التحديد بالنص
    tests = [
        ("t1_head", {"image": ref, "text": "الرأس"}),
        ("t2_hair", {"image": ref, "text": "الشعر"}),
        ("t3_bg", {"image": ref, "text": "الخلفية"}),
        ("t4_chest", {"image": ref, "text": "الصدر"}),
        ("t5_arms", {"image": ref, "text": "الذراعين"}),
        ("t6_eyes", {"image": ref, "text": "العينان"}),
        ("t7_gibberish", {"image": ref, "text": "الطائرة الصفراء"}),
        ("t8_expand", {"image": ref, "text": "كبّر التحديد",
                       "prevSpec": {"part": "hair"}}),
        ("t9_exclude", {"image": ref, "text": "بدون الوجه",
                        "prevSpec": {"part": "head"}}),
    ]
    mask_hair = None
    for name, payload in tests:
        t0 = time.time()
        st, d = post("/regions/select", payload)
        dt = time.time() - t0
        if d.get("ok"):
            print(f"[{name}] OK {dt:.1f}s label={d['label']} area={d['areaPct']}% bbox={d['bbox']}", flush=True)
            save_b64(d["overlay"], f"{OUT}/{name}_overlay.png")
            save_b64(d["mask"], f"{OUT}/{name}_mask.png")
            if name == "t2_hair":
                mask_hair = d["mask"]
        else:
            print(f"[{name}] FAIL {dt:.1f}s status={st} err={d.get('error','?')[:80]} unparsed={d.get('unparsed')}", flush=True)

    # 3) نقل مخصص: شعر المرجع → المصدر (بالمعتمد من المعاينة)
    if mask_hair:
        t0 = time.time()
        st, d = post("/transplant", {
            "source": src, "ref": ref, "mode": "custom",
            "refMask": mask_hair, "refSpec": {"part": "hair"},
            "scale": 1.0, "colorStrength": 0.6,
        }, timeout=300)
        dt = time.time() - t0
        if d.get("ok"):
            save_b64(d["result"], f"{OUT}/custom_hair_result.png")
            print(f"[custom-hair] OK {dt:.1f}s mode={d.get('mode')}", flush=True)
        else:
            print(f"[custom-hair] FAIL {dt:.1f}s status={st} err={d.get('error','?')[:120]}", flush=True)

    print("DONE")


if __name__ == "__main__":
    main()
