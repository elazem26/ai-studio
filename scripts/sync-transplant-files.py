#!/usr/bin/env python3
"""Sync the part-transplant feature files to GitHub via Contents API.

Bypasses the divergent local/remote git lineages by putting each file's
EXACT local content into the repo (one commit per file). Idempotent.
"""
import base64, json, subprocess, sys

import os
TOKEN = os.environ.get("GH_TOKEN") or open("/home/z/my-project/data/.gh-token").read().strip()
REPO = "elazem26/ai-studio"
FILES = [
    "mini-services/face-swap-pro/server.py",
    "src/app/api/images/part-transplant/route.ts",
    "src/components/transplant/transplant-panel.tsx",
    "src/components/studio/studio-header.tsx",
    "src/lib/i18n/ar.json",
    "src/lib/i18n/en.json",
    "src/stores/ui-store.ts",
    "src/app/page.tsx",
    "scripts/e2e-part-transplant.sh",
]


def gh_api(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["gh", "api"] + args,
        capture_output=True, text=True,
        env={"GH_TOKEN": TOKEN, "PATH": "/home/z/.local-bin:/home/z/my-project/scripts/gh-cli/bin:/usr/bin:/bin", "HOME": "/home/z"},
    )


def main() -> int:
    ok = True
    for path in FILES:
        # remote sha (empty if file doesn't exist yet)
        get = gh_api(["repos/{}/contents/{}".format(REPO, path), "--jq", ".sha"])
        sha = get.stdout.strip() if get.returncode == 0 else ""

        with open(path, "rb") as f:
            content = base64.b64encode(f.read()).decode()

        body: dict = {
            "message": "sync(part-transplant): {}".format(path),
            "content": content,
        }
        if sha:
            body["sha"] = sha

        with open("/tmp/put-body.json", "w") as f:
            json.dump(body, f)
        put = gh_api(["-X", "PUT", "repos/{}/contents/{}".format(REPO, path),
                      "--input", "/tmp/put-body.json", "--jq", ".commit.sha"])
        if put.returncode == 0:
            print("OK  {} -> {}".format(path, put.stdout.strip()[:12]))
        else:
            ok = False
            print("ERR {} :: {}".format(path, (put.stderr or put.stdout).strip()[:200]))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
