"""Cloud sync client for VertexLab (Supabase Auth/Index + component-based Google Drive)."""
import gzip
import json
import mimetypes
import os
import re
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from portable import META_KEYS, VIDEO_TYPES, validate_meta, validate_rows
from session_preview import second_lap_preview

DRIVE_API = 'https://www.googleapis.com/drive/v3'
DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder'
DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
HEX32_RE = re.compile(r'^[0-9a-f]{32}$')
DRIVE_ID_RE = re.compile(r'^[A-Za-z0-9_-]{8,128}$')


class CloudError(ValueError):
    """User-facing cloud sync error."""


def _http_request(url, method='GET', headers=None, data=None, timeout=30):
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, dict(resp.headers.items()), resp.read()
    except urllib.error.HTTPError as err:
        body = err.read()
        return err.code, dict(err.headers.items()), body
    except urllib.error.URLError as err:
        raise CloudError('Sin conexión con el servicio en la nube: ' + str(err.reason)) from err


def _json_or_error(status, body, fallback='Error en el servicio en la nube'):
    try:
        parsed = json.loads(body.decode('utf-8')) if body else {}
    except Exception:
        parsed = {}
    if 200 <= status < 300:
        return parsed
    message = (
        parsed.get('error_description')
        or (parsed.get('error') if isinstance(parsed.get('error'), str) else None)
        or (parsed.get('error', {}).get('message') if isinstance(parsed.get('error'), dict) else None)
        or parsed.get('message')
        or fallback
    )
    raise CloudError(f'{message} (HTTP {status})')


