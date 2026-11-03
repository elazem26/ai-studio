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
