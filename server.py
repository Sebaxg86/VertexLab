import argparse
import json
import mimetypes
import os
import queue
import re
import socket
import threading
import time
from pathlib import Path
from http.server import ThreadingHTTPServer as BaseHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

from obs_control import OBS
from recorder import Recorder, car_name
from telemetry import decode, analyze
from session_preview import second_lap_preview

ROOT = Path(__file__).resolve().parent
BRANDS = json.loads((ROOT/'car-brands.json').read_text(encoding='utf-8')) if (ROOT/'car-brands.json').exists() else {}


class ThreadingHTTPServer(BaseHTTPServer):
    # Windows address reuse can let two RaceLab processes share the HTTP port.
    allow_reuse_address = os.name != 'nt'

    def server_bind(self):
        if os.name == 'nt':
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class Runtime:
    def __init__(self, data, obs=None):
        self.data = Path(data)
        self.recorder = Recorder(self.data, obs or OBS())
        self.lock = threading.RLock()
        self.live_lock = threading.Lock()
        self.live = dict(packet=None, packets=0, invalid=0, dropped=0, lastPacket=None, udpError=None)
        self.last_packet_monotonic = None
        self.pending = queue.Queue(maxsize=20000)
        self.closed = threading.Event()
        self.worker = threading.Thread(target=self.run, daemon=True)
        self.worker.start()
        self.sock = None
        self.preview_cache = {}

    def status(self):
        with self.lock:
            result = self.recorder.status()
        with self.live_lock:
            result.update(self.live)
            result['packetAge'] = max(0, time.monotonic()-self.last_packet_monotonic) if self.last_packet_monotonic is not None else None
        result['telemetryVersion'] = 2
        if result['packet']:
            result['carName'] = car_name(result['packet']['carOrdinal'])
        return result

    def session_path(self, sid):
        if not re.fullmatch('[0-9a-f]{32}', sid):
            raise ValueError('Sesión inválida')
        return self.data/(sid+'.json')

    def sessions(self):
        with self.lock:
            sessions = sorted([json.loads(p.read_text(encoding='utf-8')) for p in self.data.glob('*.json')],
                              key=lambda s:s['created'], reverse=True)
        for meta in sessions:
            meta['carName'] = car_name(meta.get('carOrdinal', 0))
            meta['brand'] = BRANDS.get(str(meta.get('carOrdinal')))
            path = self.data/(meta['id']+'.jsonl')
            try:
                stat = path.stat()
                signature = (stat.st_mtime_ns, stat.st_size)
                cached = self.preview_cache.get(meta['id'])
                if not cached or cached[0] != signature:
                    cached = (signature, second_lap_preview(path, manual=meta.get('automatic') is False))
                    self.preview_cache[meta['id']] = cached
                meta['preview'] = cached[1]
            except FileNotFoundError:
                meta['preview'] = None
        return sessions

    def read_session(self, sid):
        with self.lock:
            path = self.session_path(sid)
            meta = json.loads(path.read_text(encoding='utf-8'))
            rows = [json.loads(line) for line in path.with_suffix('.jsonl').read_text(encoding='utf-8').splitlines()]
        return dict(meta=meta, laps=analyze(rows))

    def command(self, name, body):
        done = threading.Event()
        result = {}
        self.pending.put(('command', name, body, done, result), timeout=2)
        if not done.wait(15):
            raise ValueError('La operación sigue pendiente; revisa el estado antes de repetirla')
        if 'error' in result:
            raise ValueError(result['error'])
        return result.get('value', {'ok':True})

    def execute(self, name, body):
        r = self.recorder
        if name == 'start':
            return dict(id=r.begin(time.monotonic(), name=str(body.get('name') or '')[:120] or None, manual=True))
        if name == 'stop':
            r.finish()
        elif name == 'auto':
            r.auto = bool(body.get('enabled'))
            if not r.meta:
                r.mode = 'armed' if r.auto else 'idle'
        elif name == 'obs':
            if r.meta:
                raise ValueError('Termina la sesión antes de configurar OBS')
            r.obs.connect(body.get('port',4455), str(body.get('password','')))
            r.error = None
        elif name == 'obs-disable':
            if r.meta or r.obs.owned:
                raise ValueError('Finaliza la grabación antes de desconectar OBS')
            r.obs.enabled = False
            r.obs.disconnect()
        elif name.startswith('feature/') or name.startswith('delete/'):
            path = self.session_path(name.split('/')[-1])
            meta = json.loads(path.read_text(encoding='utf-8'))
            if name.startswith('feature/'):
                meta['featured'] = bool(body.get('featured'))
                if r.meta and r.meta['id'] == meta['id']:
                    r.meta['featured'] = meta['featured']
                path.write_text(json.dumps(meta,ensure_ascii=False),encoding='utf-8')
                return dict(featured=meta['featured'])
            if body.get('confirm') is not True:
                raise ValueError('Confirma la eliminación de la sesión y su video')
            if r.meta and r.meta['id'] == meta['id']:
                raise ValueError('Finaliza la grabación antes de eliminarla')
            video = Path(meta['videoPath']).resolve() if meta.get('videoPath') else None
            if video:
                if video.suffix.lower() not in ('.mp4','.mkv','.mov','.webm','.flv','.ts','.m4v'):
                    raise ValueError('El archivo asociado no es un video reconocido')
                for other in self.data.glob('*.json'):
                    if other == path:
                        continue
                    shared = json.loads(other.read_text(encoding='utf-8')).get('videoPath')
                    if shared and Path(shared).resolve() == video:
                        raise ValueError('Otra sesión utiliza este video; no se puede eliminar junto con esta sesión')
            try:
                # Delete video first: an OBS/browser file lock must leave the session intact.
                if video:
                    video.unlink(missing_ok=True)
                path.with_suffix('.jsonl').unlink(missing_ok=True)
                path.unlink()
            except OSError as error:
                raise ValueError('No se pudo eliminar. Cierra el video en otros programas e inténtalo de nuevo.') from error
            self.preview_cache.pop(meta['id'],None)
            if r.last_saved == meta['id']:
                r.last_saved = None
            return dict(ok=True)
        elif name.startswith('sync/'):
            path = self.session_path(name.split('/')[-1])
            meta = json.loads(path.read_text(encoding='utf-8'))
            offset = float(body['offset'])
            if not -86400 < offset < 86400:
                raise ValueError('Desfase inválido')
            if r.meta and r.meta['id'] == meta['id']:
                raise ValueError('Espera a que termine la sesión para ajustar la sincronización')
            meta['offset'] = offset
            path.write_text(json.dumps(meta,ensure_ascii=False),encoding='utf-8')
            return meta
        else:
            raise ValueError('Operación desconocida')
        return {'ok':True}

    def run(self):
        while not self.closed.is_set():
            try:
                task = self.pending.get(timeout=.1)
            except queue.Empty:
                with self.lock:
                    try:
                        self.recorder.heartbeat(time.monotonic())
                    except Exception as e:
                        self.recorder.error = 'Error de registro: '+str(e)
                continue
            with self.lock:
                if task[0] == 'packet':
                    try:
                        self.recorder.heartbeat(task[2])
                        self.recorder.feed(task[1], task[2])
                    except Exception as e:
                        self.recorder.error = 'Error de registro: '+str(e)
                else:
                    _, name, body, done, result = task
                    try:
                        result['value'] = self.execute(name, body)
                    except Exception as e:
                        result['error'] = str(e)
                    finally:
                        done.set()
            self.pending.task_done()

    def ingest(self, raw, wall=None):
        wall = time.monotonic() if wall is None else wall
        try:
            row = decode(raw)
        except ValueError:
            with self.live_lock:
                self.live['invalid'] += 1
            return
        with self.live_lock:
            self.live.update(packet=row, lastPacket=time.time())
            self.last_packet_monotonic = time.monotonic()
            self.live['packets'] += 1
        try:
            self.pending.put_nowait(('packet',row,wall))
        except queue.Full:
            with self.live_lock:
                self.live['dropped'] += 1

    def listen(self, host, port):
        self.sock = socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
        if os.name == 'nt':
            self.sock.setsockopt(socket.SOL_SOCKET,socket.SO_EXCLUSIVEADDRUSE,1)
        self.sock.setsockopt(socket.SOL_SOCKET,socket.SO_RCVBUF,1024*1024)
        self.sock.settimeout(.2)
        try:
            self.sock.bind((host,port))
            while not self.closed.is_set():
                try:
                    raw,_ = self.sock.recvfrom(65535)
                    self.ingest(raw)
                except socket.timeout:
                    continue
        except OSError as e:
            if not self.closed.is_set():
                with self.live_lock:
                    self.live['udpError'] = str(e)

    def close(self):
        self.command('stop',{})
        self.closed.set()
        if self.sock:
            self.sock.close()
        self.worker.join(timeout=3)
        self.recorder.obs.disconnect()


