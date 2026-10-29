#!/bin/bash
# ============================================================
# Prepare the CLEAN GitHub backup staging tree (v3)
#
# OWNER SPEC (2026-10-29): GitHub gets a CLEAN version —
#   code + db + .env + scripts + public + prisma + start files.
#   NO images, NO videos, NO models, NO node_modules,
#   NO backups, NO junk/duplicate dirs.
#   (The heavy PC-complete package with models lives in
#    download/AI-Studio-PC-Complete.tar.gz instead.)
#
# Modes:
#   FRESH  — first run (no .gh-staging/.git): full stage + commit
#   UPDATE — staging exists: rsync changes (mirrors deletions)
#            + one "update" commit → push uploads ONLY the diff
# ============================================================
set -uo pipefail
P=/home/z/my-project
# Staging lives OUTSIDE the project dir so the dev server (Turbopack)
# never watches it — changes here must NOT trigger recompiles/restarts.
S=/home/z/.gh-staging
LOG=/home/z/.gh-prepare.log

# NOTE: locking + log truncation are owned by scripts/gh-run-chain.sh
# (the wrapper) so the WHOLE chain (prepare + push) is serialized.

exec > >(tee "$LOG") 2>&1

MODE="fresh"
if [ -d "$S/.git" ] && [ -f "$S/.env" ]; then
  MODE="update"
fi
echo "MODE: $MODE"

RsyncExcludes=(
  --exclude 'node_modules' --exclude '.next' --exclude '.git'
  --exclude '.gh-staging' --exclude '.gh-token' --exclude '.gh-*.log' --exclude '.gh-*.status'
  --exclude '.gh-lock'
  --exclude 'backups' --exclude '.backups'
  --exclude 'download'
  --exclude 'data/uploads' --exclude 'data/results' --exclude 'data/temp' --exclude 'data/sessions'
  --exclude 'extracted' --exclude 'tool-results' --exclude '.restore-check'
  --exclude 'mini-services/face-swap-pro/models'
  --exclude '__pycache__' --exclude '*.pyc' --exclude '*.log'
  --exclude 'tsconfig.tsbuildinfo' --exclude '.DS_Store'
  --exclude '.zscripts' --exclude 'dev.log' --exclude 'server.log'
  --exclude '*.png' --exclude '*.jpg' --exclude '*.jpeg' --exclude '*.webp' --exclude '*.mp4'
)

if [ "$MODE" = "fresh" ]; then
  echo "[1/6] clean staging tree..."
  rm -rf "$S"; mkdir -p "$S"
  echo "[2/6] rsync project -> staging (clean set)..."
  rsync -a "${RsyncExcludes[@]}" "$P"/ "$S"/
else
  echo "[1/6] incremental rsync (mirrors deletions too)..."
  rsync -a --delete "${RsyncExcludes[@]}" "$P"/ "$S"/
fi
echo "staged size (excl .git): $(du -sh --exclude=.git "$S" | cut -f1)"

echo "[3/6] verify clean set + .env present..."
for junk in data/uploads data/results extracted tool-results download mini-services/face-swap-pro/models; do
  if [ -e "$S/$junk" ]; then echo "FATAL: junk survived staging: $junk"; exit 1; fi
done
test -f "$S/.env" && echo "OK: .env staged ($(wc -c < "$S/.env") bytes)" || { echo "FATAL: .env missing"; exit 1; }
test -f "$S/db/custom.db" && echo "OK: db staged" || echo "WARN: db missing"

echo "[4/6] write MODELS-NOTE + restore-models.sh (models ship with the PC package)..."
mkdir -p "$S/mini-services/face-swap-pro/models"
cat > "$S/mini-services/face-swap-pro/models/README.txt" <<'EOS'
Models are NOT stored in this clean GitHub copy (owner spec 2026-10-29).
Get them from the PC-complete package (AI-Studio-PC-Complete.tar.gz,
folder mini-services/face-swap-pro/models + ~/.insightface/models),
or re-download: inswapper_128.onnx + buffalo_l (insightface).
EOS
if [ -f /home/z/.insightface/models/buffalo_l.zip ]; then
  : # kept out of the clean repo on purpose
fi
cat > "$S/scripts/restore-models.sh" <<'EOS'
#!/bin/bash
# Restore face-swap models from the PC-complete package into place.
# Usage: bash scripts/restore-models.sh /path/to/extracted/PC-package
set -e
SRC="${1:-.}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
P="$ROOT"
[ -d "$SRC/my-project" ] && SRC="$SRC/my-project"
echo "[1/2] copy inswapper_128.onnx..."
mkdir -p "$P/mini-services/face-swap-pro/models"
cp -v "$SRC/mini-services/face-swap-pro/models/inswapper_128.onnx" \
      "$P/mini-services/face-swap-pro/models/" 2>/dev/null || echo "model not found in $SRC"
echo "[2/2] copy buffalo_l -> ~/.insightface/models/ ..."
mkdir -p "$HOME/.insightface/models"
if [ -f "$SRC/.insightface/models/buffalo_l.zip" ]; then
  cp -v "$SRC/.insightface/models/buffalo_l.zip" "$HOME/.insightface/models/"
  cd "$HOME/.insightface/models" && unzip -oq buffalo_l.zip
elif [ -d "$SRC/home/z/.insightface/models/buffalo_l" ]; then
  cp -rv "$SRC/home/z/.insightface/models/buffalo_l" "$HOME/.insightface/models/"
fi
echo "DONE"
EOS
chmod +x "$S/scripts/restore-models.sh"
cp "$S/scripts/restore-models.sh" "$P/scripts/restore-models.sh"
chmod +x "$P/scripts/restore-models.sh"

echo "[5/6] git commit..."
cd "$S"
if [ ! -d .git ]; then
  printf '__pycache__/\n*.pyc\n.DS_Store\n*.log\n' > .gitignore
  git init -b main >/dev/null
fi
# keep git memory/CPU modest on this 2vCPU/4GB box
git config gc.auto 0
git config pack.threads 1
git config core.compression 6
git add -A
if git diff --cached --quiet; then
  echo "NO-CHANGES: staging already matches latest state"
  echo "ALL-PREP-DONE"
  exit 0
fi
if [ "$MODE" = "fresh" ]; then
  git commit -q -m "CLEAN BACKUP — code + db + .env (keys) + scripts, no media/models

Per owner spec (2026-10-29):
- GitHub copy = clean version: no images, no videos, no models,
  no node_modules, no backups, no junk/duplicate dirs
- .env committed in plaintext with all API keys (private repo)
- PC-complete runnable package (with models) ships separately
  as AI-Studio-PC-Complete.tar.gz
- restore: bun install && bun run db:generate && bash start.sh"
else
  CHANGED=$(git diff --cached --stat | tail -1 | awk '{print $1}')
  git commit -q -m "update: latest clean state ($CHANGED files)

Always-latest clean policy (owner spec 2026-10-29):
- every end-session / manual sync commits ONLY the diff
- media/models/junk never enter this repo"
fi
echo "commit: $(git log --oneline | head -1)"
echo "objects: $(du -sh .git | cut -f1)"

echo "[6/6] offline bundle (small — clean tree)..."
FREE=$(df --output=avail -B1 / | tail -1)
if [ "$FREE" -gt 2500000000 ]; then
  git bundle create "$P/download/ai-studio-clean-backup.bundle" main
  echo "bundle: $P/download/ai-studio-clean-backup.bundle ($(du -sh "$P/download/ai-studio-clean-backup.bundle" | cut -f1))"
else
  echo "SKIP bundle (low disk: ${FREE} bytes free)"
fi

echo "ALL-PREP-DONE"
