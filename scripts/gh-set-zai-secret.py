#!/usr/bin/env python3
"""Create/update the ZAI_CONFIG_B64 Codespaces repository secret.

The z-ai-web-dev-sdk needs a .z-ai-config JSON file (baseUrl + apiKey...).
That file lives at /etc/.z-ai-config in the local sandbox and is NEVER
pushed (public repo). Instead we store its base64 in an encrypted
GitHub Codespaces repo secret; .devcontainer/start-server.sh materializes
the file from $ZAI_CONFIG_B64 when the Codespace boots.
"""
import base64
import json
import os
import sys
import urllib.request

import nacl.public

REPO = "elazem26/ai-studio"
SECRET_NAME = "ZAI_CONFIG_B64"
TOKEN = os.environ.get("GH_TOKEN") or ""
if not TOKEN:
    print("FATAL: set GH_TOKEN env var first")
    sys.exit(1)


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
    with open("/etc/.z-ai-config", "rb") as f:
        raw = f.read()
    # Validate it parses and has required keys
    cfg = json.loads(raw)
    assert cfg.get("baseUrl") and cfg.get("apiKey"), "invalid config"
    b64 = base64.b64encode(raw).decode()

    pk = api("GET", f"/repos/{REPO}/codespaces/secrets/public-key")
    raw_key = base64.b64decode(pk["key"])
    assert len(raw_key) == 32, f"bad key length {len(raw_key)}"
    key = nacl.public.PublicKey(raw_key)
    sealed = nacl.public.SealedBox(key).encrypt(b64.encode())

    api(
        "PUT",
        f"/repos/{REPO}/codespaces/secrets/{SECRET_NAME}",
        {"encrypted_value": base64.b64encode(sealed).decode(), "key_id": pk["key_id"]},
    )
    print(f"OK: secret {SECRET_NAME} written ({len(b64)} b64 chars)")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"FATAL: {e}")
        sys.exit(1)
