"""Remove only known preferences/cache; never session libraries or recordings."""
import json
import os
from pathlib import Path
import shutil

PREFERENCES = ('connect.json', 'connect.tmp', 'window.json', 'window.tmp', 'settings.json', 'connect.log', 'obs-owned.json', 'obs-owned.tmp')
MEDIA = {'.jsonl', '.vrtx', '.mp4', '.mkv', '.mov', '.webm', '.m4v', '.avi'}


def linked(path):
    return path.is_symlink() or getattr(path, 'is_junction', lambda: False)()


def clean_preferences(root):
    root = Path(root)
    if linked(root):
        raise ValueError('No se limpia una carpeta de configuración redirigida.')
    if not root.exists():
        return
    cache = root / 'WebView'
    # A damaged config cannot prove where user data was stored: keep the cache.
    known = False
    protected = None
    try:
        config = json.loads((root / 'connect.json').read_text(encoding='utf-8'))
        if config.get('dataPath'):
            protected = Path(config['dataPath']).resolve()
            known = True
    except (OSError, ValueError, TypeError):
        pass
    safe = known and not linked(cache)
    resolved_cache = cache.resolve()
    if protected and (protected == resolved_cache or resolved_cache in protected.parents or protected in resolved_cache.parents):
        safe = False
    if safe and cache.exists():
        for directory, dirs, files in os.walk(cache, followlinks=False):
            if any(linked(Path(directory) / name) for name in dirs + files):
                safe = False
                break
            if any(Path(name).suffix.lower() in MEDIA for name in files):
                safe = False
                break
    if safe and cache.exists():
        shutil.rmtree(cache)
    for name in PREFERENCES:
        (root / name).unlink(missing_ok=True)
    # Unknown files, legacy library databases, backups and all session folders stay.
    try:
        root.rmdir()
    except OSError:
        pass


def main():
    try:
        clean_preferences(Path(os.environ['LOCALAPPDATA']) / 'VertexLab')
        return 0
    except (OSError, ValueError, KeyError):
        return 1
