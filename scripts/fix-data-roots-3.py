#!/usr/bin/env python3
"""Fix pass 3: DATA_ROOT was aliased to the FUNCTION dataRootSync — usages
passed a function object to path.join -> ERR_INVALID_ARG_TYPE at module eval.
Now: import { dataRootSync } + const DATA_ROOT = dataRootSync(); after imports."""
import re, pathlib

API = pathlib.Path("/home/z/my-project/src/app/api")
ALIAS = "@/lib/security/resolve-file-path"

changed = 0
for f in sorted(API.rglob("*.ts")):
    src = f.read_text()
    if "dataRootSync as DATA_ROOT" not in src:
        continue
    # 1) de-alias in imports
    src = src.replace("dataRootSync as DATA_ROOT", "dataRootSync")
    # 2) insert const declaration right after the resolve-file-path import line
    if not re.search(r'^const DATA_ROOT = dataRootSync\(\);', src, re.M):
        pat = re.compile(r'(import\s*\{[^}]*dataRootSync[^}]*\}\s*from\s*["\']' + re.escape(ALIAS) + r'["\'];?\n)')
        m = pat.search(src)
        if not m:
            print("!! no import line found:", f); continue
        src = pat.sub(r'\1const DATA_ROOT = dataRootSync();\n', src, count=1)
    f.write_text(src)
    changed += 1
print("TOTAL fixed:", changed)
