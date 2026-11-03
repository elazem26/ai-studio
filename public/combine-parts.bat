@echo off
copy /b ai-studio-complete.tar.gz.*.part ai-studio-complete.tar.gz
echo Done: ai-studio-complete.tar.gz
echo Extract it with 7-Zip or WinRAR, then run: bun install && npm run dev
pause