def handler_for(runtime):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def log_message(self, *_):
            pass

        def send(self, value, status=200):
            payload = json.dumps(value, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Content-Type','application/json; charset=utf-8')
            self.send_header('Cache-Control','no-store')
            self.send_header('Content-Length',str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def valid_host(self):
            return self.headers.get('Host') in (f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}')

        def do_GET(self):
            if not self.valid_host():
                return self.send({'error':'Host rechazado'},403)
            route = urlparse(self.path).path
            try:
                if route == '/api/status':
                    return self.send(runtime.status())
                if route == '/api/sessions':
                    return self.send(runtime.sessions())
                if route.startswith('/api/sessions/'):
                    return self.send(runtime.read_session(route.split('/')[-1]))
                if route.startswith('/api/video/'):
                    return self.video(route.split('/')[-1])
                if route == '/events':
                    return self.events()
                path = ROOT/'public'/('index.html' if route == '/' else route.lstrip('/'))
                if path.resolve().parent != (ROOT/'public').resolve():
                    return self.send({'error':'No encontrado'},404)
                payload = path.read_bytes()
                self.send_response(200)
                self.send_header('Content-Type',mimetypes.guess_type(str(path))[0] or 'application/octet-stream')
                self.send_header('Content-Length',str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except (ValueError, FileNotFoundError) as e:
                self.send({'error':str(e)},404)
            except ConnectionError:
                pass

        def events(self):
            self.send_response(200)
            self.send_header('Content-Type','text/event-stream')
            self.send_header('Cache-Control','no-cache')
            self.send_header('Connection','close')
            self.end_headers()
            try:
                while not runtime.closed.is_set():
                    payload = json.dumps(runtime.status(),ensure_ascii=False)
                    self.wfile.write(('data: '+payload+'\n\n').encode())
                    self.wfile.flush()
                    runtime.closed.wait(.1)
            except ConnectionError:
                pass
            self.close_connection = True

        def video(self, sid):
            # Only a file returned by OBS and saved in this session can be served.
            with runtime.lock:
                meta = json.loads(runtime.session_path(sid).read_text(encoding='utf-8'))
            if not meta.get('videoPath'):
                return self.send({'error':'La sesión no tiene video asociado'},404)
            path = Path(meta['videoPath'])
            if not path.is_file():
                return self.send({'error':'No se encuentra el archivo guardado por OBS'},404)
            size = path.stat().st_size
            start, end = 0, size-1
            header = self.headers.get('Range')
            if header:
                match = re.fullmatch(r'bytes=(\d*)-(\d*)',header)
                if not match or not any(match.groups()):
                    return self.send({'error':'Rango inválido'},416)
                a,b = match.groups()
                start,end = (int(a),min(int(b) if b else size-1,size-1)) if a else (max(0,size-int(b)),size-1)
                if start > end or start >= size:
                    self.send_response(416)
                    self.send_header('Content-Range',f'bytes */{size}')
                    self.send_header('Content-Length','0')
                    self.end_headers()
                    return
            self.send_response(206 if header else 200)
            self.send_header('Content-Type',mimetypes.guess_type(str(path))[0] or 'video/mp4')
            self.send_header('Accept-Ranges','bytes')
            self.send_header('Content-Length',str(max(0,end-start+1)))
            if header:
                self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
            self.end_headers()
            with path.open('rb') as f:
                f.seek(start)
                left = end-start+1
                while left > 0:
                    chunk = f.read(min(left,256*1024))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)

        def do_POST(self):
            if not self.valid_host() or self.headers.get('Origin') not in (None,f'http://{self.headers.get("Host")}'):
                return self.send({'error':'Origen rechazado'},403)
            try:
                size = int(self.headers.get('Content-Length',0))
                if size < 0 or size > 16384:
                    return self.send({'error':'Petición demasiado grande'},413)
                body = json.loads(self.rfile.read(size) or b'{}')
                if not isinstance(body,dict) or not self.path.startswith('/api/'):
                    raise ValueError('Petición inválida')
                self.send(runtime.command(self.path[5:],body))
            except (ValueError,KeyError,FileNotFoundError) as e:
                self.send({'error':str(e)},400)
    return Handler


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--udp-host',default='127.0.0.1')
    parser.add_argument('--udp-port',type=int,default=5301)
    parser.add_argument('--port',type=int,default=8765)
    args = parser.parse_args()
    runtime = Runtime(ROOT/'data')
    http = ThreadingHTTPServer(('127.0.0.1',args.port),handler_for(runtime))
    http.daemon_threads = True
    threading.Thread(target=runtime.listen,args=(args.udp_host,args.udp_port),daemon=True).start()
    print(f'RaceLab: http://127.0.0.1:{args.port} | UDP {args.udp_host}:{args.udp_port}',flush=True)
    try:
        http.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        runtime.close()
        http.server_close()
