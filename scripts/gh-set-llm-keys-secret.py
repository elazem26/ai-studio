#!/usr/bin/env python3
"""Create/update the LLM_KEYS_B64 Codespaces repository secret.

The user's free-tier LLM keys live in the LOCAL DB (Setting llm:<p>_key).
The GitHub repo copy is sanitized (public repo) — so the thinking step of
the smart generation engine would have zero providers in a Codespace.
This script ships them as ONE encrypted Codespaces secret (never in the
repo); .devcontainer/start-server.sh materializes them into .env on boot
as GROQ_API_KEY / GOOGLE_API_KEY / ... which free-llm.ts reads as fallback.
"""
import base64
import json
import os
import sqlite3
import sys
import urllib.request

import nacl.public

REPO = "elazem26/ai-studio"
SECRET_NAME = "LLM_KEYS_B64"
TOKEN = os.environ.get("GH_TOKEN") or ""
if not TOKEN:
    print("FATAL: set GH_TOKEN env var first")
    sys.exit(1)

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "db", "custom.db")


def api(method: str, path: str, payload: dict | None = None) -> dict:
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={
            "Authorization": f"token {TOKEN}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req) as r:
        body = r.read().decode()
        return json.loads(body) if body else {}


def main() -> None:
    con = sqlite3.connect(DB_PATH)
    rows = con.execute(
        "SELECT key, value FROM Setting WHERE key LIKE 'llm:%' AND value != ''"
    ).fetchall()
    con.close()
    keys: dict[str, str] = {}
    for k, v in rows:
        # llm:groq_key -> groq ; llm:cloudflare_account_id -> cloudflare_account_id
        name = k[len("llm:"):]
        if name.endswith("_key"):
            name = name[: -len("_key")]
        keys[name] = v.strip()
    # github PAT as GITHUB_TOKEN could shadow the codespace token inside the
    # Next process — GitHub Models is retired anyway, drop it.
    keys.pop("github", None)
    if not keys:
        print("FATAL: no llm:* keys in local DB")
        sys.exit(1)

    raw = json.dumps(keys).encode()
    b64 = base64.b64encode(raw).decode()

    pk = api("GET", f"/repos/{REPO}/codespaces/secrets/public-key")
    raw_key = base64.b64decode(pk["key"])
    assert len(raw_key) == 32
    sealed = nacl.public.SealedBox(nacl.public.PublicKey(raw_key)).encrypt(b64.encode())
    api(
        "PUT",
        f"/repos/{REPO}/codespaces/secrets/{SECRET_NAME}",
        {"encrypted_value": base64.b64encode(sealed).decode(), "key_id": pk["key_id"]},
    )
    print(f"OK: secret {SECRET_NAME} written with providers: {sorted(keys.keys())}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"FATAL: {e}")
        sys.exit(1)
