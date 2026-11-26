"""Versioned .vrtx archives. Streaming I/O; never extract paths supplied by a ZIP."""
import hashlib
import json
import math
import os
import shutil
import tempfile
import uuid
import zipfile
from pathlib import Path
from pathlib import PurePosixPath
import stat

FORMAT = 'VertexLab session'
VERSION = 1
MAX_ARCHIVE = 256 * 1024**3
VIDEO_TYPES = {'.mp4', '.mkv', '.mov', '.webm', '.flv', '.ts', '.m4v'}
MAX_BATCH = 10000


def import_sessions(source, data):
    """Validate all packages in isolation before publishing any session."""
    data = Path(data)
    data.mkdir(parents=True, exist_ok=True)
    published = []
    try:
        with tempfile.TemporaryDirectory(prefix='.vrtx-batch-', dir=data) as temporary:
            stage = Path(temporary)
            with zipfile.ZipFile(source) as archive:
                entries = archive.infolist()
                if len(entries) > MAX_BATCH * 2:
                    raise ValueError('El ZIP admite hasta 10000 sesiones')
                names = set()
                packages = []
                for info in entries:
                    path = PurePosixPath(info.filename)
                    if ('\\' in info.filename or ':' in info.filename or path.is_absolute()
                            or '..' in path.parts or stat.S_ISLNK(info.external_attr >> 16)
                            or info.flag_bits & 1 or info.filename.casefold() in names):
                        raise ValueError('El ZIP contiene rutas, duplicados o entradas no permitidas')
                    names.add(info.filename.casefold())
                    if not info.is_dir():
                        if path.suffix.lower() != '.vrtx':
                            raise ValueError('El ZIP debe contener únicamente archivos .vrtx')
                        packages.append(info)
                total = sum(info.file_size for info in packages)
                if not packages or len(packages) > MAX_BATCH or total > MAX_ARCHIVE:
                    raise ValueError('ZIP vacío o demasiado grande (máximo 10000 sesiones y 256 GiB)')
                if shutil.disk_usage(data).free < total * 2 + 64 * 1024**2:
                    raise ValueError('No hay espacio suficiente para importar el ZIP')
                results = []
                for info in packages:
                    package = stage / 'incoming.vrtx'
                    with archive.open(info) as stream, package.open('wb') as target:
                        shutil.copyfileobj(stream, target, 1024**2)
                    results.append(import_session(package, stage))
                    package.unlink()
            for result in results:
                meta_path = stage / (result['id'] + '.json')
                meta = read_json(meta_path.read_bytes())
                if meta.get('videoPath'):
                    source_video = Path(meta['videoPath'])
                    destination = data / source_video.name
                    os.replace(source_video, destination)
                    published.append(destination)
                    meta['videoPath'] = str(destination.resolve())
                rows = data / (result['id'] + '.jsonl')
                os.replace(stage / rows.name, rows)
                published.append(rows)
                meta_path.write_bytes(json_bytes(meta))
                destination = data / meta_path.name
                os.replace(meta_path, destination)
                published.append(destination)
            return {'sessions': results, 'count': len(results)}
    except (zipfile.BadZipFile, OSError, ValueError, RuntimeError, EOFError) as error:
        for path in reversed(published):
            path.unlink(missing_ok=True)
        raise ValueError('No se pudo importar el ZIP: ' + str(error)) from error
META_KEYS = {'id', 'name', 'created', 'ended', 'duration', 'offset', 'version',
             'carOrdinal', 'carClass', 'carPI', 'automatic', 'events',
             'syncSegments', 'syncState', 'featured'}


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False).encode('utf-8')