class DriveClient:
    """Minimal Google Drive v3 client using stdlib urllib and resumable uploads."""

    def __init__(self, access_token, http=_http_request, chunk_size=8 * 1024 * 1024):
        if not access_token:
            raise CloudError('Falta token de acceso de Google Drive')
        self.access_token = access_token
        self.http = http
        self.chunk_size = max(256 * 1024, chunk_size)

    def _headers(self, extra=None):
        headers = {'Authorization': f'Bearer {self.access_token}'}
        if extra:
            headers.update(extra)
        return headers

    def create_folder(self, name, parent_id=None):
        meta = {'name': name, 'mimeType': DRIVE_FOLDER_MIME}
        if parent_id:
            if not DRIVE_ID_RE.match(parent_id):
                raise CloudError('ID de carpeta padre inválido')
            meta['parents'] = [parent_id]
        status, _, body = self.http(
            f'{DRIVE_API}/files?fields=id,name',
            method='POST',
            headers=self._headers({'Content-Type': 'application/json; charset=utf-8'}),
            data=json.dumps(meta).encode('utf-8'),
        )
        return _json_or_error(status, body, 'No se pudo crear la carpeta en Google Drive')

    def list_folders(self, parent_id=None):
        query = f"mimeType='{DRIVE_FOLDER_MIME}' and trashed=false"
        if parent_id:
            if not DRIVE_ID_RE.match(parent_id):
                raise CloudError('ID de carpeta inválido')
            query += f" and '{parent_id}' in parents"
        params = urllib.parse.urlencode({
            'q': query,
            'fields': 'files(id,name,modifiedTime)',
            'orderBy': 'name',
            'pageSize': 100,
        })
        status, _, body = self.http(f'{DRIVE_API}/files?{params}', method='GET', headers=self._headers())
        return _json_or_error(status, body, 'No se pudieron listar carpetas de Google Drive').get('files', [])

    def upload_bytes(self, payload, name, mime_type, parent_id):
        if not DRIVE_ID_RE.match(parent_id or ''):
            raise CloudError('Carpeta de destino de Google Drive inválida')
        total = len(payload)
        meta = {'name': name, 'parents': [parent_id]}
        status, headers, body = self.http(
            f'{DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,name,size',
            method='POST',
            headers=self._headers({
                'Content-Type': 'application/json; charset=utf-8',
                'X-Upload-Content-Type': mime_type,
                'X-Upload-Content-Length': str(total),
            }),
            data=json.dumps(meta).encode('utf-8'),
        )
        _json_or_error(status, body, f'No se pudo iniciar la subida de {name}')
        upload_url = next((v for k, v in headers.items() if k.lower() == 'location'), None)
        if not upload_url:
            raise CloudError('Google Drive no devolvió la URL de subida')
        put_headers = {'Content-Type': mime_type, 'Content-Length': str(total)}
        if total > 0:
            put_headers['Content-Range'] = f'bytes 0-{total - 1}/{total}'
        status, _, body = self.http(upload_url, method='PUT', headers=put_headers, data=payload, timeout=120)
        return _json_or_error(status, body, f'Error al subir {name}')

    def upload_file(self, path, name, mime_type, parent_id, progress=None):
        """Stream a file from disk to Google Drive in chunks without copying or loading into RAM."""
        path = Path(path)
        if not path.is_file():
            raise CloudError(f'No se encontró el archivo local: {path.name}')
        if not DRIVE_ID_RE.match(parent_id or ''):
            raise CloudError('Carpeta de destino de Google Drive inválida')
        total = path.stat().st_size
        if total == 0:
            return self.upload_bytes(b'', name, mime_type, parent_id)

        meta = {'name': name, 'parents': [parent_id]}
        status, headers, body = self.http(
            f'{DRIVE_UPLOAD_API}/files?uploadType=resumable&fields=id,name,size',
            method='POST',
            headers=self._headers({
                'Content-Type': 'application/json; charset=utf-8',
                'X-Upload-Content-Type': mime_type,
                'X-Upload-Content-Length': str(total),
            }),
            data=json.dumps(meta).encode('utf-8'),
        )
        _json_or_error(status, body, f'No se pudo iniciar la subida de {name}')
        upload_url = next((v for k, v in headers.items() if k.lower() == 'location'), None)
        if not upload_url:
            raise CloudError('Google Drive no devolvió la URL de subida')

        offset = 0
        with path.open('rb') as stream:
            while offset < total:
                chunk = stream.read(self.chunk_size)
                if not chunk:
                    break
                end = offset + len(chunk) - 1
                status, _, body = self.http(
                    upload_url,
                    method='PUT',
                    headers={
                        'Content-Type': mime_type,
                        'Content-Length': str(len(chunk)),
                        'Content-Range': f'bytes {offset}-{end}/{total}',
                    },
                    data=chunk,
                    timeout=180,
                )
                offset = end + 1
                if progress:
                    progress(offset, total)
                if status in (200, 201):
                    return _json_or_error(status, body, f'Error al finalizar subida de {name}')
                if status != 308:
                    _json_or_error(status, body, f'Error al subir fragmento de {name}')
        raise CloudError(f'La subida de {name} terminó sin confirmación de Google Drive')

    def download_bytes(self, file_id):
        if not DRIVE_ID_RE.match(file_id or ''):
            raise CloudError('ID de archivo de Google Drive inválido')
        status, _, body = self.http(
            f'{DRIVE_API}/files/{urllib.parse.quote(file_id)}?alt=media',
            method='GET',
            headers=self._headers(),
            timeout=120,
        )
        if not 200 <= status < 300:
            _json_or_error(status, body, 'No se pudo descargar el archivo desde Google Drive')
        return body

    def download_file(self, file_id, destination, total_size=None, chunk_size=4 * 1024 * 1024, progress=None):
        """Download a Drive file to destination atomically via byte ranges (or single stream if size unknown)."""
        if not DRIVE_ID_RE.match(file_id or ''):
            raise CloudError('ID de archivo de Google Drive inválido')
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        handle = tempfile.NamedTemporaryFile(dir=destination.parent, prefix='.cloud-dl-', delete=False)
        temp_path = Path(handle.name)
        handle.close()
        try:
            if total_size and total_size > chunk_size:
                offset = 0
                with temp_path.open('wb') as out:
                    while offset < total_size:
                        end = min(total_size - 1, offset + chunk_size - 1)
                        status, _, body = self.http(
                            f'{DRIVE_API}/files/{urllib.parse.quote(file_id)}?alt=media',
                            method='GET',
                            headers=self._headers({'Range': f'bytes={offset}-{end}'}),
                            timeout=180,
                        )
                        if status not in (200, 206):
                            _json_or_error(status, body, 'Error al descargar fragmento de video desde Google Drive')
                        out.write(body)
                        offset += len(body)
                        if progress:
                            progress(offset, total_size)
                        if not body:
                            break
            else:
                data = self.download_bytes(file_id)
                temp_path.write_bytes(data)
                if progress:
                    progress(len(data), len(data))
            os.replace(temp_path, destination)
            return destination
        except Exception:
            temp_path.unlink(missing_ok=True)
            raise

    def delete_file(self, file_id):
        if not DRIVE_ID_RE.match(file_id or ''):
            return
        status, _, body = self.http(
            f'{DRIVE_API}/files/{urllib.parse.quote(file_id)}',
            method='DELETE',
            headers=self._headers(),
        )
        if status not in (200, 204, 404):
            _json_or_error(status, body, 'No se pudo eliminar el archivo de Google Drive')


