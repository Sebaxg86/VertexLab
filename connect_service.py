"""Capture service used by the Windows companion, sharing the existing web app."""
import os
import socket
import threading
import time
from pathlib import Path

from connect_config import ConnectConfig, protect_password
from server import Runtime


class ConnectRuntime(Runtime):
    def __init__(self, config, obs=None):
        self.config = config
        self.forza_confirmed = False
        self.udp_port = config.values['udpPort']
        self.udp_thread = None
        self.udp_stop = threading.Event()
        self.setup_error = None
        self.show_window = None
        self.monitor_stop = threading.Event()
        self.monitor_thread = None
        super().__init__(config.values['dataPath'], obs)
        self.recorder.auto = False
        self.recorder.mode = 'idle'

    def ready(self):
        obs = self.recorder.obs
        return self.config.values['complete'] and not self.live['udpError'] and (self.config.values['telemetryOnly'] or (obs.enabled and obs.ws is not None))

    def restore(self):
        if self.config.values['complete'] and not self.config.values['telemetryOnly']:
            try:
                self.recorder.obs.connect(self.config.values['obsPort'], self.config.password())
            except ValueError as error:
                self.setup_error = str(error)
        self.recorder.auto = self.ready() and self.config.values['auto']
        self.recorder.mode = 'armed' if self.recorder.auto else 'idle'
        self.bind_udp(self.udp_port)
        if self.monitor_thread is None:
            self.monitor_thread = threading.Thread(target=self.watch_obs, daemon=True)
            self.monitor_thread.start()

    def watch_obs(self):
        while not self.monitor_stop.wait(2):
            if not self.lock.acquire(blocking=False):
                continue
            try:
                obs = self.recorder.obs
                probe = getattr(obs, 'probe_connection', None)
                if obs.ws is not None and probe and not probe():
                    self.recorder.auto = False
                    if self.recorder.meta or obs.owned:
                        self.recorder.error = obs.error
                    else:
                        self.recorder.mode = 'idle'
            finally:
                self.lock.release()

    def status(self):
        result = super().status()
        result['connect'] = dict(product='VertexConnect', version=1, complete=self.config.values['complete'],
                                 ready=self.ready(), forzaConfirmed=self.forza_confirmed,
                                 forzaConnected=result['packetAge'] is not None and result['packetAge'] < 3 and not result['udpError'],
                                 udpHost='127.0.0.1', udpPort=self.udp_port,
                                 obsPort=self.config.values['obsPort'], telemetryOnly=self.config.values['telemetryOnly'],
                                 dataPath=str(self.data), auto=self.config.values['auto'], error=self.setup_error)
        return result

    def bind_udp(self, port):
        port = ConnectConfig.port(port)
        if self.sock and self.udp_port == port and self.udp_thread and self.udp_thread.is_alive():
            return
        candidate = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            if os.name == 'nt':
                candidate.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            candidate.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1024*1024)
            candidate.bind(('127.0.0.1', port))
            candidate.settimeout(.2)
        except OSError as error:
            candidate.close()
            message = f'El puerto {port} no está disponible. Cierra la otra instancia de VertexLab o elige otro puerto.'
            if not self.sock:
                with self.live_lock:
                    self.live['udpError'] = message
            raise ValueError(message) from error
        self.stop_udp()
        self.sock, self.udp_port = candidate, port
        self.udp_stop = threading.Event()
        self.forza_confirmed = False
        with self.live_lock:
            self.last_packet_monotonic = None
            self.live.update(packet=None, udpError=None)
        self.udp_thread = threading.Thread(target=self.receive_udp, args=(candidate, self.udp_stop), daemon=True)
        self.udp_thread.start()
        self.recorder.auto = self.ready() and self.config.values['auto']
        self.recorder.mode = 'armed' if self.recorder.auto else 'idle'

    def receive_udp(self, sock, stopped):
        while not stopped.is_set() and not self.closed.is_set():
            try:
                raw, _ = sock.recvfrom(65535)
                self.ingest(raw)
            except socket.timeout:
                continue
            except OSError:
                break

    def stop_udp(self):
        self.udp_stop.set()
        if self.sock:
            self.sock.close()
        if self.udp_thread:
            self.udp_thread.join(timeout=1)
        self.sock = None

    def execute(self, name, body):
        r = self.recorder
        if name == 'connect/show':
            if self.show_window:
                self.show_window()
            return {'ok': True, 'nativeWindow': self.show_window is not None}
        if name.startswith('connect/'):
            if r.meta or r.obs.owned:
                raise ValueError('Finaliza la sesión antes de cambiar la configuración')
            if name == 'connect/udp':
                self.bind_udp(body.get('port', 5301))
                if self.config.values['complete']:
                    self.config.save(udpPort=self.udp_port)
            elif name == 'connect/forza':
                if not self.status()['connect']['forzaConnected']:
                    raise ValueError('Entra a Forza y conduce hasta recibir telemetría')
                self.forza_confirmed = True
            elif name == 'connect/data':
                path = Path(str(body.get('path', ''))).expanduser()
                if not path.is_absolute():
                    raise ValueError('Elige una ruta completa para tus sesiones')
                path.mkdir(parents=True, exist_ok=True)
                import tempfile
                with tempfile.TemporaryFile(dir=path):
                    pass
                self.data = path.resolve()
                r.data = self.data
                r.error = None
                self.preview_cache.clear()
                self.config.save(dataPath=str(self.data))
            elif name == 'connect/obs':
                if not self.forza_confirmed and not self.config.values['complete']:
                    raise ValueError('Primero conecta Forza')
                port = ConnectConfig.port(body.get('port', 4455))
                self.config.save(obsPort=port)
                password = str(body.get('password') or self.config.password())
                # Protect before connecting; never persist plaintext credentials.
                secret = protect_password(password)
                super().execute('obs', dict(port=port, password=password))
                self.config.save(obsPort=port, obsSecret=secret)
                self.setup_error = None
                r.auto = self.ready() and self.config.values['auto']
                r.mode = 'armed' if r.auto else 'idle'
            elif name == 'connect/video':
                if not self.config.values['complete']:
                    raise ValueError('Completa la configuración inicial primero')
                only = body.get('telemetryOnly')
                if not isinstance(only, bool):
                    raise ValueError('Modo de video inválido')
                if only:
                    super().execute('obs-disable', {})
                self.config.save(telemetryOnly=only)
                self.setup_error = None
                r.auto = self.ready() and self.config.values['auto']
                r.mode = 'armed' if r.auto else 'idle'
            elif name == 'connect/complete':
                if not self.forza_confirmed and not self.config.values['complete']:
                    raise ValueError('Primero confirma la conexión con Forza')
                only = body.get('telemetryOnly') is True
                if not only and not (r.obs.enabled and r.obs.ws is not None):
                    raise ValueError('Conecta OBS o elige grabar solo telemetría')
                if only:
                    super().execute('obs-disable', {})
                self.config.save(complete=True, udpPort=self.udp_port, telemetryOnly=only,
                                 auto=body.get('auto', True) is True, dataPath=str(self.data))
                self.setup_error = None
                r.auto = self.config.values['auto']
                r.mode = 'armed' if r.auto else 'idle'
            else:
                raise ValueError('Operación de VertexConnect desconocida')
            return {'ok': True}
        if name == 'start' and not self.ready():
            raise ValueError('Completa la configuración de VertexConnect antes de grabar')
        if name == 'auto' and body.get('enabled') and not self.ready():
            raise ValueError('Conecta OBS o selecciona solo telemetría en VertexConnect')
        result = super().execute(name, body)
        if name == 'auto':
            self.config.save(auto=r.auto)
        elif name == 'obs':
            self.config.save(obsPort=r.obs.port, obsSecret=protect_password(r.obs.password), telemetryOnly=False)
            self.setup_error = None
            r.auto = self.config.values['complete'] and self.config.values['auto']
        elif name == 'obs-disable':
            self.config.save(telemetryOnly=True)
        return result

    def close(self):
        self.monitor_stop.set()
        if self.monitor_thread:
            self.monitor_thread.join(timeout=1)
        self.stop_udp()
        super().close()
