#!/usr/bin/env python3
"""
Sanitize the GitHub staging tree before commit/push (v1, 2026-10-29).

Policy change (owner request: one-click public Codespaces):
  The GitHub copy must contain NO usable secrets, because the repo is
  PUBLIC. Everything secret is emptied in .env and stripped from
  db/custom.db:
    - .env: any key matching TOKEN/SECRET/PASSWORD/API_KEY/_KEY -> empty
      (DATABASE_URL + GITHUB_BACKUP_REPO are kept: not secrets)
    - db/custom.db: Setting rows llm:*_key (or secret-like values) are
      DELETED (app recreates them when keys are re-entered in /llm-keys)
      + LogEntry cleared + secure_delete + VACUUM so bytes are really gone
    - final guard: scan the whole staging tree for secret-like values;
      exit 1 (FATAL) if any survived -> the push chain aborts
  Secrets stay intact in the LOCAL project (.env + db) — only the
  staging copy that goes to GitHub is sanitized.

Usage: python3 scripts/sanitize-staging.py [/path/to/staging]
"""
import os
import re
import sqlite3
import sys

STAGE = sys.argv[1] if len(sys.argv) > 1 else "/home/z/.gh-staging"

SECRET_VALUE = re.compile(
    r"(ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|ghu_[A-Za-z0-9_]{30,}|ghs_[A-Za-z0-9]{30,}|"
    r"github_pat_[A-Za-z0-9_]{50,}|gsk_[A-Za-z0-9]{20,}|sk-or-v1-[a-f0-9]{30,}|"
    r"sk-ant-[A-Za-z0-9_\-]{30,}|sk-proj-[A-Za-z0-9_\-]{30,}|AIza[0-9A-Za-z_\-]{30,}|"
    r"AQ\.Ab[0-9A-Za-z_\-]{20,}|mstrl_[A-Za-z0-9]{20,}|xox[bp]-[A-Za-z0-9\-]{20,}|"
    r"nvapi-[A-Za-z0-9_\-]{30,}|eyJhbGciOi[A-Za-z0-9_.\-]{40,})"
)
ENV_KEY_SECRET = re.compile(r"^(.*(?:TOKEN|SECRET|PASSWORD|API_KEY|_KEY))=", re.I)
ENV_KEEP = {"GITHUB_BACKUP_REPO", "DATABASE_URL"}
# Ship a RELATIVE db url: the repo may be cloned anywhere (Codespace paths
# differ). .devcontainer/setup.sh rewrites it to an absolute path on arrival.
DB_URL_SHIPPED = "file:../db/custom.db"

# ---------------- .env ----------------
env_path = os.path.join(STAGE, ".env")
emptied, dropped = [], []
if os.path.exists(env_path):
    out = []
    for line in open(env_path, encoding="utf-8", errors="replace").read().splitlines():
        if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
            out.append(line)
            continue
        key = line.split("=", 1)[0].strip()
        if key == "DATABASE_URL":
            if line.split("=", 1)[1].strip() != DB_URL_SHIPPED:
                emptied.append("DATABASE_URL(rewritten)")
            out.append(f"DATABASE_URL={DB_URL_SHIPPED}")
            continue
        if key in ENV_KEEP:
            out.append(line)
            continue
        val = line.split("=", 1)[1].strip()
        m = ENV_KEY_SECRET.match(line)
        if m:
            if val:
                emptied.append(key)
            out.append(key + "=")
        elif SECRET_VALUE.search(val):
            dropped.append(key)
            continue
        else:
            out.append(line)
    open(env_path, "w", encoding="utf-8").write("\n".join(out) + "\n")
    print(f"[sanitize] .env: emptied {emptied or 'none'}; dropped {dropped or 'none'}")
else:
    print("[sanitize] WARN: .env missing in staging")

# ---------------- db ----------------
db_path = os.path.join(STAGE, "db", "custom.db")
if os.path.exists(db_path):
    con = sqlite3.connect(db_path)
    con.execute("PRAGMA secure_delete=ON")
    cur = con.cursor()
    tables = {r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    dropped_keys = []
    if "Setting" in tables:
        for k, v in cur.execute("SELECT key, value FROM Setting").fetchall():
            secret_key = bool(re.match(r"llm:.*_key$", k or "")) or bool(
                re.search(r"(token|secret|password|apikey|api_key)", k or "", re.I)
            )
            secret_val = isinstance(v, str) and bool(SECRET_VALUE.search(v))
            runtime_junk = bool((k or "").startswith("session:"))
            if secret_key or secret_val or runtime_junk:
                cur.execute("DELETE FROM Setting WHERE key=?", (k,))
                dropped_keys.append(k)
    cleared = []
    if "LogEntry" in tables:
        n = cur.execute("SELECT COUNT(*) FROM LogEntry").fetchone()[0]
        if n:
            cur.execute("DELETE FROM LogEntry")
            cleared.append(f"LogEntry({n})")
    con.commit()
    con.execute("VACUUM")
    con.close()
    print(f"[sanitize] db: dropped Setting {dropped_keys or 'none'}; cleared {cleared or 'none'}")
else:
    print("[sanitize] WARN: db/custom.db missing in staging")

# ---------------- final guard (whole tree) ----------------
bad = []
for root, dirs, files in os.walk(STAGE):
    dirs[:] = [d for d in dirs if d not in (".git", "node_modules", ".next")]
    for f in files:
        p = os.path.join(root, f)
        if f.endswith((".db", ".sqlite", ".png", ".jpg", ".webp")):
            continue
        try:
            if os.path.getsize(p) > 30_000_000:
                continue
            txt = open(p, encoding="utf-8", errors="ignore").read()
        except Exception:
            continue
        for mm in SECRET_VALUE.finditer(txt):
            bad.append((os.path.relpath(p, STAGE), mm.group(0)[:8]))

if bad:
    print("[sanitize] FATAL: secret-like values survived:")
    for p, s in bad[:10]:
        print("   ", p, s)
    sys.exit(1)

print("[sanitize] OK — staging clean (no usable secrets)")
