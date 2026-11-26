"""Per-user Connect settings. OBS credentials are protected by Windows DPAPI."""
import base64
import ctypes
import json
import os
from pathlib import Path


def protect_password(value, decrypt=False):
    if not value:
        return ''
    if os.name != 'nt':
        raise ValueError('Guardar credenciales requiere Windows')
    class Blob(ctypes.Structure):
        _fields_ = [('size', ctypes.c_uint32), ('data', ctypes.POINTER(ctypes.c_ubyte))]
    raw = base64.b64decode(value) if decrypt else value.encode('utf-8')
    buffer = ctypes.create_string_buffer(raw)
    source = Blob(len(raw), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    target = Blob()
    crypt = ctypes.windll.crypt32
    operation = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    if not operation(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise ValueError('Windows no pudo proteger o recuperar la contraseña de OBS')
    try:
        result = ctypes.string_at(target.data, target.size)
        return result.decode('utf-8') if decrypt else base64.b64encode(result).decode('ascii')
    finally:
        ctypes.windll.kernel32.LocalFree(target.data)


class ConnectConfig:
    def __init__(self, path=None, default_data=None):
        self.path = Path(path) if path else Path(os.environ.get('LOCALAPPDATA', Path.home()))/'VertexLab'/'connect.json'
        self.values = dict(version=1, complete=False, udpPort=5301, obsPort=4455,
                           telemetryOnly=False, auto=True, obsSecret='',
                           dataPath=str(default_data or Path.home()/'Documents'/'VertexLab'/'Sessions'))
        if self.path.exists():
            saved = json.loads(self.path.read_text(encoding='utf-8'))
            if saved.get('version') != 1:
                raise ValueError('Configuración de VertexConnect no compatible')
            self.values.update({k: v for k, v in saved.items() if k in self.values})
        self.port(self.values['udpPort'])
        self.port(self.values['obsPort'])

    @staticmethod
    def port(value):
        if isinstance(value, bool) or not str(value).isdigit() or not 1024 <= int(value) <= 65535:
            raise ValueError('Usa un puerto entre 1024 y 65535')
        return int(value)

    def save(self, **changes):
        updated = dict(self.values, **changes)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix('.tmp')
        temporary.write_text(json.dumps(updated, ensure_ascii=False), encoding='utf-8')
        temporary.replace(self.path)
        self.values = updated

    def password(self):
        return protect_password(self.values['obsSecret'], decrypt=True)
