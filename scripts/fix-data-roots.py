#!/usr/bin/env python3
"""Rewrite all API routes writing to process.cwd()/data -> persistent dataRootSync().
Root cause: standalone server cwd = .next/standalone, so results went to
.next/standalone/data/results while /results/[file] reads resolveDataRoot()
(/home/z/my-project/data) -> 404 broken images in UI + wiped on rebuild."""
import re, sys, pathlib

API = pathlib.Path("/home/z/my-project/src/app/api")
LIB = "/home/z/my-project/src/lib/security/resolve-file-path"

# path.resolve(process.cwd(), "data/...")  OR  path.join(process.cwd(), "data/...")
PAT = re.compile(r'path\.(?:resolve|join)\(\s*process\.cwd\(\)\s*,\s*(["\']data/[^"\']*["\'])\s*\)')

changed, skipped = [], []
for f in sorted(API.rglob("*.ts")):
    src = f.read_text()
    if "process.cwd()" not in src:
        continue
    new = PAT.sub(r"path.join(DATA_ROOT, \1)", src)
    if new == src:
        # cwd used but not for data/ paths — leave untouched
        skipped.append(str(f))
        continue
    # --- ensure import ---
    lib_import_re = r'import\s*\{([^}]*)\}\s*from\s*["\']' + re.escape(LIB) + r'["\']'
    if re.search(lib_import_re, new):
        # merge into existing import if DATA_ROOT not already there
        def merge(m):
            names = m.group(1)
            if "DATA_ROOT" in names:
                return m.group(0)
            return 'import { ' + names.rstrip().rstrip(',') + ', dataRootSync as DATA_ROOT } from "' + LIB + '";'
        new = re.sub(lib_import_re + r';?', merge, new, count=1)
    else:
        # add import after the last top-of-file import line
        lines = new.split("\n")
        last_import = -1
        for i, ln in enumerate(lines[:60]):
            if ln.startswith("import "):
                last_import = i
        lines.insert(last_import + 1, 'import { dataRootSync as DATA_ROOT } from "' + LIB + '";')
        new = "\n".join(lines)
    f.write_text(new)
    changed.append(str(f))

print("CHANGED:", len(changed))
for c in changed: print("  ", c.replace("/home/z/my-project/", ""))
print("SKIPPED (cwd but no data/):", len(skipped))
for s in skipped: print("  ", s.replace("/home/z/my-project/", ""))
