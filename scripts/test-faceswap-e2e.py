#!/usr/bin/env python3
"""End-to-end test of the face-swap page flow exactly as the browser does it:
login -> upload source -> upload face -> POST /api/images/face-swap."""
import io
import json
import sys
import urllib.request
import urllib.error

BASE = "http://localhost:3000"
COOKIE = None


def req(method: str, path: str, data=None, headers=None, raw=None, timeout=180):
    global COOKIE
    url = BASE + path
    h = dict(headers or {})
    if COOKIE:
        h["Cookie"] = COOKIE
    body = raw
    if data is not None:
        body = json.dumps(data).encode()
        h["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=body, method=method, headers=h)
    try:
        resp = urllib.request.urlopen(r, timeout=timeout)
    except urllib.error.HTTPError as e:
        resp = e
    sc = resp.headers.get("Set-Cookie")
    if sc and "session" in sc.lower():
        COOKIE = sc.split(";")[0]
    payload = resp.read()
    return resp.status, payload


def multipart_upload(path: str, filename: str, img_bytes: bytes):
    boundary = "----ZTestBoundary1234"
    pre = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
           f"filename=\"{filename}\"\r\nContent-Type: image/png\r\n\r\n").encode()
    post = f"\r\n--{boundary}--\r\n".encode()
    raw = pre + img_bytes + post
    return req("POST", path, raw=raw, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})


def main():
    # 1) login
    st, body = req("POST", "/api/auth/login", {"email": "mohamed", "password": "1970"})
    print("login:", st)
    if st != 200:
        print(body[:300])
        sys.exit(1)

    # 2) upload source + face (real test photos with faces)
    src = open("/home/z/my-project/data/test-transplant/gen_man.png", "rb").read()
    face = open("/home/z/my-project/data/test-transplant/gen_woman.png", "rb").read()
    st, body = multipart_upload("/api/images/upload", "source.png", src)
    print("upload source:", st, body[:120])
    src_url = json.loads(body).get("url")
    src_path = json.loads(body).get("path")
    st, body = multipart_upload("/api/images/upload", "face.png", face)
    print("upload face:", st, body[:120])
    face_path = json.loads(body).get("path")

    # 3) face-swap through the Next API (exactly what the page calls)
    st, body = req("POST", "/api/images/face-swap", {
        "sourcePath": src_path, "facePath": face_path,
    })
    print("face-swap:", st)
    d = json.loads(body)
    print(json.dumps({k: v for k, v in d.items() if k != "path"}, ensure_ascii=False)[:400])
    if st == 200 and d.get("url"):
        # verify the result file really exists and is a valid image
        st2, body2 = req("GET", d["url"], timeout=60)
        print("result fetch:", st2, "bytes:", len(body2), "png_sig:", body2[:4] == b"\x89PNG")
    else:
        print("SWAP FAILED:", d.get("error"), "|", d.get("message", ""))
        sys.exit(2)


if __name__ == "__main__":
    main()
