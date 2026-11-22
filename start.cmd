@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" python -m venv .venv
".venv\Scripts\python.exe" -c "import websocket" >nul 2>&1
if errorlevel 1 ".venv\Scripts\python.exe" -m pip install -r requirements.txt
".venv\Scripts\python.exe" server.py
pause