def read_json(raw):
    def invalid(value):
        raise ValueError('El archivo contiene números inválidos')
    def number(value):
        parsed = float(value)
        if not math.isfinite(parsed):
            invalid(value)
        return parsed
    return json.loads(raw, parse_constant=invalid, parse_float=number)


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validate_meta(meta):
    if not isinstance(meta, dict) or not isinstance(meta.get('name'), str) or len(meta['name']) > 256:
        raise ValueError('Metadatos de sesión inválidos')
    if not finite(meta.get('created')) or meta.get('version', 1) not in (1, 2):
        raise ValueError('Versión o fecha de sesión inválida')
    for key in ('offset', 'duration', 'ended', 'carOrdinal', 'carClass', 'carPI'):
        if meta.get(key) is not None and not finite(meta[key]):
            raise ValueError('Metadatos numéricos inválidos')
    segments = meta.get('syncSegments', [])
    if not isinstance(segments, list):
        raise ValueError('Sincronización inválida')
    for segment in segments:
        if not isinstance(segment, dict) or not all(finite(segment.get(k)) for k in ('tStart', 'tEnd', 'videoStart')) or segment['tEnd'] < segment['tStart']:
            raise ValueError('Tramos de sincronización inválidos')


def validate_rows(path):
    count, previous = 0, -math.inf
    with path.open('rb') as stream:
        while line := stream.readline(2 * 1024**2 + 1):
            if len(line) > 2 * 1024**2:
                raise ValueError('Muestra de telemetría demasiado grande')
            row = read_json(line)
            if not isinstance(row, dict) or not all(finite(row.get(k)) for k in ('t', 'timestamp', 'lap', 'x', 'z', 'speed')):
                raise ValueError('Muestra de telemetría inválida')
            if row['t'] < previous or row['t'] < 0:
                raise ValueError('La telemetría no tiene una línea de tiempo válida')
            previous = row['t']
            count += 1
    if not count:
        raise ValueError('La sesión no contiene telemetría')
    return count


def export_session(meta, telemetry, destination, view=None):
    """Keep raw telemetry/video bytes; omit machine-specific paths and OBS settings."""
    metadata = {key: value for key, value in meta.items() if key in META_KEYS}
    metadata.setdefault('version', 1)
    if isinstance(view, dict) and finite(view.get('offset')):
        metadata['offset'] = view['offset']
    validate_meta(metadata)
    if metadata['version'] == 2 and not meta.get('ended'):
        raise ValueError('Finaliza la grabación antes de exportar')
    if len(json_bytes(metadata)) > 4 * 1024**2 or Path(telemetry).stat().st_size > 4 * 1024**3:
        raise ValueError('Los metadatos o la telemetría superan el límite portable')
    validate_rows(Path(telemetry))
    view = view if isinstance(view, dict) else {}
    if len(json_bytes(view)) > 65536:
        raise ValueError('Estado de análisis demasiado grande')
    video = Path(meta['videoPath']) if meta.get('videoPath') else None
    if video and (not video.is_file() or video.suffix.lower() not in VIDEO_TYPES):
        raise ValueError('No se encuentra el video asociado; no se exportó una sesión incompleta')
    files = {}
    with zipfile.ZipFile(destination, 'w', allowZip64=True) as archive:
        def add(name, stream, compression):
            info = zipfile.ZipInfo(name)
            info.compress_type = compression
            digest, size = hashlib.sha256(), 0
            with archive.open(info, 'w', force_zip64=True) as target:
                while chunk := stream.read(1024**2):
                    size += len(chunk)
                    if size > MAX_ARCHIVE:
                        raise ValueError('La sesión supera el límite portable de 256 GiB')
                    digest.update(chunk)
                    target.write(chunk)
            files[name] = {'size': size, 'sha256': digest.hexdigest()}
        import io
        add('session.json', io.BytesIO(json_bytes(metadata)), zipfile.ZIP_DEFLATED)
        add('view.json', io.BytesIO(json_bytes(view)), zipfile.ZIP_DEFLATED)
        with Path(telemetry).open('rb') as stream:
            add('telemetry.jsonl', stream, zipfile.ZIP_DEFLATED)
        video_member = 'video' + video.suffix.lower() if video else None
        if video:
            with video.open('rb') as stream:
                add(video_member, stream, zipfile.ZIP_STORED)
        if sum(item['size'] for item in files.values()) > MAX_ARCHIVE:
            raise ValueError('La sesión supera el límite portable de 256 GiB')
        archive.writestr('manifest.json', json_bytes({'format': FORMAT, 'version': VERSION,
                           'files': files, 'video': video_member}), compress_type=zipfile.ZIP_DEFLATED)


