import argparse
from copy import copy
import json
import mimetypes
import os
import queue
import re
import socket
import threading
import time
import tempfile
import shutil
import uuid
import zipfile
from datetime import date
from pathlib import Path
from http.server import ThreadingHTTPServer as BaseHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, quote, parse_qs

from game_presence import GamePresence
from obs_control import OBS
from recorder import Recorder, car_name
from telemetry import decode, analyze
from session_preview import second_lap_preview
from portable import export_session, import_session, import_sessions, MAX_ARCHIVE, MAX_BATCH
from cloud_sync import CloudSyncService, DriveClient, CloudError

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
        self.last_known_car = None
        self.last_driving_packet = None
        self.game_presence = GamePresence()
        self.pending = queue.Queue(maxsize=20000)
        self.closed = threading.Event()
        self.worker = threading.Thread(target=self.run, daemon=True)
        self.worker.start()
        self.sock = None
        self.preview_cache = {}
        self.portable_exports = {}
        self.cloud = CloudSyncService()
        self.cloud_sessions_cache = {}
        self.cloud_open_cache = {}
        self.cloud_jobs = {}
        self.cloud_jobs_lock = threading.Lock()
        self.cloud_account_lock = threading.RLock()
        self.cloud_account_epoch = 0

    def status(self):
        with self.lock:
            result = self.recorder.status()
        with self.live_lock:
            result.update(self.live)
            result['lastKnownCar'] = self.last_known_car
            result['lastDrivingPacket'] = self.last_driving_packet
            result['packetAge'] = max(0, time.monotonic()-self.last_packet_monotonic) if self.last_packet_monotonic is not None else None
        result['gameRunning'] = self.game_presence.get()
        result['telemetryVersion'] = 2
        if result['packet']:
            result['carName'] = car_name(result['packet']['carOrdinal'])
        return result

    def session_path(self, sid):
        if not re.fullmatch('[0-9a-f]{32}', sid):
            raise ValueError('Sesión inválida')
        return self.data/(sid+'.json')

    def _attach_preview(self, meta):
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

    def sessions(self, offset=None, limit=None):
        with self.lock:
            sessions = sorted([json.loads(p.read_text(encoding='utf-8')) for p in self.data.glob('*.json')],
                              key=lambda s:s['created'], reverse=True)
        if offset is None:
            for meta in sessions:
                self._attach_preview(meta)
            return sessions
        keys = ('id', 'name', 'carName', 'carOrdinal', 'carClass', 'carPI', 'created',
                'ended', 'duration', 'version', 'featured', 'brand', 'preview')
        local_by_id = {meta['id']: meta for meta in sessions}
        by_id = {}
        for sid, meta in local_by_id.items():
            by_id[sid] = dict({k: meta[k] for k in keys if k in meta}, availability=dict(local=True, cloud=False))
        for sid, crow in self.cloud_sessions_cache.items():
            cloud_info = dict(
                driveFolderId=crow.get('drive_folder_id'),
                driveMetaFileId=crow.get('drive_meta_file_id'),
                driveTelemetryFileId=crow.get('drive_telemetry_file_id'),
                driveVideoFileId=crow.get('drive_video_file_id'),
                videoSize=crow.get('video_size'),
                videoMime=crow.get('video_mime'),
                videoName=crow.get('video_name'),
                telemetryEncoding=crow.get('telemetry_encoding', 'gzip'),
            )
            if sid in by_id:
                by_id[sid]['availability']['cloud'] = True
                by_id[sid]['featured'] = bool(by_id[sid].get('featured') or crow.get('featured'))
                by_id[sid]['cloud'] = cloud_info
            else:
                by_id[sid] = dict(
                    id=sid,
                    name=crow.get('name') or crow.get('car_name') or 'Sesión',
                    carName=crow.get('car_name') or car_name(crow.get('car_ordinal', 0)),
                    carOrdinal=crow.get('car_ordinal', 0),
                    carClass=crow.get('car_class'),
                    carPI=crow.get('car_pi'),
                    created=crow.get('created_epoch', 0),
                    ended=crow.get('ended_epoch'),
                    duration=crow.get('duration'),
                    version=crow.get('version', 2),
                    featured=bool(crow.get('featured')),
                    brand=BRANDS.get(str(crow.get('car_ordinal'))),
                    preview=crow.get('preview'),
                    availability=dict(local=False, cloud=True),
                    cloud=cloud_info,
                )
        ordered = sorted(by_id.values(), key=lambda s: (s.get('created') or 0, s['id']), reverse=True)
        total = len(ordered)
        items = ordered[offset:offset+limit]
        for item in items:
            if item['availability']['local'] and item['id'] in local_by_id:
                meta = local_by_id[item['id']]
                self._attach_preview(meta)
                item['carName'] = meta['carName']
                item['brand'] = meta['brand']
                item['preview'] = meta['preview']
        end = offset+len(items)
        return dict(items=items, total=total, nextOffset=end if end < total else None)

    def refresh_cloud_index(self):
        if not self.cloud.configured or not self.cloud.user_jwt:
            self.cloud_sessions_cache = {}
            return []
        rows = self.cloud.list_cloud_sessions()
        self.cloud_sessions_cache = {row['id']: row for row in rows if row.get('id')}
        return rows

    def cloud_action(self, action, body):
        with self.cloud_account_lock:
            return self._cloud_action(action, body)

    def _cloud_action(self, action, body):
        if action == 'session':
            token = str(body.get('accessToken') or '').strip()
            user = body.get('user') if isinstance(body.get('user'), dict) else None
            if not token or not user or not user.get('id'):
                raise ValueError('Sesión de cuenta inválida')
            if (self.cloud.user or {}).get('id') != user['id']:
                self.cloud_account_epoch += 1
                self.cloud_sessions_cache = {}
                self.cloud_open_cache.clear()
            self.cloud.set_session(token, user)
            self.cloud.fetch_profile()
            self.refresh_cloud_index()
            return self.cloud.status()
        if action == 'logout':
            self.cloud_account_epoch += 1
            self.cloud.clear_session()
            self.cloud_sessions_cache = {}
            self.cloud_open_cache.clear()
            return self.cloud.status()
        if action == 'refresh':
            self.cloud.fetch_profile()
            self.refresh_cloud_index()
            return self.cloud.status()
        if action == 'drive/exchange':
            result = self.cloud.exchange_drive_code(body.get('code'), body.get('redirectUri'), body.get('codeVerifier'))
            self.refresh_cloud_index()
            return result
        if action == 'drive/folder':
            if body.get('createName'):
                drive = DriveClient(self.cloud.get_drive_token(), http=self.cloud.http)
                created = drive.create_folder(str(body['createName']).strip()[:128], body.get('parentId') or None)
                return self.cloud.set_drive_folder(created['id'], created['name'])
            return self.cloud.set_drive_folder(body.get('folderId'), body.get('folderName', 'VertexLab'))
        if action == 'drive/disconnect':
            self.cloud_account_epoch += 1
            local_only = bool(body.get('localOnly')) or not self.cloud.user_jwt
            result = self.cloud.disconnect_drive(local_only=local_only)
            self.cloud_sessions_cache = {}
            self.cloud_open_cache.clear()
            return result
        if action.startswith('sync/'):
            sid = action.split('/', 1)[1]
            with self.lock:
                if self.recorder.meta and self.recorder.meta['id'] == sid:
                    raise ValueError('Finaliza la sesión antes de sincronizar con Google Drive')
            with self.cloud_jobs_lock:
                active = self.cloud_jobs.get(sid)
                if active and not active.get('done'):
                    return dict(ok=True, started=True, job=dict(active))
                job = dict(id=sid, action='upload', phase='Iniciando subida', percent=1, done=False, error=None)
                self.cloud_jobs[sid] = job
            cloud = copy(self.cloud)
            data_dir = self.data
            epoch = self.cloud_account_epoch
            def run_upload():
                def on_progress(phase, percent):
                    with self.cloud_jobs_lock:
                        self.cloud_jobs[sid].update(phase=phase, percent=max(0, min(99, int(percent))))
                try:
                    row = cloud.sync_session(data_dir, sid, car_name_fn=car_name, brands=BRANDS, progress=on_progress)
                    with self.cloud_account_lock:
                        if epoch == self.cloud_account_epoch:
                            self.cloud_sessions_cache[sid] = row
                    with self.cloud_jobs_lock:
                        self.cloud_jobs[sid].update(phase='Sincronizada con Google Drive', percent=100, done=True, error=None)
                except Exception as exc:
                    with self.cloud_jobs_lock:
                        self.cloud_jobs[sid].update(phase='Error al sincronizar', done=True, error=str(exc))
            threading.Thread(target=run_upload, daemon=True).start()
            return dict(ok=True, started=True, job=dict(job))
        if action.startswith('download/'):
            sid = action.split('/', 1)[1]
            crow = self.cloud_sessions_cache.get(sid)
            if not crow:
                self.refresh_cloud_index()
                crow = self.cloud_sessions_cache.get(sid)
            if not crow:
                raise ValueError('La sesión no se encontró en Google Drive')
            with self.cloud_jobs_lock:
                active = self.cloud_jobs.get(sid)
                if active and not active.get('done'):
                    return dict(ok=True, started=True, job=dict(active))
                job = dict(id=sid, action='download', phase='Iniciando descarga', percent=1, done=False, error=None)
                self.cloud_jobs[sid] = job
            cloud = copy(self.cloud)
            data_dir = self.data
            def run_download():
                def on_progress(phase, percent):
                    with self.cloud_jobs_lock:
                        self.cloud_jobs[sid].update(phase=phase, percent=max(0, min(99, int(percent))))
                try:
                    result = cloud.download_session(data_dir, crow, progress=on_progress)
                    with self.cloud_jobs_lock:
                        self.cloud_jobs[sid].update(
                            phase='Ya está en este dispositivo' if result.get('alreadyLocal') else 'Descargada en este dispositivo',
                            percent=100, done=True, error=None, alreadyLocal=result.get('alreadyLocal', False)
                        )
                except Exception as exc:
                    with self.cloud_jobs_lock:
                        self.cloud_jobs[sid].update(phase='Error al descargar', done=True, error=str(exc))
            threading.Thread(target=run_download, daemon=True).start()
            return dict(ok=True, started=True, job=dict(job))
        if action.startswith('delete/'):
            sid = action.split('/', 1)[1]
            if body.get('confirm') is not True:
                raise ValueError('Confirma la eliminación en Google Drive')
            crow = self.cloud_sessions_cache.get(sid)
            if not crow:
                self.refresh_cloud_index()
                crow = self.cloud_sessions_cache.get(sid)
            if not crow:
                raise ValueError('La sesión no se encontró en Google Drive')
            folder_id = crow.get('drive_folder_id')
            result = self.cloud.delete_cloud_session(sid, folder_id)
            self.cloud_sessions_cache.pop(sid, None)
            self.cloud_open_cache.pop(sid, None)
            return result
        raise ValueError('Acción de nube desconocida')

    @staticmethod
    def _cloud_info(crow):
        return dict(
            driveFolderId=crow.get('drive_folder_id'),
            driveMetaFileId=crow.get('drive_meta_file_id'),
            driveTelemetryFileId=crow.get('drive_telemetry_file_id'),
            driveVideoFileId=crow.get('drive_video_file_id'),
            videoSize=crow.get('video_size'),
            videoMime=crow.get('video_mime'),
            videoName=crow.get('video_name'),
            telemetryEncoding=crow.get('telemetry_encoding', 'gzip'),
        )

    def _get_cloud_row(self, sid):
        with self.cloud_account_lock:
            crow = self.cloud_sessions_cache.get(sid)
            if not crow and self.cloud.configured and self.cloud.user_jwt:
                self.refresh_cloud_index()
                crow = self.cloud_sessions_cache.get(sid)
            return dict(crow) if crow else None

    def read_session(self, sid):
        path = self.session_path(sid)
        with self.lock:
            local_exists = path.is_file() and path.with_suffix('.jsonl').is_file()
            if local_exists:
                meta = json.loads(path.read_text(encoding='utf-8'))
                rows = [json.loads(line) for line in path.with_suffix('.jsonl').read_text(encoding='utf-8').splitlines()]
        if local_exists:
            crow = self.cloud_sessions_cache.get(sid)
            meta['availability'] = dict(local=True, cloud=crow is not None)
            if crow:
                meta['cloud'] = self._cloud_info(crow)
            return dict(meta=meta, laps=analyze(rows))

        crow = self._get_cloud_row(sid)
        if not crow:
            raise FileNotFoundError('No se encontró la sesión')
        cache_key = (self.cloud_account_epoch, crow.get('drive_meta_file_id'), crow.get('drive_telemetry_file_id'))
        with self.cloud_account_lock:
            cached = self.cloud_open_cache.get(sid)
        if cached and cached[0] == cache_key:
            meta, laps = dict(cached[1]), cached[2]
        else:
            meta, rows = self.cloud.read_cloud_session(crow)
            laps = analyze(rows)
            with self.cloud_account_lock:
                if len(self.cloud_open_cache) >= 4:
                    self.cloud_open_cache.pop(next(iter(self.cloud_open_cache)))
                self.cloud_open_cache[sid] = (cache_key, dict(meta), laps)
        meta['featured'] = bool(crow.get('featured', meta.get('featured', False)))
        if 'sync_offset' in crow:
            meta['offset'] = float(crow.get('sync_offset') or 0)
        meta['carName'] = crow.get('car_name') or car_name(meta.get('carOrdinal', 0))
        meta['brand'] = BRANDS.get(str(meta.get('carOrdinal')))
        meta['availability'] = dict(local=False, cloud=True)
        meta['cloud'] = self._cloud_info(crow)
        return dict(meta=meta, laps=laps)

    def prepare_export(self, sid, view, expire=True):
        with self.lock:
            path = self.session_path(sid)
            if self.recorder.meta and self.recorder.meta['id'] == sid:
                raise ValueError('Finaliza la sesión antes de exportar')
            meta = json.loads(path.read_text(encoding='utf-8'))
            expired = [key for key, value in self.portable_exports.items() if time.monotonic()-value[2] > 1800]
            for key in expired:
                old = self.portable_exports.pop(key)
                old[0].unlink(missing_ok=True)
        handle = tempfile.NamedTemporaryFile(prefix='vertexlab-', suffix='.vrtx', delete=False)
        target = Path(handle.name)
        handle.close()
        try:
            export_session(meta, path.with_suffix('.jsonl'), target, view if view is not None else meta.get('portableView'))
        except Exception:
            target.unlink(missing_ok=True)
            raise
        token = uuid.uuid4().hex
        name = re.sub(r'[\x00-\x1f<>:"/\\|?*]', '_', meta['name']).strip()[:100] or 'Sesion'
        with self.lock:
            self.portable_exports[token] = (target, name + '.vrtx', time.monotonic())
        if expire:
            expiry = threading.Timer(1800, self.expire_export, args=(token,))
            expiry.daemon = True
            expiry.start()
        return dict(url='/api/portable/download/' + token, name=name + '.vrtx', bytes=target.stat().st_size)

    def prepare_exports(self, ids, day):
        if not isinstance(ids, list) or not 1 <= len(ids) <= MAX_BATCH or not all(isinstance(sid, str) for sid in ids) or len(set(ids)) != len(ids):
            raise ValueError('Selecciona entre 1 y 10000 sesiones distintas')
        for sid in ids:
            self.session_path(sid)
        if len(ids) == 1:
            return self.prepare_export(ids[0], None)
        if not isinstance(day, str):
            raise ValueError('Fecha de exportación inválida')
        day = date.fromisoformat(day).isoformat()
        handle = tempfile.NamedTemporaryFile(prefix='vertexlab-batch-', suffix='.zip', delete=False)
        target = Path(handle.name)
        handle.close()
        try:
            with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
                for index, sid in enumerate(ids, 1):
                    result = self.prepare_export(sid, None, expire=False)
                    token = result['url'].rsplit('/', 1)[-1]
                    with self.lock:
                        package, name, _ = self.portable_exports.pop(token)
                    try:
                        archive.write(package, f'{index:03d}-{name}')
                        if archive.fp.tell() > MAX_ARCHIVE:
                            raise ValueError('El ZIP supera el límite de 256 GiB')
                    finally:
                        package.unlink(missing_ok=True)
            name = 'VRTX-Sessions-' + day + '.zip'
            token = uuid.uuid4().hex
            with self.lock:
                self.portable_exports[token] = (target, name, time.monotonic())
            expiry = threading.Timer(1800, self.expire_export, args=(token,))
            expiry.daemon = True
            expiry.start()
            return dict(url='/api/portable/download/' + token, name=name, bytes=target.stat().st_size)
        except Exception:
            target.unlink(missing_ok=True)
            raise

    def expire_export(self, token):
        with self.lock:
            prepared = self.portable_exports.pop(token, None)
        if prepared:
            prepared[0].unlink(missing_ok=True)

    def sync_cloud_metadata(self, sid, changes, required=False):
        crow = self._get_cloud_row(sid)
        if not crow:
            if required:
                raise ValueError('No se encontró la sesión')
            return
        try:
            with self.cloud_account_lock:
                if not self.cloud.user_jwt:
                    if required:
                        raise ValueError('Inicia sesión en tu cuenta de VertexLab primero')
                    return
                self.cloud.update_cloud_metadata(sid, changes)
                if sid in self.cloud_sessions_cache:
                    self.cloud_sessions_cache[sid].update(changes)
        except Exception:
            if required:
                raise

    def command(self, name, body):
        done = threading.Event()
        result = {}
        self.pending.put(('command', name, body, done, result), timeout=2)
        if not done.wait(15):
            raise ValueError('La operación sigue pendiente; revisa el estado antes de repetirla')
        if 'error' in result:
            raise ValueError(result['error'])
        value = result.get('value', {'ok':True})
        if name.startswith('feature/') and isinstance(value, dict) and 'local' in value:
            sid = name.split('/')[-1]
            is_local = value.pop('local')
            self.sync_cloud_metadata(sid, {'featured': value['featured']}, required=not is_local)
        elif name.startswith('sync/') and isinstance(value, dict):
            sid = name.split('/')[-1]
            is_local = value.pop('local', True)
            self.sync_cloud_metadata(sid, {'sync_offset': value['offset']}, required=not is_local)
        return value

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
            sid = name.split('/')[-1]
            path = self.session_path(sid)
            if name.startswith('feature/'):
                featured = bool(body.get('featured'))
                if not path.is_file():
                    return dict(featured=featured, local=False)
                meta = json.loads(path.read_text(encoding='utf-8'))
                meta['featured'] = featured
                if r.meta and r.meta['id'] == meta['id']:
                    r.meta['featured'] = featured
                path.write_text(json.dumps(meta,ensure_ascii=False),encoding='utf-8')
                return dict(featured=featured, local=True)
            meta = json.loads(path.read_text(encoding='utf-8'))
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
            sid = name.split('/')[-1]
            path = self.session_path(sid)
            offset = float(body['offset'])
            if not -86400 < offset < 86400:
                raise ValueError('Desfase inválido')
            if not path.is_file():
                return dict(id=sid, offset=offset, local=False)
            meta = json.loads(path.read_text(encoding='utf-8'))
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
            if row['carOrdinal'] > 0:
                self.last_known_car = dict(ordinal=row['carOrdinal'], name=car_name(row['carOrdinal']),
                                           carClass=row['carClass'], carPI=row['carPI'],
                                           brand=BRANDS.get(str(row['carOrdinal'])))
            if row['active'] and row['carOrdinal'] > 0:
                self.last_driving_packet = row
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
        for path, _, _ in self.portable_exports.values():
            path.unlink(missing_ok=True)
        self.portable_exports.clear()


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
                if route.startswith('/api/portable/download/'):
                    return self.portable_download(route.split('/')[-1])
                if route == '/api/status':
                    return self.send(runtime.status())
                if route == '/api/cloud/status':
                    return self.send(runtime.cloud.status())
                if route == '/api/cloud/jobs':
                    with runtime.cloud_jobs_lock:
                        jobs = {k: dict(v) for k, v in runtime.cloud_jobs.items()}
                    return self.send({'jobs': jobs})
                if route == '/api/cloud/drive/folders':
                    drive = DriveClient(runtime.cloud.get_drive_token(), http=runtime.cloud.http)
                    query = parse_qs(urlparse(self.path).query)
                    parent = query.get('parentId', [None])[0]
                    return self.send({'folders': drive.list_folders(parent)})
                if route == '/api/sessions':
                    return self.send(runtime.sessions())
                if route == '/api/library':
                    query = parse_qs(urlparse(self.path).query)
                    offset = max(0, int(query.get('offset', ['0'])[0]))
                    limit = max(1, min(48, int(query.get('limit', ['12'])[0])))
                    return self.send(runtime.sessions(offset=offset, limit=limit))
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
                self.send_header('Cache-Control','no-cache')
                self.send_header('Content-Length',str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except CloudError as e:
                self.send({'error':str(e)}, e.status if isinstance(e.status, int) and 400 <= e.status < 600 else 502)
            except (ValueError, FileNotFoundError) as e:
                self.send({'error':str(e)},404)
            except ConnectionError:
                pass

        def do_HEAD(self):
            if not self.valid_host():
                self.send_response(403)
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            route = urlparse(self.path).path
            if route.startswith('/api/video/'):
                try:
                    return self.video(route.split('/')[-1], head_only=True)
                except (ValueError, FileNotFoundError, CloudError):
                    self.send_response(404)
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return
            self.send_response(405)
            self.send_header('Content-Length', '0')
            self.end_headers()

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

        def video(self, sid, head_only=False):
            # Only a file returned by OBS and saved in this session (or its Google Drive backup) can be served.
            session_file = runtime.session_path(sid)
            with runtime.lock:
                local_meta = json.loads(session_file.read_text(encoding='utf-8')) if session_file.is_file() else None
            if local_meta is None:
                return self.cloud_video(sid, head_only=head_only)
            if not local_meta.get('videoPath'):
                return self.send({'error':'La sesión no tiene video asociado'},404)
            path = Path(local_meta['videoPath'])
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
            if head_only:
                return
            with path.open('rb') as f:
                f.seek(start)
                left = end-start+1
                while left > 0:
                    chunk = f.read(min(left,256*1024))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)

        def cloud_video(self, sid, head_only=False):
            crow = runtime._get_cloud_row(sid)
            file_id = crow.get('drive_video_file_id') if crow else None
            if not file_id:
                return self.send({'error':'La sesión no tiene video asociado'},404)
            size = crow.get('video_size')
            mime = crow.get('video_mime') or mimetypes.guess_type(crow.get('video_name') or 'video.mp4')[0] or 'video/mp4'
            if not isinstance(size, int) or size < 1:
                return self.send({'error':'Tamaño de video en la nube desconocido'},404)
            header = self.headers.get('Range')
            if head_only and not header:
                self.send_response(200)
                self.send_header('Content-Type', mime)
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Content-Length', str(size))
                self.send_header('Cache-Control', 'private, max-age=60')
                self.end_headers()
                return
            window = 2 * 1024 * 1024
            if header:
                match = re.fullmatch(r'bytes=(\d*)-(\d*)', header)
                if not match or not any(match.groups()):
                    return self.send({'error':'Rango inválido'},416)
                a, b = match.groups()
                if a:
                    start = int(a)
                    requested_end = min(int(b), size - 1) if b else size - 1
                    end = min(requested_end, start + window - 1)
                else:
                    suffix = int(b)
                    start = max(0, size - suffix)
                    end = min(size - 1, start + window - 1)
                if start > end or start >= size:
                    self.send_response(416)
                    self.send_header('Content-Range', f'bytes */{size}')
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return
                if head_only:
                    self.send_response(206)
                    self.send_header('Content-Type', mime)
                    self.send_header('Accept-Ranges', 'bytes')
                    self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
                    self.send_header('Content-Length', str(end - start + 1))
                    self.end_headers()
                    return
                _, _, payload = runtime.cloud.read_drive_video_range(file_id, start, end)
                if not payload:
                    return self.send({'error':'Google Drive no devolvió datos del video'}, 502)
                actual_end = start + len(payload) - 1
                self.send_response(206)
                self.send_header('Content-Type', mime)
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Content-Range', f'bytes {start}-{actual_end}/{size}')
                self.send_header('Content-Length', str(len(payload)))
                self.send_header('Cache-Control', 'private, max-age=60')
                self.end_headers()
                self.wfile.write(payload)
                return
            end = min(size - 1, window - 1)
            _, _, payload = runtime.cloud.read_drive_video_range(file_id, 0, end)
            if not payload:
                return self.send({'error':'Google Drive no devolvió datos del video'}, 502)
            self.send_response(206 if end < size - 1 else 200)
            self.send_header('Content-Type', mime)
            self.send_header('Accept-Ranges', 'bytes')
            if end < size - 1:
                self.send_header('Content-Range', f'bytes 0-{len(payload) - 1}/{size}')
            self.send_header('Content-Length', str(len(payload)))
            self.send_header('Cache-Control', 'private, max-age=60')
            self.end_headers()
            self.wfile.write(payload)

        def portable_download(self, token):
            with runtime.lock:
                prepared = runtime.portable_exports.pop(token, None)
            if not prepared:
                return self.send({'error':'La descarga expiró; vuelve a exportar la sesión'},404)
            path, name, _ = prepared
            try:
                self.send_response(200)
                self.send_header('Content-Type','application/zip' if name.endswith('.zip') else 'application/vnd.vertexlab.session+zip')
                self.send_header('Content-Length',str(path.stat().st_size))
                self.send_header('Content-Disposition',"attachment; filename="+('Sesiones.zip' if name.endswith('.zip') else 'Sesion.vrtx')+"; filename*=UTF-8''"+quote(name))
                self.send_header('Cache-Control','no-store')
                self.end_headers()
                with path.open('rb') as stream:
                    shutil.copyfileobj(stream, self.wfile, 1024**2)
            finally:
                path.unlink(missing_ok=True)

        def portable_import(self, batch=False):
            size = int(self.headers.get('Content-Length',0))
            if size <= 0 or size > MAX_ARCHIVE:
                self.close_connection = True
                return self.send({'error':('Tamaño de ZIP inválido' if batch else 'Tamaño de archivo .vrtx inválido')+' (máximo 256 GiB)'},413)
            with tempfile.TemporaryFile() as temporary:
                remaining = size
                while remaining:
                    chunk = self.rfile.read(min(remaining,1024**2))
                    if not chunk:
                        raise ValueError('Se interrumpió la subida del archivo')
                    temporary.write(chunk)
                    remaining -= len(chunk)
                temporary.seek(0)
                result = (import_sessions if batch else import_session)(temporary, runtime.data)
            self.send(result)

        def do_POST(self):
            if not self.valid_host() or self.headers.get('Origin') not in (None,f'http://{self.headers.get("Host")}'):
                return self.send({'error':'Origen rechazado'},403)
            try:
                if self.path in ('/api/portable/import', '/api/portable/import-batch'):
                    return self.portable_import(self.path.endswith('import-batch'))
                size = int(self.headers.get('Content-Length',0))
                if size < 0 or size > (512 * 1024 if self.path == '/api/portable/export-batch' else 16384):
                    return self.send({'error':'Petición demasiado grande'},413)
                body = json.loads(self.rfile.read(size) or b'{}')
                if not isinstance(body,dict) or not self.path.startswith('/api/'):
                    raise ValueError('Petición inválida')
                if self.path == '/api/portable/export-batch':
                    return self.send(runtime.prepare_exports(body.get('ids'), body.get('date')))
                if self.path.startswith('/api/portable/export/'):
                    return self.send(runtime.prepare_export(self.path.split('/')[-1],body.get('view')))
                if self.path.startswith('/api/cloud/'):
                    return self.send(runtime.cloud_action(self.path[len('/api/cloud/'):], body))
                self.send(runtime.command(self.path[5:],body))
            except (ValueError,KeyError,OSError) as e:
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
    print(f'VertexLab: http://127.0.0.1:{args.port} | UDP {args.udp_host}:{args.udp_port}',flush=True)
    try:
        http.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        runtime.close()
        http.server_close()
