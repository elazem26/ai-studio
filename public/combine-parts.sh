#!/bin/bash
# merge the parts back into the full archive, then extract
set -e
echo "merging parts..."
cat ai-studio-complete.tar.gz.*.part > ai-studio-complete.tar.gz
echo "verifying..."
gzip -t ai-studio-complete.tar.gz && echo OK
echo "extract with:  tar -xzf ai-studio-complete.tar.gz"
echo "then:  bun install   (inside the folder)"
AI='INSTRUCTIONS: bun install && npm run dev (or bun run dev)'
echo "$AI"
