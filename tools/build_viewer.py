"""Build a static, backend-free VertexLab viewer for any HTTPS static host."""
import hashlib
import json
import shutil
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '_site'
OUT.mkdir(exist_ok=True)
for source in (ROOT / 'public').iterdir():
    if source.is_file():
        shutil.copy2(source, OUT / source.name)
for name in ('cars.json', 'car-brands.json', 'THIRD_PARTY_NOTICES.md'):
    shutil.copy2(ROOT / name, OUT / name)
html = (ROOT / 'public/index.html').read_text(encoding='utf-8')
html = html.replace('<body>', '<body class="browser-viewer" data-mode="viewer" data-session-open="false">')
html = html.replace('</head>', '<meta name="theme-color" content="#141014"><link rel="manifest" href="manifest.webmanifest"><link rel="apple-touch-icon" href="icon-192.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="VertexLab"></head>')
html = html.replace('<script src="timeline.js">', '<script src="browser-core.js"></script><script src="browser-library.js"></script><script src="browser-runtime.js"></script><script src="timeline.js">')
(OUT / 'index.html').write_text(html, encoding='utf-8')
(OUT / '.nojekyll').write_text('')


def icon(size):
    points = [(70, 80), (145, 80), (256, 360), (366, 80), (442, 80), (287, 442), (223, 442)]
    def inside(x, y):
        value = False
        for i, (ax, ay) in enumerate(points):
            bx, by = points[i-1]
            if (ay > y) != (by > y) and x < (bx-ax)*(y-ay)/(by-ay)+ax:
                value = not value
        return value
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            rows.extend((245, 65, 91, 255) if inside(x*512/size,y*512/size) else (16, 13, 19, 255))
    def chunk(kind, data):
        return struct.pack('>I', len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b'')


for size in (192, 512):
    (OUT / f'icon-{size}.png').write_bytes(icon(size))
(OUT / 'manifest.webmanifest').write_text(json.dumps(dict(name='VertexLab', short_name='VertexLab',
    description='Video y telemetría sincronizados desde tus archivos .vrtx', start_url='./', scope='./',
    display='standalone', background_color='#100d13', theme_color='#141014', lang='es',
    icons=[dict(src=f'icon-{size}.png',sizes=f'{size}x{size}',type='image/png',purpose='any maskable') for size in (192,512)]),ensure_ascii=False),encoding='utf-8')
files = sorted(p.name for p in OUT.iterdir() if p.is_file() and p.name != 'sw.js' and not p.name.startswith('.'))
revision = hashlib.sha256(b''.join((OUT / name).read_bytes() for name in files)).hexdigest()[:16]
worker = """const CACHE='vertexlab-viewer-REVISION',FILES=PRECACHE;
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES.map(name=>new Request(new URL(name,self.registration.scope).href,{cache:'reload'}))))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('vertexlab-viewer-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).catch(()=>caches.match(new URL('index.html',self.registration.scope).href)));return;}
event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(event.request))||fetch(event.request)));});
""".replace('REVISION',revision).replace('PRECACHE',json.dumps(files))
(OUT / 'sw.js').write_text(worker,encoding='utf-8')
print(f'Visor estático listo: {OUT} ({len(files)} archivos, revisión {revision})')
