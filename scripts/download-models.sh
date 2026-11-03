#!/bin/bash
# ============================================================
# download-models.sh — SELF-HEALING model installer (canonical)
#
# ONE way to get every model into ONE canonical location
# (~/.insightface/models) in any fresh session / Codespace:
#   buffalo_l/            face detector  (~288MB, GitHub releases)
#   inswapper_128.onnx    face swapper   (~555MB, HuggingFace)
#
# Resumable: wget -c continues partial downloads.
# Idempotent: skips anything already present & valid.
# Called manually OR by face-swap-pro/server.py self-heal.
# ============================================================
set -u
MODELS_DIR="$HOME/.insightface/models"
mkdir -p "$MODELS_DIR"

BUFFALO_ZIP_URL="https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip"
BUFFALO_ZIP="$MODELS_DIR/buffalo_l.zip"
BUFFALO_DIR="$MODELS_DIR/buffalo_l"
SWAP_URL="https://huggingface.co/ModelsLab/inswapper/resolve/main/inswapper_128.onnx"
SWAP_FILE="$MODELS_DIR/inswapper_128.onnx"
SWAP_EXPECTED=555302286

log() { echo "[download-models] $*"; }

buffalo_ok() { [ -f "$BUFFALO_DIR/det_10g.onnx" ]; }
swap_ok() {
  [ -f "$SWAP_FILE" ] || return 1
  local sz; sz=$(stat -c%s "$SWAP_FILE" 2>/dev/null || echo 0)
  [ "$sz" -ge 500000000 ]
}

# [1/2] buffalo_l detector ---------------------------------------------------
if buffalo_ok; then
  log "buffalo_l OK ($(du -sh "$BUFFALO_DIR" | cut -f1)) — skip"
else
  log "buffalo_l missing — downloading (~288MB, resumable)..."
  for i in 1 2 3 4 5 6 7 8 9 10; do
    wget -c -q --timeout=60 --tries=1 "$BUFFALO_ZIP_URL" -O "$BUFFALO_ZIP.part" && break
    log "retry $i (have $(stat -c%s "$BUFFALO_ZIP.part" 2>/dev/null || echo 0) bytes)"
    sleep 2
  done
  if [ -s "$BUFFALO_ZIP.part" ]; then
    mv "$BUFFALO_ZIP.part" "$BUFFALO_ZIP"
    mkdir -p "$BUFFALO_DIR"
    unzip -oq "$BUFFALO_ZIP" -d "$BUFFALO_DIR"
    # some zips are flat — ensure the 5 onnx files sit INSIDE buffalo_l/
    if ! buffalo_ok && [ -f "$MODELS_DIR/det_10g.onnx" ]; then
      mv "$MODELS_DIR"/*.onnx "$BUFFALO_DIR/" 2>/dev/null
    fi
  fi
  buffalo_ok && log "buffalo_l restored ✓" || { log "FATAL: buffalo_l still missing"; exit 1; }
fi

# [2/2] inswapper_128.onnx ---------------------------------------------------
if swap_ok; then
  log "inswapper_128.onnx OK ($(du -sh "$SWAP_FILE" | cut -f1)) — skip"
else
  log "inswapper_128.onnx missing — downloading (~555MB, resumable)..."
  for i in 1 2 3 4 5 6 7 8 9 10; do
    wget -c -q --timeout=60 --tries=1 "$SWAP_URL" -O "$SWAP_FILE.part" && break
    log "retry $i (have $(stat -c%s "$SWAP_FILE.part" 2>/dev/null || echo 0) bytes)"
    sleep 2
  done
  if [ -s "$SWAP_FILE.part" ]; then
    sz=$(stat -c%s "$SWAP_FILE.part")
    if [ "$sz" -ge 500000000 ]; then mv "$SWAP_FILE.part" "$SWAP_FILE"; fi
  fi
  swap_ok && log "inswapper_128.onnx restored ✓" || { log "FATAL: swap model still missing (got $sz bytes)"; exit 1; }
fi

log "ALL MODELS READY — face swap can start"
