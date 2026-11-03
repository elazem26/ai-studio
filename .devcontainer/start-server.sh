#!/usr/bin/env bash
# Devcontainer start — runs on every Codespace start/restart.
# Guarantees something answers on :3000 and that the REAL app
# (not the setup placeholder) is what the forwarded port serves.
cd "$(dirname "$0")/.."

# [0] fetch latest code — a restart after a repo push delivers fixes
#     (autostash keeps local edits; ff-only never rewrites history)
git pull --ff-only --autostash >/tmp/ai-studio-pull.log 2>&1 || true

# [0.5] z-ai SDK config — the public repo never carries credentials, so
#      the SDK config (baseUrl+apiKey) ships as an encrypted Codespaces
#      repo secret (ZAI_CONFIG_B64) and is materialized here on every
#      boot. Without it every AI feature (try-on, agent, enhance) fails
#      with "Configuration file not found or invalid".
if [ ! -f .z-ai-config ] && [ ! -f "$HOME/.z-ai-config" ] && [ ! -f /etc/.z-ai-config ] && [ -n "$ZAI_CONFIG_B64" ]; then
  if echo "$ZAI_CONFIG_B64" | base64 -d > "$HOME/.z-ai-config" 2>/dev/null; then
    chmod 600 "$HOME/.z-ai-config" 2>/dev/null || true
    echo "[AI Studio] z-ai config materialized from Codespaces secret"
  else
    echo "[AI Studio] WARNING: ZAI_CONFIG_B64 present but invalid base64"
  fi
fi

# [1] if the setup placeholder is still holding :3000, retire it now —
#     we are about to bind the real server.
if [ -f /tmp/ai-studio-placeholder.pid ]; then
  kill "$(cat /tmp/ai-studio-placeholder.pid)" 2>/dev/null || true
  rm -f /tmp/ai-studio-placeholder.pid
  sleep 1
fi

# [2] already serving the real app? (postStart can run more than once)
if curl -s -o /dev/null --max-time 3 http://localhost:3000; then
  echo "[AI Studio] already running on :3000"
  exit 0
fi

# [3] defensive: deps must exist before any server can start
if [ ! -d node_modules ] || [ ! -x node_modules/.bin/next ]; then
  echo "[AI Studio] node_modules missing — installing..."
  npm install --no-audit --no-fund
  npx --yes prisma generate >/dev/null 2>&1 || true
fi

# [3.5] same secret bootstrap right before the server spawns (covers the
#      case where secrets arrive after step [0.5], e.g. first boot)
if [ ! -f .z-ai-config ] && [ ! -f "$HOME/.z-ai-config" ] && [ ! -f /etc/.z-ai-config ] && [ -n "$ZAI_CONFIG_B64" ]; then
  echo "$ZAI_CONFIG_B64" | base64 -d > "$HOME/.z-ai-config" 2>/dev/null && \
    chmod 600 "$HOME/.z-ai-config" 2>/dev/null || true
fi

# [3.6] LLM keys bootstrap — the repo .env is sanitized (public repo), so the
#      user's free-tier LLM keys ship as the encrypted LLM_KEYS_B64 secret
#      (JSON: {"groq":"gsk_...", "google":"...", "cloudflare_account_id":".."}).
#      They are written into .env as the env-var names free-llm.ts reads as
#      fallback (GROQ_API_KEY, GOOGLE_API_KEY, ...) — DB stays authoritative.
if [ -n "$LLM_KEYS_B64" ]; then
  if echo "$LLM_KEYS_B64" | base64 -d > /tmp/llm-keys.json 2>/dev/null; then
    node -e '
const fs = require("fs");
const map = {
  groq: "GROQ_API_KEY", google: "GOOGLE_API_KEY", openrouter: "OPENROUTER_API_KEY",
  cerebras: "CEREBRAS_API_KEY", mistral: "MISTRAL_API_KEY", cohere: "COHERE_API_KEY",
  cloudflare: "CLOUDFLARE_API_TOKEN", cloudflare_account_id: "CLOUDFLARE_ACCOUNT_ID",
  nvidia: "NVIDIA_API_KEY", zhipu: "ZHIPU_API_KEY",
};
const keys = JSON.parse(fs.readFileSync("/tmp/llm-keys.json", "utf8"));
let env = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
for (const [prov, envName] of Object.entries(map)) {
  const val = keys[prov];
  if (!val) continue;
  const re = new RegExp("^" + envName + "=.*$", "m");
  if (re.test(env)) env = env.replace(re, envName + "=" + val);
  else env += (env.endsWith("\n") ? "" : "\n") + envName + "=" + val + "\n";
}
fs.writeFileSync(".env", env);
console.log("[AI Studio] LLM keys materialized from Codespaces secret:", Object.keys(keys).join(", "));
' && rm -f /tmp/llm-keys.json
  else
    echo "[AI Studio] WARNING: LLM_KEYS_B64 present but invalid base64"
  fi
fi

# [4] production first (instant pages): .next/standalone when present
if [ -f .next/BUILD_ID ] && [ -f .next/standalone/server.js ]; then
  echo "[AI Studio] starting production server..."
  set -a; . ./.env 2>/dev/null; set +a
  export PORT=3000 HOSTNAME=0.0.0.0 NODE_ENV=production
  setsid nohup node .next/standalone/server.js > /tmp/ai-studio-dev.log 2>&1 &
else
  echo "[AI Studio] starting dev server..."
  export NODE_ENV=development
  # setsid fully detaches from the lifecycle command's process group so
  # Codespaces cannot reap the server when postStartCommand exits.
  setsid nohup ./node_modules/.bin/next dev -p 3000 > /tmp/ai-studio-dev.log 2>&1 &
fi

# [5] warm-up: hit the app until it answers
(
  for _ in $(seq 1 120); do
    sleep 2
    if curl -s -o /dev/null --max-time 5 http://localhost:3000/login; then
      echo "[AI Studio] app is up — browser opens automatically."
      break
    fi
  done
) > /dev/null 2>&1 &

echo "[AI Studio] starting (log: /tmp/ai-studio-dev.log) — browser will open automatically."