def import_session(source, data):
    """Stage, verify sizes, SHA256 and samples, then publish a fresh session ID."""
    data = Path(data)
    data.mkdir(parents=True, exist_ok=True)
    sid = uuid.uuid4().hex
    published = []
    try:
        with tempfile.TemporaryDirectory(prefix='.vrtx-import-', dir=data) as temporary:
            stage = Path(temporary)
            with zipfile.ZipFile(source) as archive:
                infos = archive.infolist()
                names = [info.filename for info in infos]
                if len(names) != len(set(names)) or len(names) > 5 or 'manifest.json' not in names:
                    raise ValueError('Contenido portable inválido o duplicado')
                if archive.getinfo('manifest.json').file_size > 65536:
                    raise ValueError('Manifiesto demasiado grande')
                manifest = read_json(archive.read('manifest.json'))
                if not isinstance(manifest, dict) or manifest.get('format') != FORMAT or manifest.get('version') != VERSION:
                    raise ValueError('Este formato o versión .vrtx no es compatible')
                video_member = manifest.get('video')
                allowed = {'session.json', 'view.json', 'telemetry.jsonl'}
                if video_member is not None:
                    if video_member not in {'video' + ext for ext in VIDEO_TYPES}:
                        raise ValueError('Nombre del video portable inválido')
                    allowed.add(video_member)
                files = manifest.get('files')
                if not isinstance(files, dict) or set(files) != allowed or set(names) != allowed | {'manifest.json'}:
                    raise ValueError('Faltan archivos o hay rutas no permitidas en el paquete')
                total = sum(info.file_size for info in infos)
                if total > MAX_ARCHIVE or shutil.disk_usage(data).free < total + 64 * 1024**2:
                    raise ValueError('No hay espacio suficiente o la sesión supera 256 GiB')
                for name in allowed:
                    info, expected = archive.getinfo(name), files[name]
                    limit = 65536 if name == 'view.json' else 4 * 1024**2 if name == 'session.json' else 4 * 1024**3 if name == 'telemetry.jsonl' else MAX_ARCHIVE
                    if info.file_size > limit or not isinstance(expected, dict) or expected.get('size') != info.file_size:
                        raise ValueError('Tamaño de archivo portable inválido')
                    digest, written = hashlib.sha256(), 0
                    with archive.open(name) as stream, (stage / name).open('wb') as target:
                        while chunk := stream.read(1024**2):
                            written += len(chunk)
                            if written > info.file_size:
                                raise ValueError('Archivo portable desbordado')
                            digest.update(chunk)
                            target.write(chunk)
                    if written != info.file_size or digest.hexdigest() != expected.get('sha256'):
                        raise ValueError('El archivo .vrtx está incompleto o dañado')
            meta = read_json((stage / 'session.json').read_bytes())
            validate_meta(meta)
            view = read_json((stage / 'view.json').read_bytes())
            if not isinstance(view, dict):
                raise ValueError('Estado de análisis inválido')
            count = validate_rows(stage / 'telemetry.jsonl')
            meta = {key: value for key, value in meta.items() if key in META_KEYS}
            meta.update(id=sid, portableSourceId=meta.get('id'), portableView=view, imported=True, videoPath=None)
            if video_member:
                video_path = data / (sid + Path(video_member).suffix)
                os.replace(stage / video_member, video_path)
                published.append(video_path)
                meta['videoPath'] = str(video_path.resolve())
            rows_path = data / (sid + '.jsonl')
            os.replace(stage / 'telemetry.jsonl', rows_path)
            published.append(rows_path)
            (stage / 'session.json').write_bytes(json_bytes(meta))
            meta_path = data / (sid + '.json')
            os.replace(stage / 'session.json', meta_path)
            published.append(meta_path)
        return {'id': sid, 'samples': count, 'hasVideo': bool(video_member)}
    except (zipfile.BadZipFile, UnicodeError, KeyError, TypeError, RuntimeError, OSError, ValueError, EOFError, RecursionError, OverflowError) as error:
        for path in reversed(published):
            path.unlink(missing_ok=True)
        raise ValueError('No se pudo importar .vrtx: ' + str(error)) from error
