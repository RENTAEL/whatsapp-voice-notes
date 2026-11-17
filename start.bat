@echo off
rem Double-click to open the voice-notes web app (first run sets everything up).
cd /d "%~dp0"
start "" http://localhost:8765
python scripts\run.py || py scripts\run.py
pause
