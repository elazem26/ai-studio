#!/usr/bin/env bash
# full-backup-all.sh — 6-location backup of AI Studio source (small, ~700KB)
set +e
PROJECT_DIR="/home/z/my-project/extracted"
DB_FILE="/home/z/my-project/db/custom.db"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LATEST_NAME="ai-studio-latest.tar.gz"
PORTABLE_NAME="ai-studio-portable-full.tar.gz"
LOCATIONS=(
  "${PROJECT_DIR}/backups"
  "/home/z/my-project/download"
  "/home/z/my-project/backups"
  "/tmp/ai-studio-backups"
  "${PROJECT_DIR}/.backups"
  "/home/z/backups"
)
for loc in "${LOCATIONS[@]}"; do mkdir -p "$loc" 2>/dev/null; done
TMP_TAR="/tmp/ai-studio-backup-tmp-${TIMESTAMP}.tar.gz"
DB_STAGING="/tmp/db-snapshot-${TIMESTAMP}.db"
[ -f "$DB_FILE" ] && cp "$DB_FILE" "$DB_STAGING" 2>/dev/null
cd "$PROJECT_DIR"
tar -czf "$TMP_TAR" 2>/dev/null \
  --exclude='node_modules' --exclude='.next' --exclude='.git' --exclude='backups' --exclude='.backups' \
  --exclude='*.log' --exclude='*.pid' --exclude='face-swap-guardian-status.json' \
  --exclude='public/ai-studio-complete.tar.gz' --exclude='public/ai-studio-complete.tar.gz.*' \
  --exclude='public/ai-studio-current.tar.gz' --exclude='mini-services/face-swap-pro/models' \
  --exclude='mini-services/watermark-eraser/models' --exclude='uploads' --exclude='data/uploads' \
  --transform="s|.*db-snapshot.*|db/custom.db|" \
  -C "$PROJECT_DIR" src prisma public package.json next.config.ts tsconfig.json tailwind.config.ts postcss.config.mjs components.json start.sh start.bat Dockerfile Caddyfile INSTALL-GUIDE.md requirements-frozen.txt next-env.d.ts eslint.config.mjs bun.lock \
  -C /tmp "db-snapshot-${TIMESTAMP}.db" 2>/dev/null
PRIMARY_SIZE=$(stat -c%s "$TMP_TAR" 2>/dev/null || echo 0)
echo "[backup] Primary size: ${PRIMARY_SIZE} bytes ($(( PRIMARY_SIZE / 1024 / 1024 )) MB)"
[ "$PRIMARY_SIZE" -lt 1000 ] && { echo "[backup] ERROR: too small"; rm -f "$DB_STAGING" "$TMP_TAR"; exit 1; }
SAVED_COUNT=0
for loc in "${LOCATIONS[@]}"; do
  mkdir -p "$loc" 2>/dev/null
  if cp "$TMP_TAR" "${loc}/${LATEST_NAME}" 2>/dev/null; then
    cp "$TMP_TAR" "${loc}/ai-studio-${TIMESTAMP}.tar.gz" 2>/dev/null || true
    SAVED_COUNT=$((SAVED_COUNT + 1))
    echo "[backup] ✓ ${loc}/${LATEST_NAME} ($(stat -c%s "${loc}/${LATEST_NAME}" 2>/dev/null) bytes)"
  else
    echo "[backup] ✗ Failed: $loc"
  fi
done
PORTABLE_PATH="/home/z/my-project/download/${PORTABLE_NAME}"
cp "$TMP_TAR" "$PORTABLE_PATH" 2>/dev/null || true
rm -f "$DB_STAGING" "$TMP_TAR"
echo "[backup] Saved in ${SAVED_COUNT} locations"
echo "BACKUP_DONE"
