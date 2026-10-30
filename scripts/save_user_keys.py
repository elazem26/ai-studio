#!/usr/bin/env python3
"""Save the user's Mistral and GitHub keys (from .env) to DB Setting table.

Keys are read from .env — NEVER hardcoded in this file (the GitHub copy
is public for one-click Codespaces; owner request 2026-10-29).
"""
import sqlite3
from datetime import datetime, timezone

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
        "llm:mistral_key": env_value("MISTRAL_API_KEY"),
        "llm:github_key": env_value("GITHUB_TOKEN"),
    }.items()
    if v
}
if not KEYS:
    raise SystemExit("لا توجد مفاتيح MISTRAL_API_KEY/GITHUB_TOKEN في .env — أضفها أولاً")

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
print("\nDONE — مفاتيح محفوظة من .env بدون أي تضمين في الكود")
