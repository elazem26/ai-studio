#!/usr/bin/env python3
"""Activate the LLM API keys into the running project.

Keys are read from .env — NEVER hardcoded in this file (the GitHub copy
is public for one-click Codespaces; owner request 2026-10-29).

1. Insert into DB Setting table (llm:groq_key, llm:google_key, llm:openrouter_key)
   -> takes effect immediately (free-llm.ts reads DB per request)
2. .env must already contain GROQ_API_KEY / GOOGLE_API_KEY / OPENROUTER_API_KEY
   (they are persisted there; this script only mirrors them into the DB)
"""
import sqlite3
from datetime import datetime

DB = "/home/z/my-project/db/custom.db"
ENV = "/home/z/my-project/.env"


def env_value(name: str) -> str:
    try:
        for line in open(ENV):
            line = line.strip()
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip()
    except FileNotFoundError:
        pass
    return ""


KEYS = {
    k: v
    for k, v in {
        "llm:groq_key": env_value("GROQ_API_KEY"),
        "llm:google_key": env_value("GOOGLE_API_KEY"),
        "llm:openrouter_key": env_value("OPENROUTER_API_KEY"),
    }.items()
    if v
}
if not KEYS:
    raise SystemExit(
        "لا توجد مفاتيح في .env — أضف GROQ_API_KEY / GOOGLE_API_KEY / OPENROUTER_API_KEY أولاً (أو أدخلها من /llm-keys)"
    )

# --- 1) DB Setting table ---
conn = sqlite3.connect(DB)
cur = conn.cursor()
now = datetime.utcnow().isoformat()
for k, v in KEYS.items():
    cur.execute(
        "INSERT INTO Setting (key, value, updatedAt) VALUES (?, ?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt",
        (k, v, now),
    )
conn.commit()
cur.execute("SELECT key, substr(value,1,14) FROM Setting")
print("=== DB Setting table now ===")
for row in cur.fetchall():
    print(row)
conn.close()

# --- 2) keep OPENROUTER_MODEL default in .env (preserve everything else) ---
existing = {}
try:
    for line in open(ENV):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            existing[k.strip()] = v.strip()
except FileNotFoundError:
    pass

existing.setdefault("OPENROUTER_MODEL", "nvidia/nemotron-3.5-super-vl:free")
with open(ENV, "w") as f:
    f.write("# AI Clothing Studio — environment (ALL keys in PLAINTEXT per owner request 2026-10-28)\n")
    for k, v in existing.items():
        f.write(f"{k}={v}\n")

print("\n=== .env written ===")
with open(ENV) as f:
    content = f.read()
for line in content.splitlines():
    if "=" in line and not line.startswith("#"):
        k, _, v = line.partition("=")
        print(f"{k}={v[:10]}..." if v else f"{k}=")
print("\nDONE")
