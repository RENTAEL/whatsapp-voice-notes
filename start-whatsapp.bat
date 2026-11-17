@echo off
rem Double-click once to link WhatsApp: scan the QR code with your phone.
rem After that, just ask Claude to listen to a voice note - nothing runs in the background.
cd /d "%~dp0whatsapp"
if not exist node_modules call npm install --no-fund --no-audit
node bridge.mjs link
pause
