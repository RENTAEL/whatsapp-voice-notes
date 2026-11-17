@echo off
rem Double-click to connect WhatsApp: scan the QR code with your phone the first time.
rem Optional: set ALLOW=27821234567 (only these numbers get replies), REPLY_IN_GROUPS=1
cd /d "%~dp0whatsapp"
if not exist node_modules call npm install --no-fund --no-audit
node bridge.mjs
pause
