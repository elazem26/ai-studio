#!/usr/bin/env python3
"""Remove duplicate admin guard blocks (with or without blank line between)."""
import os
import re

BASE = "/home/z/my-project/src/app/api/system"
ROUTES = [
    "create-backup", "download-backup", "download-current", "end-session",
    "full-archive", "full-backup", "multi-backup", "multi-backup-download",
    "prepare-complete", "restore-backup", "upload-model",
]

G1 = '  const admin = await requireAdmin(req);\n'
G2 = '  if (!admin) return NextResponse.json({ ok: false, error: "صلاحيات المدير مطلوبة" }, { status: 401 });\n'
GUARD = G1 + G2

# guard block, optionally followed by blank line(s) + another guard block
DOUBLE = re.compile(
    re.escape(GUARD) + r"(?:[ \t]*\n)+" + re.escape(GUARD)
)

for r in ROUTES:
    p = os.path.join(BASE, r, "route.ts")
    if not os.path.exists(p):
        continue
    src = open(p).read()
    n = 0
    while True:
        new = DOUBLE.sub(GUARD, src)
        if new == src:
            break
        src = new
        n += 1
    open(p, "w").write(src)
    calls = src.count("requireAdmin(req)")
    print(f"{r}: collapsed={n}, requireAdmin(req) calls={calls}")
print("DONE")
