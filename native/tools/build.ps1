$ErrorActionPreference='Stop'
$nativeRoot=Split-Path -Parent $PSScriptRoot
$publish=Join-Path $nativeRoot 'artifacts\app'
dotnet publish (Join-Path $nativeRoot 'src\VertexLab.Desktop') -c Release -r win-x64 --self-contained true -o $publish -p:DebugType=None
if($LASTEXITCODE -ne 0){throw 'No se pudo publicar Desktop'}
dotnet publish (Join-Path $nativeRoot 'src\VertexLab.Capture') -c Release -r win-x64 --self-contained true -o $publish -p:DebugType=None
if($LASTEXITCODE -ne 0){throw 'No se pudo publicar Capture'}
python (Join-Path $PSScriptRoot 'make_installer.py')
if($LASTEXITCODE -ne 0){throw 'No se pudo preparar el instalador'}
$wix=Join-Path $nativeRoot '.tools\wix.exe'
if(!(Test-Path -LiteralPath $wix)){dotnet tool install wix --allow-roll-forward --version 4.0.6 --tool-path (Join-Path $nativeRoot '.tools')}
if($LASTEXITCODE -ne 0){throw 'No se pudo preparar WiX'}
& $wix build (Join-Path $nativeRoot 'artifacts\VertexLab.wxs') -arch x64 -o (Join-Path $nativeRoot 'artifacts\VertexLab-0.2.0-alpha.1-win-x64.msi')
if($LASTEXITCODE -ne 0){throw 'No se pudo construir el MSI'}
Write-Host 'Instalador nativo listo en native\artifacts'
