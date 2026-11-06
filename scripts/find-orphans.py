#!/usr/bin/env python3
"""Find orphan source files: files never imported anywhere else."""
import os, re, sys

ROOT = "/home/z/my-project"
SRC = os.path.join(ROOT, "src")

# collect all source files
all_files = []
for base in ["src/app", "src/components", "src/lib", "src/hooks", "src/stores"]:
    d = os.path.join(ROOT, base)
    for dp, _, fns in os.walk(d):
        for fn in fns:
            if fn.endswith((".ts", ".tsx")):
                all_files.append(os.path.join(dp, fn))

# read all contents once
contents = {}
for f in all_files:
    try:
        contents[f] = open(f, encoding="utf-8", errors="ignore").read()
    except Exception:
        contents[f] = ""

def stems(path):
    base = os.path.splitext(os.path.basename(path))[0]
    return {base}

orphans = []
for f in all_files:
    base = os.path.splitext(os.path.basename(f))[0]
    if base in ("index", "route", "page", "layout", "globals", "middleware"):
        # entry points / convention files: only orphan if nothing imports their path
        pass
    rel = os.path.relpath(f, SRC)
    # search for import references: by bare stem (risky) or by path parts
    hits = 0
    for other, txt in contents.items():
        if other == f:
            continue
        # path-based reference e.g. "@/components/ui/button" or "./button"
        rel_no_ext = rel[:-4] if rel.endswith((".ts", ".tsx")) else rel
        mod = rel_no_ext.replace("\\", "/")
        cands = ["@/" + mod, "./" + os.path.basename(mod), "/" + mod]
        for c in cands:
            if c in txt:
                hits += 1
                break
        if hits:
            continue
    # also count re-exports like `export * from "./button"`
    if not hits:
        stem_ref = 0
        pat = re.compile(r"""["'](?:@/|\.+/)?[\w\-/]*""" + re.escape(base) + r"""["']""")
        for other, txt in contents.items():
            if other == f:
                continue
            if pat.search(txt):
                stem_ref += 1
        if stem_ref == 0:
            orphans.append(os.path.relpath(f, ROOT))

print(f"total files scanned: {len(all_files)}")
print(f"orphan candidates: {len(orphans)}")
for o in sorted(orphans):
    print("  ", o)
