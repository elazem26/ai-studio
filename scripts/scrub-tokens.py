#!/usr/bin/env python3
"""Replace literal GitHub tokens in scripts with a dynamic loader
reading from data/.gh-token (gitignored) or the GH_TOKEN env var."""
import os
import re
import sys

ROOT = "/home/z/my-project"
TOKEN_FILE = os.path.join(ROOT, "data", ".gh-token")
FILES = [
    "scripts/keepalive-cron.sh",
    "scripts/sync-transplant-files.py",
    "scripts/push-server-to-github.sh",
    "scripts/push-numbered-boxes.sh",
    "scripts/push-clean-files.sh",
    "scripts/push-selection-feature.sh",
]

SHELL_LOAD = 'export GH_TOKEN="${GH_TOKEN:-$(head -1 /home/z/my-project/data/.gh-token 2>/dev/null)}"'
PY_LOAD = ('TOKEN = os.environ.get("GH_TOKEN") or open('
           '"/home/z/my-project/data/.gh-token").read().strip()')

PAT = re.compile(r"ghp_[A-Za-z0-9]{20,}")

changed = []
for rel in FILES:
    p = os.path.join(ROOT, rel)
    if not os.path.isfile(p):
        continue
    with open(p, "r", encoding="utf-8", errors="replace") as f:
        src = f.read()
    if not PAT.search(src):
        continue
    if rel.endswith(".py"):
        out = PAT.sub("__GH_TOKEN_PLACEHOLDER__", src)
        out = out.replace('TOKEN = "__GH_TOKEN_PLACEHOLDER__"', PY_LOAD)
        if "import os" not in out:
            out = out.replace('TOKEN = ', 'import os\nTOKEN = ', 1)
        # any leftover placeholder -> env fallback
        out = out.replace("__GH_TOKEN_PLACEHOLDER__", 'os.environ.get("GH_TOKEN", "")')
    else:
        out = PAT.sub("__GH_TOKEN_PLACEHOLDER__", src)
        # replace the whole export line containing the placeholder
        out = re.sub(
            r"^.*export GH_TOKEN=.*__GH_TOKEN_PLACEHOLDER__.*$",
            SHELL_LOAD.replace("\\", "\\\\"),
            out,
            flags=re.MULTILINE,
        )
        out = out.replace("__GH_TOKEN_PLACEHOLDER__", "ghp_REDACTED")
    with open(p, "w", encoding="utf-8") as f:
        f.write(out)
    changed.append(rel)

print("scrubbed:", *changed, sep="\n  ")
# verify none left
left = []
for rel in FILES:
    p = os.path.join(ROOT, rel)
    with open(p, "r", encoding="utf-8", errors="replace") as f:
        if PAT.search(f.read()):
            left.append(rel)
print("leftover:", left or "NONE")
sys.exit(1 if left else 0)
