"""Build a static, backend-free VertexLab viewer for any HTTPS static host."""
import hashlib
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '_site'
OUT.mkdir(exist_ok=True)
for source in (ROOT / 'public').iterdir():
    if source.name in ('connect.html', 'connect.css', 'connect.js', 'connect-model.js'):
        (OUT / source.name).unlink(missing_ok=True)
        continue
    if source.is_file():
        shutil.copy2(source, OUT / source.name)
for name in ('cars.json', 'car-brands.json', 'THIRD_PARTY_NOTICES.md'):
    shutil.copy2(ROOT / name, OUT / name)
html = (ROOT / 'public/index.html').read_text(encoding='utf-8')
html = html.replace('<body class="home-view">', '<body class="home-view browser-viewer" data-mode="viewer" data-session-open="false">')
html = html.replace('</head>', '<meta name="theme-color" content="#141014"><link rel="manifest" href="manifest.webmanifest"><link rel="apple-touch-icon" href="icon-192.png"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="VertexLab"></head>')
html = html.replace('<script src="timeline.js">', '<script src="browser-core.js"></script><script src="browser-library.js"></script><script src="browser-runtime.js"></script><script src="timeline.js">')
# Keep the viewer's worker and its ZIP reader on the same revision as the page.
zip_worker_files = ('vendor-zip-2.25.0.js', 'vendor-sha256-4.13.0.js', 'browser-core.js', 'vrtx-reader.js')
versioned_assets = []
def version_worker_asset(name):
    digest = hashlib.sha256((OUT / name).read_bytes()).hexdigest()[:12]
    target = f'{name}?v={digest}'
    versioned_assets.append(target)
    return target

viewer_worker = OUT / 'viewer-worker.js'
worker_source = viewer_worker.read_text(encoding='utf-8')
for name in zip_worker_files:
    worker_source = worker_source.replace(f"'{name}'", repr(version_worker_asset(name)), 1)
viewer_worker.write_text(worker_source, encoding='utf-8')

media_worker = OUT / 'media-service-worker.js'
media_source = media_worker.read_text(encoding='utf-8')
for name in ('browser-library.js', 'browser-media.js'):
    media_source = media_source.replace(repr(name), repr(version_worker_asset(name)), 1)
media_worker.write_text(media_source, encoding='utf-8')
media_worker_url = version_worker_asset(media_worker.name)

runtime = OUT / 'browser-runtime.js'
runtime_source = runtime.read_text(encoding='utf-8')
runtime.write_text(runtime_source.replace("'viewer-worker.js'", repr(version_worker_asset(viewer_worker.name)), 1), encoding='utf-8')

def version_asset(match):
    name = match.group(2)
    digest = hashlib.sha256((OUT / name).read_bytes()).hexdigest()[:12]
    target = name+'?v='+digest
    versioned_assets.append(target)
    return match.group(1)+'="'+target+'"'
# Existing installations may still have the previous cache-first service worker.
# Version entry assets so a new Home cannot run with old application scripts.
html = re.sub(r'(src|href)="([^"/?]+\.(?:js|css))"', version_asset, html)
(OUT / 'index.html').write_text(html, encoding='utf-8')
(OUT / '.nojekyll').write_text('')


(OUT / 'manifest.webmanifest').write_text(json.dumps(dict(id='./', name='VertexLab', short_name='VertexLab',
    description='Telemetría y video sincronizados de Forza en cualquier pantalla', start_url='./', scope='./',
    display='standalone', background_color='#08080a', theme_color='#141014', lang='es',
    icons=[dict(src=f'icon-{size}.png',sizes=f'{size}x{size}',type='image/png',purpose=purpose) for size in (192,512) for purpose in ('any','maskable')]),ensure_ascii=False),encoding='utf-8')
files = sorted(p.name for p in OUT.iterdir() if p.is_file() and p.name != 'sw.js' and not p.name.startswith('.'))
revision = hashlib.sha256(b''.join((OUT / name).read_bytes() for name in files)).hexdigest()[:16]
worker = """importScripts('MEDIA_WORKER_URL');
const CACHE='vertexlab-viewer-REVISION',FILES=PRECACHE;
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES.map(name=>new Request(new URL(name,self.registration.scope).href,{cache:'reload'})))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('vertexlab-viewer-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(url.origin!==self.location.origin)return;
const mediaPath=new URL('__vertex_media/',self.registration.scope).pathname;
if(url.pathname.startsWith(mediaPath)){const id=url.pathname.slice(mediaPath.length).split('/')[0];event.respondWith(/^[a-f0-9]{32}$/.test(id)&&['GET','HEAD'].includes(event.request.method)?localVideoResponse(event.request,id,event.clientId):Promise.resolve(new Response(null,{status:404})));return;}
if(event.request.method!=='GET')return;
if(event.request.mode==='navigate'){event.respondWith(fetch(event.request).catch(()=>caches.match(new URL('index.html',self.registration.scope).href)));return;}
event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(event.request))||fetch(event.request)));});
""".replace('MEDIA_WORKER_URL', media_worker_url).replace('REVISION', revision).replace(
    'PRECACHE', json.dumps(list(dict.fromkeys(files + versioned_assets))))
(OUT / 'sw.js').write_text(worker,encoding='utf-8')
print(f'Visor estático listo: {OUT} ({len(files)} archivos, revisión {revision})')
