"""Small OBS WebSocket v5 client; only controls recordings started by VertexLab."""
import base64
import hashlib
import json
import os
import time
import uuid


class OBS:
    STATE_TIMEOUT = 5.0
    STATE_POLL = .05
    ANCHOR_SAMPLES = 5
    ANCHOR_INTERVAL = .01
    def __init__(self):
        self.ws = None
        self.owned = False
        self.enabled = False
        self.error = None
        self.port = 4455
        self.password = os.environ.get('VERTEXLAB_OBS_PASSWORD', os.environ.get('RACELAB_OBS_PASSWORD', ''))
        self.external_recording = False
        self.external_paused = False
        self.last_record_status = None

    def status(self):
        return dict(enabled=self.enabled, connected=self.ws is not None,
                    owned=self.owned, error=self.error, port=self.port,
                    externalRecording=self.external_recording,
                    externalPaused=self.external_paused)

    def _update_record_state(self, status):
        if not isinstance(status, dict):
            return
        self.last_record_status = dict(status)
        active = bool(status.get('outputActive'))
        paused = bool(status.get('outputPaused'))
        self.external_recording = active and not self.owned
        self.external_paused = active and paused and not self.owned

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
            status = self.request('GetRecordStatus')
            self._update_record_state(status)
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
        self.external_recording = False
        self.external_paused = False
        self.last_record_status = None

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

    def probe_connection(self):
        """Bounded read-only health check; callers serialize it with capture commands."""
        ws = self.ws
        if not ws:
            return False
        timeout = ws.gettimeout()
        try:
            ws.settimeout(.25)
            self.request('GetVersion')
            return True
        except Exception:
            try:
                self.disconnect()
            except Exception:
                self.ws = None
            self.error = 'Se perdió la conexión con OBS. Abre OBS y vuelve a conectarlo.'
            return False
        finally:
            if self.ws is ws:
                ws.settimeout(timeout)

    def refresh_recording_state(self):
        """Bounded read-only recording status check when idle; never modifies OBS."""
        ws = self.ws
        if not ws:
            return None
        timeout = ws.gettimeout()
        try:
            ws.settimeout(.25)
            status = self.request('GetRecordStatus')
            self._update_record_state(status)
            return status
        except Exception:
            return None
        finally:
            if self.ws is ws:
                ws.settimeout(timeout)

    def anchor(self):
        before = time.monotonic()
        status = self.request('GetRecordStatus')
        after = time.monotonic()
        self._update_record_state(status)
        return dict(wall=(before+after)/2, video=status['outputDuration']/1000,
                    uncertainty=(after-before)/2, paused=status['outputPaused'],
                    active=status['outputActive'])

    def wait_state(self, active, paused=None, message='OBS no confirmó el cambio', timeout=None):
        # WebSocket acknowledges the request before the OBS frontend applies it.
        # Read fresh status until the actual output reaches the requested state.
        limit = self.STATE_TIMEOUT if timeout is None else (timeout if self.STATE_TIMEOUT >= 1.0 else self.STATE_TIMEOUT)
        deadline = time.monotonic() + limit
        while True:
            anchor = self.anchor()
            if anchor['active'] == active and (paused is None or anchor['paused'] == paused):
                self.error = None
                return anchor
            if time.monotonic() >= deadline:
                raise ValueError(message)
            time.sleep(self.STATE_POLL)

    def settled_anchor(self, anchor):
        # outputDuration is an encoded-frame counter, not a continuously running
        # clock. Sample across several frame ticks; prefer the freshest lower
        # bound rather than an arbitrary point on its staircase. Keep the
        # observations for diagnosis; this cannot measure game capture latency.
        samples = [anchor]
        for _ in range(self.ANCHOR_SAMPLES - 1):
            time.sleep(self.ANCHOR_INTERVAL)
            sample = self.anchor()
            if not sample['active'] or sample['paused']:
                raise ValueError('OBS cambió de estado durante la sincronización')
            if sample['video'] < samples[-1]['video']:
                raise ValueError('El reloj de grabación de OBS retrocedió')
            samples.append(sample)
        best = max(samples, key=lambda a: a['video']-a['wall']-a['uncertainty'])
        return dict(best, observations=samples, method='encoded-frame-samples-v1')

    def start(self):
        if not self.enabled:
            return None
        status = self.request('GetRecordStatus')
        self._update_record_state(status)
        if status['outputActive']:
            raise ValueError('OBS ya graba por tu cuenta; VertexLab no modificará esa grabación')
        self.request('StartRecord')
        self.owned = True
        self.external_recording = False
        self.external_paused = False
        return self.settled_anchor(self.wait_state(True, False, 'OBS no confirmó el inicio de la grabación'))

    def pause(self):
        if not self.owned:
            return
        if not self.anchor()['paused']:
            self.request('PauseRecord')
        return self.wait_state(True, True, 'OBS no confirmó la pausa; revisa el modo de salida')

    def resume(self):
        if not self.owned:
            return None
        if self.anchor()['paused']:
            self.request('ResumeRecord')
        return self.settled_anchor(self.wait_state(True, False, 'OBS no confirmó la reanudación'))

    def stop(self):
        if not self.owned:
            return None
        response = self.request('StopRecord')
        self.wait_state(False, message='OBS no confirmó la finalización del archivo', timeout=15.0)
        self.owned = False
        self.external_recording = False
        self.external_paused = False
        return response.get('outputPath')
