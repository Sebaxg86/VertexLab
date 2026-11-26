"""Build the Windows companion plus its shared offline web interface."""
import subprocess
import sys
import shutil
from importlib.metadata import distribution
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if sys.platform != 'win32':
    raise SystemExit('Build VertexConnect on Windows')
licenses = ROOT/'build'/'licenses'
licenses.mkdir(parents=True, exist_ok=True)
for name in ['pywebview', 'pystray', 'Pillow', 'pythonnet', 'clr_loader', 'cffi',
             'websocket-client', 'bottle', 'proxy_tools', 'typing_extensions', 'six', 'pycparser']:
    package = distribution(name)
    for file in package.files or []:
        if file.name.lower().startswith(('license', 'copying')):
            destination = licenses/name/file.name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(package.locate_file(file), destination)
python_license = Path(sys.base_prefix)/'LICENSE.txt'
if python_license.exists():
    shutil.copy2(python_license, licenses/'Python-LICENSE.txt')
command = [sys.executable, '-m', 'PyInstaller', '--noconfirm', '--windowed', '--onedir',
           '--name', 'VertexConnect', '--icon', str(ROOT/'public/vertexlab.ico'), '--distpath', str(ROOT/'dist'),
           '--workpath', str(ROOT/'build'), '--specpath', str(ROOT/'build'),
           '--collect-all', 'webview', '--collect-all', 'pystray', '--hidden-import', 'pystray._win32',
           '--add-data', f'{licenses}:licenses']
for name in ['public', 'cars.json', 'car-brands.json', 'THIRD_PARTY_NOTICES.md']:
    command += ['--add-data', f'{ROOT/name}:.'] if name != 'public' else ['--add-data', f'{ROOT/name}:public']
subprocess.run(command+[str(ROOT/'vertexconnect.py')], cwd=ROOT, check=True)
print('Build ready: dist/VertexConnect/VertexConnect.exe')
