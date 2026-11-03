#!/usr/bin/env python3
"""Retest transplant person+head with portrait sources (detectable faces)."""
import json
import sys
import urllib.request
import urllib.error

BASE = "http://localhost:3000"
COOKIE = None


def req(method, path, data=None, headers=None, raw=None, timeout=180):
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

    src = open("/home/z/my-project/data/test-transplant/gen_man.png", "rb").read()
    ref = open("/home/z/my-project/data/test-transplant/gen_woman.png", "rb").read()
    st, body = multipart_upload("/api/images/upload", "source.png", src)
    src_path = json.loads(body).get("path")
    st, body = multipart_upload("/api/images/upload", "ref.png", ref)
    ref_path = json.loads(body).get("path")
    print("uploads ok:", src_path, ref_path)

    for mode in ("person", "head"):
        st, body = req("POST", "/api/images/part-transplant", {
            "sourcePath": src_path, "refPath": ref_path, "mode": mode,
        }, timeout=170)
        d = json.loads(body)
        if st == 200 and d.get("url"):
            st2, body2 = req("GET", d["url"], timeout=60)
            fn = f"/home/z/my-project/data/test-transplant/e2e_{mode}.png"
            open(fn, "wb").write(body2)
            print(f"{mode}: {st2} saved {fn} bytes={len(body2)}")
        else:
            print(f"{mode}: FAILED {st} {d.get('error')} | {d.get('message','')}")


if __name__ == "__main__":
    main()
