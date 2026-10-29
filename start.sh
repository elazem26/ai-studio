#!/bin/bash
# AI Studio — Start Script
# Runs face-swap service + Next.js dev server
# Press Ctrl+C to stop both

echo "🚀 Starting AI Studio..."
echo ""

# ===== 1. Check dependencies =====
echo "Checking dependencies..."

if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found — install from https://nodejs.org"
  exit 1
fi

if ! command -v python3 &> /dev/null; then
  echo "❌ Python 3 not found — install from https://python.org"
  exit 1
fi

if ! command -v ffmpeg &> /dev/null; then
  echo "❌ ffmpeg not found — install from https://ffmpeg.org"
  exit 1
fi

echo "✓ Node.js: $(node --version)"
echo "✓ Python: $(python3 --version)"
echo "✓ ffmpeg: $(ffmpeg -version 2>&1 | head -1)"
echo ""

# ===== 2. Check node_modules =====
if [ ! -d "node_modules" ]; then
  echo "Installing Node.js dependencies..."
  npm install
  echo ""
fi

# ===== 3. Check insightface =====
if ! python3 -c "import insightface" 2>/dev/null; then
  echo "Installing insightface..."
  pip3 install insightface onnxruntime opencv-python-headless numpy Pillow fastapi uvicorn
  echo ""
fi

# ===== 4. Check model file =====
MODEL_PATH="mini-services/face-swap-pro/models/inswapper_128.onnx"
if [ ! -f "$MODEL_PATH" ]; then
  echo "📥 Downloading face-swap model (530MB)..."
  mkdir -p mini-services/face-swap-pro/models
  wget -q -O "$MODEL_PATH" \
    "https://huggingface.co/ModelsLab/inswapper/resolve/main/inswapper_128.onnx"
  echo "✓ Model downloaded"
  echo ""
fi

# ===== 5. Start face-swap service =====
echo "Starting face-swap service (port 3030)..."
cd mini-services/face-swap-pro
python3 server.py &
FACE_PID=$!
cd ../..
sleep 3

# Check if it started
if curl -s http://localhost:3030/health 2>/dev/null | grep -q "ok"; then
  echo "✓ Face-swap service running (PID $FACE_PID)"
else
  echo "⚠ Face-swap service may not have started — check logs"
fi
echo ""

# ===== 6. Start Next.js =====
echo "Starting Next.js (port 3000)..."
npm run dev &
NEXT_PID=$!

# ===== 7. Wait and cleanup =====
echo ""
echo "============================================"
echo "  AI Studio running at http://localhost:3000"
echo "  Press Ctrl+C to stop"
echo "============================================"
echo ""

# Trap Ctrl+C to kill both processes
trap "echo ''; echo 'Stopping...'; kill $FACE_PID $NEXT_PID 2>/dev/null; exit 0" INT TERM
wait
