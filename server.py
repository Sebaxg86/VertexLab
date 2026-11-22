import argparse
import json
import socket
import threading
import time
import uuid
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
from telemetry import decode, analyze

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'
DATA.mkdir(exist_ok=True)
lock = threading.RLock()
state = dict(recording=None, packets=0, invalid=0, lastPacket=None, udpError=None)
writer = None
start = 0

def receive(host, port):
    global writer
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.bind((host, port))
    except OSError as e:
        state['udpError'] = str(e)
        return
    while True:
        raw, _ = sock.recvfrom(65535)
        with lock:
            try:
                row = decode(raw)
            except ValueError:
                state['invalid'] += 1
                continue
            state['packets'] += 1
            state['lastPacket'] = time.time()
            if writer and row['active']:
                row['t'] = time.monotonic()-start
                writer.write(json.dumps(row)+'\n')
                writer.flush()

def session_path(sid):
    if len(sid) != 32 or any(c not in '0123456789abcdef' for c in sid):
        raise ValueError('Invalid session id')
    return DATA / (sid+'.json')

class Handler(BaseHTTPRequestHandler):
    def send(self, value, status=200):
        payload = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        route = urlparse(self.path).path
        try:
            if route == '/api/status':
                with lock: self.send(dict(state))
            elif route == '/api/sessions':
                self.send(sorted([json.loads(p.read_text()) for p in DATA.glob('*.json')], key=lambda x:x['created'], reverse=True))
            elif route.startswith('/api/sessions/'):
                path = session_path(route.split('/')[-1])
                meta = json.loads(path.read_text())
                rows = [json.loads(line) for line in path.with_suffix('.jsonl').read_text().splitlines()]
                self.send(dict(meta=meta, laps=analyze(rows)))
            else:
                path = ROOT / 'public' / ('index.html' if route == '/' else route.lstrip('/'))
                if path.resolve().parent != (ROOT/'public').resolve():
                    return self.send({'error':'Not found'},404)
                payload = path.read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'}.get(path.suffix,'application/octet-stream'))
                self.send_header('Content-Length',str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        except (ValueError, FileNotFoundError) as e:
            self.send({'error':str(e)},404)

    def do_POST(self):
        global writer, start
        # Reject cross-origin browser writes to the local service.
        if self.headers.get('Origin') not in (None, f'http://{self.headers.get("Host")}'):
            return self.send({'error':'Origin rejected'},403)
        try:
            size = int(self.headers.get('Content-Length',0))
            if size > 16384: return self.send({'error':'Body too large'},413)
            body = json.loads(self.rfile.read(size) or b'{}')
            with lock:
                if self.path == '/api/start':
                    if writer: return self.send({'error':'Already recording'},409)
                    sid = uuid.uuid4().hex
                    path = session_path(sid)
                    path.write_text(json.dumps(dict(id=sid, name=str(body.get('name') or 'Sesión')[:120],created=time.time(),offset=0)))
                    writer = path.with_suffix('.jsonl').open('a', encoding='utf-8')
                    start = time.monotonic()
                    state['recording'] = sid
                    self.send({'id':sid})
                elif self.path == '/api/stop':
                    if writer: writer.close()
                    writer = None
                    state['recording'] = None
                    self.send({'ok':True})
                elif self.path.startswith('/api/sync/'):
                    path = session_path(self.path.split('/')[-1])
                    meta = json.loads(path.read_text())
                    offset = float(body['offset'])
                    if not -86400 < offset < 86400: raise ValueError('Invalid offset')
                    meta['offset'] = offset
                    path.write_text(json.dumps(meta))
                    self.send(meta)
                else: self.send({'error':'Not found'},404)
        except (ValueError, KeyError, FileNotFoundError) as e:
            self.send({'error':str(e)},400)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--udp-host',default='127.0.0.1')
    parser.add_argument('--udp-port',type=int,default=5301)
    parser.add_argument('--port',type=int,default=8765)
    args = parser.parse_args()
    threading.Thread(target=receive,args=(args.udp_host,args.udp_port),daemon=True).start()
    print(f'RaceLab: http://127.0.0.1:{args.port} | UDP {args.udp_host}:{args.udp_port}',flush=True)
    ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
