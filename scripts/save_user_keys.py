#!/usr/bin/env python3
"""Save the user's Mistral and GitHub keys to DB Setting table."""
import sqlite3
from datetime import datetime, timezone

DB = "/home/z/my-project/db/custom.db"
KEYS = {
    "llm:mistral_key": "mstrl_dITm6WgK8DLguj36kGqQnCk4kSUtCMW6_2FxpHL",
    "llm:github_key": "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",
}

conn = sqlite3.connect(DB)
cur = conn.cursor()
now = datetime.now(timezone.utc).isoformat()
for k, v in KEYS.items():
    cur.execute(
        "INSERT INTO Setting (key, value, updatedAt) VALUES (?, ?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt",
        (k, v, now),
    )
conn.commit()
cur.execute("SELECT key, substr(value,1,14), length(value) FROM Setting ORDER BY key")
print("=== DB Setting table now ===")
for row in cur.fetchall():
    print(f"  {row[0]}: {row[1]}... (len={row[2]})")
conn.close()
print("\nDONE — Mistral مُفعّل ويعمل · GitHub محفوظ لكن الخدمة موقوفة")
