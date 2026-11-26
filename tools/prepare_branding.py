"""Convert supplied branding to browser, Windows and installer asset formats.

Run with requirements-desktop.txt installed. Artwork is retained without cropping.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets' / 'branding'
PUBLIC = ROOT / 'public'
INSTALLER = ROOT / 'installer' / 'assets'
INSTALLER.mkdir(exist_ok=True)

favicon = Image.open(SOURCE / 'favicon.png').convert('RGBA')
app = Image.open(SOURCE / 'app-icon.png').convert('RGBA')
for name, image, sizes in [
    ('favicon.ico', favicon, [16, 24, 32, 48, 64]),
    ('vertexlab.ico', app, [16, 24, 32, 48, 64, 128, 256]),
]:
    image.save(PUBLIC / name, sizes=[(size, size) for size in sizes])
favicon.resize((64, 64), Image.Resampling.LANCZOS).save(PUBLIC / 'favicon.png')
for size in (192, 512):
    app.resize((size, size), Image.Resampling.LANCZOS).save(PUBLIC / f'icon-{size}.png')
for name in ('welcome', 'finished'):
    Image.open(SOURCE / f'{name}.png').convert('RGB').save(INSTALLER / f'{name}.bmp')
print('Branding ready: browser icons, Windows icon, and installer artwork.')