DEFAULT_SUPABASE_URL = 'https://enxifznsswmvnonvwlgc.supabase.co'
DEFAULT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVueGlmem5zc3dtdm5vbnZ3bGdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU3Mzg5NDMsImV4cCI6MjExMTMxNDk0M30.lJVsoTxfyl5QdDCgzl2_sAyybl8bC3D6qG0Oe2DGkW0'
DEFAULT_GOOGLE_CLIENT_ID = '420866989936-dq3an1aoh0p1uqqldof2g85a8d586rrd.apps.googleusercontent.com'


class CloudSyncService:
    """Coordinates Supabase Auth/index and Google Drive component storage for VertexLab."""

    def __init__(self, supabase_url=None, supabase_anon_key=None, google_client_id=None, http=_http_request):
        self.supabase_url = (
            os.environ.get('VERTEXLAB_SUPABASE_URL', DEFAULT_SUPABASE_URL)
            if supabase_url is None else supabase_url
        ).rstrip('/')
        self.supabase_anon_key = (
            os.environ.get('VERTEXLAB_SUPABASE_ANON_KEY', DEFAULT_SUPABASE_ANON_KEY)
            if supabase_anon_key is None else supabase_anon_key
        )
        self.google_client_id = (
            os.environ.get('VERTEXLAB_GOOGLE_CLIENT_ID', DEFAULT_GOOGLE_CLIENT_ID)
            if google_client_id is None else google_client_id
        )
        self.http = http
        self.user_jwt = None
        self.user = None
        self.profile = None
        self._drive_token = None
        self._drive_token_expiry = 0.0

    @property
    def configured(self):
        return bool(self.supabase_url and self.supabase_anon_key)

    def set_session(self, access_token, user=None, profile=None):
        self.user_jwt = access_token or None
        self.user = user
        self.profile = profile
        self._drive_token = None
        self._drive_token_expiry = 0.0

    def clear_session(self):
        self.set_session(None, None, None)

    def _sb_headers(self, extra=None):
        if not self.configured:
            raise CloudError('La sincronización en la nube aún no está configurada')
        if not self.user_jwt:
            raise CloudError('Inicia sesión en tu cuenta de VertexLab primero')
        headers = {
            'apikey': self.supabase_anon_key,
            'Authorization': f'Bearer {self.user_jwt}',
            'Content-Type': 'application/json',
        }
        if extra:
            headers.update(extra)
        return headers

    def status(self):
        profile = self.profile or {}
        return {
            'configured': self.configured,
            'signedIn': bool(self.user_jwt and self.user),
            'user': self.user,
            'driveConnected': bool(profile.get('drive_connected')),
            'driveEmail': profile.get('drive_email'),
            'driveRootFolderId': profile.get('drive_root_folder_id'),
            'driveRootFolderName': profile.get('drive_root_folder_name'),
            'googleClientId': self.google_client_id or None,
        }

    def fetch_profile(self):
        if not self.user or not self.user.get('id'):
            raise CloudError('Inicia sesión en tu cuenta de VertexLab primero')
        uid = urllib.parse.quote(str(self.user['id']))
        status, _, body = self.http(
            f'{self.supabase_url}/rest/v1/profiles?id=eq.{uid}&select=*',
            method='GET',
            headers=self._sb_headers(),
        )
        rows = _json_or_error(status, body, 'No se pudo cargar tu perfil de VertexLab')
        self.profile = rows[0] if rows else {}
        return self.profile

    def get_drive_token(self, force_refresh=False):
        if not force_refresh and self._drive_token and time.monotonic() < self._drive_token_expiry - 60:
            return self._drive_token
        status, _, body = self.http(
            f'{self.supabase_url}/functions/v1/drive-auth',
            method='POST',
            headers=self._sb_headers(),
            data=json.dumps({'action': 'token'}).encode('utf-8'),
        )
        data = _json_or_error(status, body, 'No se pudo obtener acceso a Google Drive')
        self._drive_token = data['accessToken']
        self._drive_token_expiry = time.monotonic() + float(data.get('expiresIn', 3600))
        if self.profile is None:
            self.profile = {}
        self.profile.update({
            'drive_connected': True,
            'drive_email': data.get('driveEmail'),
            'drive_root_folder_id': data.get('driveRootFolderId'),
            'drive_root_folder_name': data.get('driveRootFolderName'),
        })
        return self._drive_token

    def exchange_drive_code(self, code, redirect_uri, code_verifier=None):
        payload = {'action': 'exchange', 'code': code, 'redirectUri': redirect_uri}
        if code_verifier:
            payload['codeVerifier'] = code_verifier
        status, _, body = self.http(
            f'{self.supabase_url}/functions/v1/drive-auth',
            method='POST',
            headers=self._sb_headers(),
            data=json.dumps(payload).encode('utf-8'),
        )
        data = _json_or_error(status, body, 'No se pudo vincular Google Drive')
        self._drive_token = data['accessToken']
        self._drive_token_expiry = time.monotonic() + float(data.get('expiresIn', 3600))
        self.profile = {
            **(self.profile or {}),
            'drive_connected': True,
            'drive_email': data.get('driveEmail'),
            'drive_root_folder_id': data.get('driveRootFolderId'),
            'drive_root_folder_name': data.get('driveRootFolderName'),
        }
        return data

    def set_drive_folder(self, folder_id, folder_name='VertexLab'):
        status, _, body = self.http(
            f'{self.supabase_url}/functions/v1/drive-auth',
            method='POST',
            headers=self._sb_headers(),
            data=json.dumps({'action': 'folder', 'folderId': folder_id, 'folderName': folder_name}).encode('utf-8'),
        )
        data = _json_or_error(status, body, 'No se pudo guardar la carpeta de Google Drive')
        self.profile = {
            **(self.profile or {}),
            'drive_root_folder_id': data['driveRootFolderId'],
            'drive_root_folder_name': data['driveRootFolderName'],
        }
        return data

    def disconnect_drive(self):
        status, _, body = self.http(
            f'{self.supabase_url}/functions/v1/drive-auth',
            method='POST',
            headers=self._sb_headers(),
            data=json.dumps({'action': 'disconnect'}).encode('utf-8'),
        )
        _json_or_error(status, body, 'No se pudo desconectar Google Drive')
        self._drive_token = None
        self._drive_token_expiry = 0.0
        self.profile = {
            **(self.profile or {}),
            'drive_connected': False,
            'drive_email': None,
            'drive_root_folder_id': None,
            'drive_root_folder_name': None,
        }
        return {'connected': False}

    def list_cloud_sessions(self):
        if not self.configured or not self.user_jwt:
            return []
        status, _, body = self.http(
            f'{self.supabase_url}/rest/v1/cloud_sessions?select=*&order=created_epoch.desc,id.asc',
            method='GET',
            headers=self._sb_headers(),
        )
        return _json_or_error(status, body, 'No se pudieron cargar las sesiones en la nube')

    def sync_session(self, data_dir, sid, car_name_fn=None, brands=None, progress=None):
        """Upload a local session by components (meta.json + telemetry.jsonl.gz + original video) without duplicating files."""
        if not HEX32_RE.match(sid or ''):
            raise CloudError('ID de sesión inválido')
        data_dir = Path(data_dir)
        meta_path = data_dir / f'{sid}.json'
        telemetry_path = data_dir / f'{sid}.jsonl'
        if not meta_path.is_file() or not telemetry_path.is_file():
            raise CloudError('No se encontraron los archivos locales de esta sesión')

        meta = json.loads(meta_path.read_text(encoding='utf-8'))
        portable_meta = {k: v for k, v in meta.items() if k in META_KEYS}
        portable_meta.setdefault('version', 1)
        validate_meta(portable_meta)
        if portable_meta['version'] == 2 and not meta.get('ended'):
            raise CloudError('Finaliza la grabación antes de sincronizar con Google Drive')
        validate_rows(telemetry_path)

        video_path = Path(meta['videoPath']) if meta.get('videoPath') else None
        if video_path and (not video_path.is_file() or video_path.suffix.lower() not in VIDEO_TYPES):
            raise CloudError('El video asociado no existe en disco; no se subió una sesión incompleta')

        drive = DriveClient(self.get_drive_token(), http=self.http)
        root_folder_id = (self.profile or {}).get('drive_root_folder_id')
        if not root_folder_id:
            created_root = drive.create_folder('VertexLab')
            root_folder_id = created_root['id']
            self.set_drive_folder(root_folder_id, 'VertexLab')

        session_folder = drive.create_folder(sid, parent_id=root_folder_id)
        folder_id = session_folder['id']
        try:
            meta_bytes = json.dumps(portable_meta, ensure_ascii=False, allow_nan=False).encode('utf-8')
            meta_file = drive.upload_bytes(meta_bytes, 'meta.json', 'application/json', folder_id)

            compressed = gzip.compress(telemetry_path.read_bytes(), compresslevel=6)
            tel_file = drive.upload_bytes(compressed, 'telemetry.jsonl.gz', 'application/gzip', folder_id)

            video_file_id = None
            video_size = None
            video_mime = None
            video_name = None
            if video_path:
                ext = video_path.suffix.lower()
                video_name = f'video{ext}'
                video_mime = mimetypes.guess_type(video_name)[0] or 'video/mp4'
                video_size = video_path.stat().st_size
                uploaded_video = drive.upload_file(video_path, video_name, video_mime, folder_id, progress=progress)
                video_file_id = uploaded_video['id']

            preview = second_lap_preview(telemetry_path, manual=meta.get('automatic') is False)
            ordinal = int(meta.get('carOrdinal') or 0)
            row = {
                'user_id': self.user['id'],
                'id': sid,
                'name': portable_meta['name'],
                'car_ordinal': ordinal,
                'car_name': car_name_fn(ordinal) if car_name_fn else meta.get('carName'),
                'car_class': portable_meta.get('carClass'),
                'car_pi': portable_meta.get('carPI'),
                'brand': (brands or {}).get(str(ordinal)),
                'created_epoch': portable_meta['created'],
                'ended_epoch': portable_meta.get('ended'),
                'duration': portable_meta.get('duration'),
                'version': portable_meta.get('version', 2),
                'featured': bool(portable_meta.get('featured', False)),
                'sync_offset': float(portable_meta.get('offset') or 0),
                'preview': preview,
                'drive_folder_id': folder_id,
                'drive_meta_file_id': meta_file['id'],
                'drive_telemetry_file_id': tel_file['id'],
                'telemetry_size': len(compressed),
                'telemetry_encoding': 'gzip',
                'drive_video_file_id': video_file_id,
                'video_size': video_size,
                'video_mime': video_mime,
                'video_name': video_name,
            }
            status, _, body = self.http(
                f'{self.supabase_url}/rest/v1/cloud_sessions?on_conflict=user_id,id',
                method='POST',
                headers=self._sb_headers({'Prefer': 'resolution=merge-duplicates,return=representation'}),
                data=json.dumps(row, ensure_ascii=False).encode('utf-8'),
            )
            saved = _json_or_error(status, body, 'No se pudo registrar la sesión sincronizada')
            return saved[0] if isinstance(saved, list) and saved else row
        except Exception:
            try:
                drive.delete_file(folder_id)
            except Exception:
                pass
            raise

    def download_session(self, data_dir, cloud_row, progress=None):
        """Download a cloud session's components into data_dir without duplicating existing local files."""
        sid = cloud_row.get('id', '')
        if not HEX32_RE.match(sid):
            raise CloudError('ID de sesión en la nube inválido')
        data_dir = Path(data_dir)
        data_dir.mkdir(parents=True, exist_ok=True)
        meta_dest = data_dir / f'{sid}.json'
        telemetry_dest = data_dir / f'{sid}.jsonl'
        if meta_dest.exists() and telemetry_dest.exists():
            return {'id': sid, 'alreadyLocal': True}

        drive = DriveClient(self.get_drive_token(), http=self.http)
        meta_raw = drive.download_bytes(cloud_row['drive_meta_file_id'])
        meta = json.loads(meta_raw.decode('utf-8'))
        meta['id'] = sid
        if 'featured' in cloud_row:
            meta['featured'] = bool(cloud_row['featured'])
        if 'sync_offset' in cloud_row:
            meta['offset'] = float(cloud_row['sync_offset'] or 0)
        validate_meta(meta)

        tel_raw = drive.download_bytes(cloud_row['drive_telemetry_file_id'])
        if cloud_row.get('telemetry_encoding', 'gzip') == 'gzip':
            tel_raw = gzip.decompress(tel_raw)

        video_dest = None
        if cloud_row.get('drive_video_file_id'):
            vname = cloud_row.get('video_name') or 'video.mp4'
            ext = Path(vname).suffix.lower()
            if ext not in VIDEO_TYPES:
                ext = '.mp4'
            video_dest = data_dir / f'{sid}{ext}'
            drive.download_file(
                cloud_row['drive_video_file_id'],
                video_dest,
                total_size=cloud_row.get('video_size'),
                progress=progress,
            )
            meta['videoPath'] = str(video_dest.resolve())
        else:
            meta.pop('videoPath', None)

        temp_tel = data_dir / f'.{sid}.jsonl.tmp'
        temp_meta = data_dir / f'.{sid}.json.tmp'
        try:
            temp_tel.write_bytes(tel_raw)
            validate_rows(temp_tel)
            temp_meta.write_bytes(json.dumps(meta, ensure_ascii=False).encode('utf-8'))
            os.replace(temp_tel, telemetry_dest)
            os.replace(temp_meta, meta_dest)
        except Exception:
            temp_tel.unlink(missing_ok=True)
            temp_meta.unlink(missing_ok=True)
            if video_dest:
                video_dest.unlink(missing_ok=True)
            raise
        return {'id': sid, 'alreadyLocal': False, 'hasVideo': video_dest is not None}

    def update_cloud_metadata(self, sid, changes):
        if not HEX32_RE.match(sid or ''):
            raise CloudError('ID de sesión inválido')
        allowed = {k: v for k, v in changes.items() if k in ('featured', 'sync_offset', 'name')}
        if not allowed:
            return {'ok': True}
        uid = urllib.parse.quote(str(self.user['id']))
        status, _, body = self.http(
            f'{self.supabase_url}/rest/v1/cloud_sessions?user_id=eq.{uid}&id=eq.{sid}',
            method='PATCH',
            headers=self._sb_headers({'Prefer': 'return=representation'}),
            data=json.dumps(allowed, ensure_ascii=False).encode('utf-8'),
        )
        return _json_or_error(status, body, 'No se pudo actualizar la sesión en la nube')

    def delete_cloud_session(self, sid, drive_folder_id=None):
        if not HEX32_RE.match(sid or ''):
            raise CloudError('ID de sesión inválido')
        if drive_folder_id:
            drive = DriveClient(self.get_drive_token(), http=self.http)
            drive.delete_file(drive_folder_id)
        uid = urllib.parse.quote(str(self.user['id']))
        status, _, body = self.http(
            f'{self.supabase_url}/rest/v1/cloud_sessions?user_id=eq.{uid}&id=eq.{sid}',
            method='DELETE',
            headers=self._sb_headers(),
        )
        if status not in (200, 204):
            _json_or_error(status, body, 'No se pudo eliminar el registro en la nube')
        return {'ok': True}
