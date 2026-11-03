#!/usr/bin/env python3
"""Find an upload with exactly one person (good garment-swap reference)."""
import json, base64, glob, urllib.request

def post(url, payload):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=120).read())

files = sorted(glob.glob("/home/z/my-project/data/uploads/*.jpg")) + \
        sorted(glob.glob("/home/z/my-project/data/uploads/*.png"))
for f in files[:40]:
    try:
        buf = open(f, "rb").read()
        if len(buf) > 6_000_000:
            continue
        durl = "data:image/png;base64," + base64.b64encode(buf).decode()
        r = post("http://localhost:3030/detect-persons", {"image": durl})
        n = len(r.get("persons", []))
        if n == 1:
            print("FOUND", f, "persons=1")
            break
        else:
            print("skip", f.split("/")[-1], "persons=", n)
    except Exception as e:
        print("err", f, e)
