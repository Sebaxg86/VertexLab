@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\pythonw.exe" (
  echo Primero prepara las dependencias con: python -m pip install -r requirements-desktop.txt
  pause
  exit /b 1
)
".venv\Scripts\python.exe" -c "import webview, pystray, PIL" >nul 2>&1
if errorlevel 1 (
  echo Instala las dependencias con: .venv\Scripts\python.exe -m pip install -r requirements-desktop.txt
  pause
  exit /b 1
)
start "" ".venv\Scripts\pythonw.exe" vertexconnect.py
