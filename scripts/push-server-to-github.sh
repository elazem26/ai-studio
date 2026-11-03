#!/bin/bash
# Push mini-services/face-swap-pro/server.py to GitHub via Contents API
export GH_TOKEN="${GH_TOKEN:-$(head -1 /home/z/my-project/data/.gh-token 2>/dev/null)}"
export PATH=/home/z/.local-bin:/home/z/my-project/scripts/gh-cli/bin:$PATH
cd /home/z/my-project
SHA=$(gh api repos/elazem26/ai-studio/contents/mini-services/face-swap-pro/server.py --jq '.sha') || exit 1
base64 -w0 mini-services/face-swap-pro/server.py > /tmp/server_b64.txt
python3 - "$SHA" <<'EOF' > /tmp/put_payload.json
import json, sys
sha = sys.argv[1]
b64 = open("/tmp/server_b64.txt").read().strip()
print(json.dumps({
    "message": "fix(transplant): seamless one-whole-image blending — kill ghost face/veil/double-image",
    "content": b64,
    "sha": sha,
}))
EOF
gh api -X PUT repos/elazem26/ai-studio/contents/mini-services/face-swap-pro/server.py \
  --input /tmp/put_payload.json --jq '.commit.sha' && echo "PUSHED OK"
