#!/usr/bin/env python3
"""Full E2E verification (2026-11-06 owner request):
   face-swap, garment-swap (numbered boxes), part-transplant select,
   upload + detect with BOTH path forms, /login & /repair pages."""
import json, sys, time, urllib.request, uuid

BASE = "http://localhost:3000"
ok_all = True

def post(path, body=None, timeout=90, raw=None, ctype="application/json"):
    url = BASE + path
    if raw is not None:
        data, headers = raw, {"Content-Type": ctype}
    else:
        data, headers = json.dumps(body).encode(), {"Content-Type": "application/json"}
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode() or "{}")
        except Exception: return e.code, {}
    except Exception as e:
        return 0, {"error": str(e)}

def get(path, timeout=30):
    try:
        with urllib.request.urlopen(BASE + path, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0

def check(name, cond, detail=""):
    global ok_all
    mark = "PASS" if cond else "FAIL"
    if not cond: ok_all = False
    print(f"[{mark}] {name} {detail}")

# ---------- 0. pages ----------
check("page /", get("/") == 200)
check("page /login", get("/login") == 200)
check("page /repair", get("/repair") == 200)

# ---------- 1. upload ----------
with open("/home/z/my-project/scripts/face-multi-ref.png", "rb") as f:
    img_bytes = f.read()
boundary = uuid.uuid4().hex
body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
        f"filename=\"t.png\"\r\nContent-Type: image/png\r\n\r\n").encode() + img_bytes + f"\r\n--{boundary}--\r\n".encode()
st, up = post("/api/images/upload", raw=body, ctype=f"multipart/form-data; boundary={boundary}", timeout=60)
check("upload", st == 200 and up.get("url"), f"status={st}")
upath, uurl = up.get("path", ""), up.get("url", "")

# ---------- 2. detect BOTH forms ----------
st, d = post("/api/images/face-detect", {"imagePath": upath, "mode": "persons"})
check("detect path-form", st == 200 and d.get("ok") and len(d.get("persons", [])) > 0, f"n={len(d.get('persons', []))}")
st, d2 = post("/api/images/face-detect", {"imagePath": uurl, "mode": "persons"})
check("detect url-form", st == 200 and d2.get("ok") and len(d2.get("persons", [])) > 0, f"n={len(d2.get('persons', []))}")

# ---------- 3. face-swap (owner complaint: لا يعمل) ----------
st, fs = post("/api/images/face-swap", {
    "sourcePath": upath, "facePath": upath, "targetIndex": 0, "faceIndex": 0,
}, timeout=180)
fs_ok = st == 200 and (fs.get("url") or fs.get("ok"))
check("face-swap", fs_ok, f"status={st} err={fs.get('message') or fs.get('error') or '-'} url={bool(fs.get('url'))}")

# ---------- 4. garment-swap async job (numbered boxes) ----------
st, gs = post("/api/images/garment-swap", {
    "sourcePath": upath, "garmentPaths": [upath],
    "garmentPath": upath, "mappings": [{"sourceIndex": 0, "refIndex": 0, "refImage": 0}],
    "async": True,
})
job_ok = st == 200 and gs.get("jobId")
check("garment-swap job start", job_ok, f"status={st} err={gs.get('message') or gs.get('error') or '-'}")
if job_ok:
    jid = gs["jobId"]
    result = None
    for _ in range(60):  # up to 5 min
        time.sleep(5)
        st, pj = get(f"/api/images/garment-swap?jobId={jid}") and (0, {}) or (0, {})
        req = urllib.request.Request(BASE + f"/api/images/garment-swap?jobId={jid}")
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                pj = json.loads(r.read().decode() or "{}")
                if pj.get("status") not in ("running", "pending", ""):
                    result = pj; break
        except urllib.error.HTTPError as e:
            if e.code == 404: result = {"status": "error", "message": "job 404"}; break
        except Exception:
            continue
    check("garment-swap job result", bool(result and result.get("status") == "done"),
          f"status={(result or {}).get('status')} err={(result or {}).get('message') or '-'}")

# ---------- 5. part-transplant select (location words) ----------
st, pt = post("/api/images/part-transplant/select", {
    "imagePath": upath, "refPath": uurl, "text": "الخلفية",
}, timeout=120)
pt_ok = st == 200 and (pt.get("maskUrl") or pt.get("ok") or pt.get("part"))
check("part-transplant select (الخلفية)", pt_ok, f"status={st} keys={list(pt.keys())[:6]} err={pt.get('error') or '-'}")

print("\nRESULT:", "ALL_PASS" if ok_all else "HAS_FAILURES")
sys.exit(0 if ok_all else 1)
