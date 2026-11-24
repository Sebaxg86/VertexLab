@echo off
cd /d "%~dp0"
powershell -NoProfile -Command "$app=Get-ChildItem -LiteralPath 'native\artifacts' -Filter 'VertexLab.Desktop.exe' -Recurse -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1; if($app){Start-Process -FilePath $app.FullName; exit 0}; exit 1"
if not errorlevel 1 exit /b 0
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
