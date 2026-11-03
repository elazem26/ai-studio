#!/usr/bin/env python3
"""Sync ALL keys from DB Setting table into .env — plaintext, per owner request.

Owner policy (2026-10-28): .env must contain EVERY key in clear text
(no encryption, no redaction) so the GitHub backup is a complete restore.
"""
import sqlite3
import re

DB = "/home/z/my-project/db/custom.db"
ENV = "/home/z/my-project/.env"

# DB key -> .env variable name
MAPPING = {
    "llm:groq_key": "GROQ_API_KEY",
    "llm:google_key": "GOOGLE_API_KEY",
    "llm:openrouter_key": "OPENROUTER_API_KEY",
    "llm:mistral_key": "MISTRAL_API_KEY",
    "llm:cerebras_key": "CEREBRAS_API_KEY",
    "llm:cohere_key": "COHERE_API_KEY",
    "llm:cloudflare_key": "CLOUDFLARE_API_KEY",
    "llm:github_key": "GITHUB_TOKEN",
}

# keys that must stay as-is if present in .env
KEEP = ["DATABASE_URL", "OPENROUTER_MODEL", "GITHUB_BACKUP_REPO", "GITHUB_BACKUP_BRANCH"]

con = sqlite3.connect(DB)
cur = con.cursor()

env_lines = []
if len(env_lines) == 0:
    try:
        with open(ENV) as f:
            env_lines = f.read().splitlines()
    except FileNotFoundError:
        env_lines = []

# keep structural vars
kept = {}
for line in env_lines:
    m = re.match(r"^([A-Z_]+)=", line)
    if m and m.group(1) in KEEP:
        kept[m.group(1)] = line

# DB values override/add
db_vals = {}
for dbkey, envname in MAPPING.items():
    row = cur.execute("SELECT value FROM Setting WHERE key=?", (dbkey,)).fetchone()
    if row and row[0]:
        db_vals[envname] = row[0]

# GITHUB_BACKUP_REPO default (confirmed by gh-push-full.sh)
if "GITHUB_BACKUP_REPO" not in kept:
    kept["GITHUB_BACKUP_REPO"] = "GITHUB_BACKUP_REPO=elazem26/ai-studio"

out = ["# AI Clothing Studio — environment (ALL keys in PLAINTEXT per owner request 2026-10-28)"]
if "DATABASE_URL" in kept:
    out.append(kept.pop("DATABASE_URL"))
else:
    out.append("DATABASE_URL=file:/home/z/my-project/db/custom.db")
for name in ["OPENROUTER_MODEL", "GITHUB_BACKUP_REPO", "GITHUB_BACKUP_BRANCH"]:
    if name in kept:
        out.append(kept.pop(name))

out.append("")
out.append("# ---- LLM provider keys (plaintext) ----")
for envname in ["GROQ_API_KEY", "GOOGLE_API_KEY", "OPENROUTER_API_KEY", "MISTRAL_API_KEY",
                "CEREBRAS_API_KEY", "COHERE_API_KEY", "CLOUDFLARE_API_KEY"]:
    if envname in db_vals:
        out.append(f"{envname}={db_vals[envname]}")

out.append("")
out.append("# ---- GitHub backup (used by end-session + scripts/gh-push-full.sh) ----")
if "GITHUB_TOKEN" in db_vals:
    out.append(f"GITHUB_TOKEN={db_vals['GITHUB_TOKEN']}")
for line in kept.values():
    out.append(line)

with open(ENV, "w") as f:
    f.write("\n".join(out) + "\n")

print("=== .env written — key names (values hidden here) ===")
for line in out:
    if "=" in line and not line.startswith("#"):
        print("  " + line.split("=")[0] + "=*** (" + str(len(line.split("=", 1)[1])) + " chars)")
con.close()
