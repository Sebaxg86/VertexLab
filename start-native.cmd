@echo off
cd /d "%~dp0"
if exist "native\artifacts\app\VertexLab.Desktop.exe" (
    start "" "native\artifacts\app\VertexLab.Desktop.exe"
    exit /b 0
)
where dotnet >nul 2>nul
if errorlevel 1 (
    echo Instala el MSI de VertexLab o el SDK .NET 10 para compilar la version de desarrollo.
    pause
    exit /b 1
)
dotnet build native\VertexLab.sln
if errorlevel 1 (
    pause
    exit /b 1
)
start "" "native\src\VertexLab.Desktop\bin\Debug\net10.0-windows\VertexLab.Desktop.exe"
