"""Small OBS WebSocket v5 client; only controls recordings started by RaceLab."""
import base64
import hashlib
import json
import os
import time
import uuid


class OBS:
    def __init__(self):
        self.ws = None
        self.owned = False
        self.enabled = False
        self.error = None
        self.port = 4455
        self.password = os.environ.get('RACELAB_OBS_PASSWORD', '')

    def status(self):
        return dict(enabled=self.enabled, connected=self.ws is not None,
                    owned=self.owned, error=self.error, port=self.port)

    def connect(self, port=4455, password=''):
        if self.owned:
            raise ValueError('Termina la sesión antes de reconectar OBS')
        self.disconnect()
        self.port = int(port)
        if not 1 <= self.port <= 65535:
            raise ValueError('Puerto OBS inválido')
        self.password = password or self.password
        try:
            import websocket
            self.ws = websocket.create_connection(
                f'ws://127.0.0.1:{self.port}', timeout=2, suppress_origin=True,
                http_proxy_host=None, http_no_proxy=['127.0.0.1'])
            hello = self._read()
            if hello.get('op') != 0:
                raise ValueError('OBS no envió el saludo WebSocket v5')
            identify = dict(rpcVersion=1, eventSubscriptions=0)
            auth = hello['d'].get('authentication')
            if auth:
                secret = base64.b64encode(hashlib.sha256((self.password+auth['salt']).encode()).digest()).decode()
                identify['authentication'] = base64.b64encode(hashlib.sha256((secret+auth['challenge']).encode()).digest()).decode()
            self.ws.send(json.dumps(dict(op=1, d=identify)))
            if self._read().get('op') != 2:
                raise ValueError('OBS rechazó la autenticación')
            self.request('GetRecordStatus')
            self.enabled = True
            self.error = None
        except Exception as e:
            self.disconnect()
            self.error = 'No se pudo conectar a OBS. Revisa WebSocket, puerto y contraseña.'
            raise ValueError(self.error) from e

    def disconnect(self):
        if self.ws:
            self.ws.close()
        self.ws = None

    def _read(self):
        message = self.ws.recv()
        if not message:
            raise ConnectionError('OBS cerró la conexión')
        return json.loads(message)

    def request(self, name):
        if not self.ws:
            raise ValueError('OBS desconectado')
        rid = uuid.uuid4().hex
        try:
            self.ws.send(json.dumps(dict(op=6, d=dict(requestType=name, requestId=rid))))
            deadline = time.monotonic()+3
            while time.monotonic() < deadline:
                message = self._read()
                if message.get('op') != 7 or message['d'].get('requestId') != rid:
                    continue
                data = message['d']
                if not data['requestStatus']['result']:
                    raise ValueError(f"OBS {name}: {data['requestStatus'].get('comment', 'solicitud rechazada')}")
                return data.get('responseData', {})
            raise TimeoutError('OBS no respondió')
        except (OSError, ConnectionError) as e:
            self.disconnect()
            raise ValueError('Se perdió la conexión con OBS') from e

    def anchor(self):
        before = time.monotonic()
        status = self.request('GetRecordStatus')
        after = time.monotonic()
        return dict(wall=(before+after)/2, video=status['outputDuration']/1000,
                    uncertainty=(after-before)/2, paused=status['outputPaused'],
                    active=status['outputActive'])

    def start(self):
        if not self.enabled:
            return None
        status = self.request('GetRecordStatus')
        if status['outputActive']:
            raise ValueError('OBS ya graba por tu cuenta; RaceLab no modificará esa grabación')
        self.request('StartRecord')
        self.owned = True
        anchor = self.anchor()
        if not anchor['active'] or anchor['paused']:
            raise ValueError('OBS no confirmó el inicio de la grabación')
        return anchor

    def pause(self):
        if not self.owned:
            return
        self.request('PauseRecord')
        anchor = self.anchor()
        if not anchor['paused']:
            raise ValueError('OBS no confirmó la pausa; revisa el modo de salida')
        return anchor

    def resume(self):
        if not self.owned:
            return None
        self.request('ResumeRecord')
        anchor = self.anchor()
        if not anchor['active'] or anchor['paused']:
            raise ValueError('OBS no confirmó la reanudación')
        return anchor

    def stop(self):
        if not self.owned:
            return None
        response = self.request('StopRecord')
        self.owned = False
        return response.get('outputPath')
