#!/usr/bin/env python3
"""Deduplicate the double-injected admin guard blocks."""
import os
import re

BASE = "/home/z/my-project/src/app/api/system"
ROUTES = [
    "create-backup", "download-backup", "download-current", "end-session",
    "full-archive", "full-backup", "multi-backup", "multi-backup-download",
    "prepare-complete", "restore-backup", "upload-model",
]

GUARD = (
    '  const admin = await requireAdmin(req);\n'
    '  if (!admin) return NextResponse.json({ ok: false, error: "صلاحيات المدير مطلوبة" }, { status: 401 });\n'
)

for r in ROUTES:
    p = os.path.join(BASE, r, "route.ts")
    if not os.path.exists(p):
        continue
    src = open(p).read()
    doubled = GUARD + GUARD
    if doubled in src:
        src = src.replace(doubled, GUARD)
        open(p, "w").write(src)
        print(f"DEDUPED: {r}")
    else:
        print(f"OK (single guard): {r}")
print("DONE")
