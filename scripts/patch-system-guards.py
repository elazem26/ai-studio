#!/usr/bin/env python3
"""Patch all /api/system admin routes with a server-side admin guard.

Adds to every route file:
  1. import { requireAdmin } from "@/lib/auth";
  2. a guard block at the top of every POST/GET handler:
       const admin = await requireAdmin(req);
       if (!admin) return NextResponse.json({ ok:false, error:"صلاحيات المدير مطلوبة" }, { status: 401 });
  3. `req: Request` parameter when missing.

Routes WITHOUT NextResponse import get one added.
Status/ensure-services/face-swap-guardian stay open (non-destructive).
"""
import re
import os

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
        print(f"SKIP (missing): {r}")
        continue
    src = open(p).read()
    if "requireAdmin" in src:
        print(f"SKIP (already guarded): {r}")
        continue

    # 1) imports
    if 'from "@/lib/auth"' in src:
        src = src.replace('from "@/lib/auth"', 'from "@/lib/auth"')  # extend below
        # add requireAdmin to the existing named import
        src = re.sub(r'import \{([^}]*)\} from "@/lib/auth";',
                     lambda m: 'import {' + m.group(1).rstrip() + ', requireAdmin } from "@/lib/auth";',
                     src, count=1)
    else:
        # insert after last import line
        lines = src.splitlines()
        last_import = max(i for i, l in enumerate(lines) if l.startswith("import "))
        lines.insert(last_import + 1, 'import { requireAdmin } from "@/lib/auth";')
        src = "\n".join(lines)
    if "NextResponse" not in src:
        lines = src.splitlines()
        lines.insert(0, 'import { NextResponse } from "next/server";')
        src = "\n".join(lines)

    # 2) handlers: add req param + guard
    def patch_handler(m):
        head, name = m.group(0), m.group(1)
        if "(" in head and "req" in head:
            return head  # already takes req
        return f"export async function {name}(req: Request) {{\n{GUARD}"

    # handle both `export async function POST() {` and same-line bodies
    src = re.sub(r"export async function (POST|GET)\(\)\s*\{", patch_handler, src)
    # handlers that already accept req (e.g. NextRequest) — inject guard after first '{'
    def inject_existing(m):
        return m.group(0) + "\n" + GUARD
    src = re.sub(r"export async function (POST|GET)\((?:req|request)[^)]*\)\s*\{",
                 lambda m: m.group(0) + "\n" + GUARD, src)

    open(p, "w").write(src)
    print(f"PATCHED: {r}")

print("DONE")
