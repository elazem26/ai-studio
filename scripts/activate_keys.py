#!/usr/bin/env python3
"""Activate the 3 API keys found in the uploaded zip into the running project:
1. Insert into DB Setting table (llm:groq_key, llm:google_key, llm:openrouter_key)
   -> takes effect immediately (free-llm.ts reads DB per request)
2. Write into /home/z/my-project/.env
   -> for env-based reads (image providers) + persistence across restarts
"""
import sqlite3
from datetime import datetime

DB = "/home/z/my-project/db/custom.db"
ENV = "/home/z/my-project/.env"

KEYS = {
    "llm:groq_key": "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",
    "llm:google_key": "AQ.Ab8RN6IimERKuZibYWt-7PwL2xKCW6B1ix1rRt4XBLzSd-Ot5Q",
    "llm:openrouter_key": "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",
}

ENV_VARS = {
    "GROQ_API_KEY": KEYS["llm:groq_key"],
    "GOOGLE_API_KEY": KEYS["llm:google_key"],
    "OPENROUTER_API_KEY": KEYS["llm:openrouter_key"],
    "OPENROUTER_MODEL": "nvidia/nemotron-3.5-super-vl:free",
}

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

# --- 2) .env file (preserve existing DATABASE_URL) ---
existing = {}
try:
    with open(ENV) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                existing[k.strip()] = v.strip()
except FileNotFoundError:
    pass

existing.update(ENV_VARS)

with open(ENV, "w") as f:
    f.write("# AI Clothing Studio - environment (keys restored from uploaded zip)\n")
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
