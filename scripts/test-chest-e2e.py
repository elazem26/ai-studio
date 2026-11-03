"""Chest-region transplant e2e — the user's exact complaint:
دمج الصدر فاشل، ألوان باهتة، إضاءة وظلال مختلفة، صورتين مختلفتين."""
import base64
import io
import json
import sys
import urllib.request

BASE = "http://localhost:3000"
COOKIE = None


def req(method, path, data=None, headers=None, raw=None, timeout=240):
    global COOKIE
    h = dict(headers or {})
    if COOKIE:
        h["Cookie"] = COOKIE
    body = raw
    if data is not None:
        body = json.dumps(data).encode()
        h["Content-Type"] = "application/json"
    r = urllib.request.Request(BASE + path, data=body, method=method, headers=h)
    try:
        resp = urllib.request.urlopen(r, timeout=timeout)
    except urllib.error.HTTPError as e:
        resp = e
    sc = resp.headers.get("Set-Cookie")
    if sc and "session" in sc.lower():
        COOKIE = sc.split(";")[0]
    return resp.status, resp.read()


def multipart_upload(path, filename, img_bytes):
    b = "----ZTestBoundary1234"
    pre = (f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; "
           f"filename=\"{filename}\"\r\nContent-Type: image/png\r\n\r\n").encode()
    post = f"\r\n--{b}--\r\n".encode()
    return req("POST", path, raw=pre + img_bytes + post,
               headers={"Content-Type": f"multipart/form-data; boundary={b}"})


def main():
    st, _ = req("POST", "/api/auth/login", {"email": "mohamed", "password": "1970"})
    print("login:", st)
    if st != 200:
        sys.exit(1)
    T = "/home/z/my-project/data/test-transplant/"
    src = open(T + "gen_man.png", "rb").read()      # man in gray shirt (destination)
    ref = open(T + "gen_woman.png", "rb").read()    # woman (reference body)
    st, body = multipart_upload("/api/images/upload", "src.png", src)
    src_path = json.loads(body)["path"]
    st, body = multipart_upload("/api/images/upload", "ref.png", ref)
    ref_path = json.loads(body)["path"]
    st, body = req("POST", "/api/images/part-transplant", {
        "sourcePath": src_path, "refPath": ref_path,
        "mode": "person", "region": "chest", "scale": 1.0, "colorStrength": 0.6,
    })
    print("chest:", st)
    d = json.loads(body)
    if st == 200 and d.get("url"):
        raw = urllib.request.urlopen(BASE + d["url"], timeout=60).read()
        open("/tmp/chest_result.png", "wb").write(raw)
        print("bytes:", len(raw))
    else:
        print("CHEST FAILED:", d.get("error"), d.get("message", ""))
        sys.exit(2)


if __name__ == "__main__":
    main()
