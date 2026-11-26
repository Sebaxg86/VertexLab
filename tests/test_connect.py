import json
import os
import socket
import tempfile
import time
import unittest
import threading
import urllib.request
import urllib.error
from pathlib import Path
from unittest.mock import patch

from connect_config import ConnectConfig, protect_password
from connect_service import ConnectRuntime
from test_racelab import FakeOBS, packet
from server import ThreadingHTTPServer, handler_for


class CompanionOBS(FakeOBS):
    def __init__(self):
        super().__init__()
        self.enabled = False
        self.ws = None

    def connect(self, port=4455, password=''):
        self.port = port
        self.ws = object()
        self.enabled = True

    def disconnect(self):
        self.ws = None


class ConnectTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.config = ConnectConfig(Path(self.tmp.name)/'settings/connect.json', Path(self.tmp.name)/'sessions')
        self.obs = CompanionOBS()
        self.runtime = ConnectRuntime(self.config, self.obs)

    def tearDown(self):
        self.runtime.close()
        self.tmp.cleanup()

    def test_last_known_vehicle_survives_pause_without_changing_raw_packet(self):
        self.runtime.ingest(packet(event=False, car=1009))
        original = self.runtime.status()['lastKnownCar']
        self.assertEqual(original['carClass'], 3)
        self.assertEqual(original['carPI'], 800)
        self.assertIsNotNone(original['brand'])
        self.runtime.ingest(packet(active=False, event=False, car=0))
        paused = self.runtime.status()
        self.assertEqual(paused['lastKnownCar'], original)
        self.assertEqual(paused['packet']['carOrdinal'], 0)
        self.runtime.ingest(packet(event=False, car=1006))
        self.assertEqual(self.runtime.status()['lastKnownCar']['ordinal'], 1006)

    def test_pause_keeps_last_driving_packet_and_resume_replaces_it(self):
        self.runtime.ingest(packet(event=False, active=True, stamp=100))
        driving = self.runtime.status()['lastDrivingPacket']
        self.runtime.ingest(packet(event=False, active=False, car=0, stamp=200))
        self.assertEqual(self.runtime.status()['lastDrivingPacket'], driving)
        self.assertFalse(self.runtime.status()['packet']['active'])
        self.runtime.ingest(packet(event=False, active=True, stamp=300))
        self.assertNotEqual(self.runtime.status()['lastDrivingPacket']['timestamp'], driving['timestamp'])

    def test_second_launch_reopens_configured_native_panel_without_another_capture_engine(self):
        import io
        import sys
        import vertexconnect
        self.config.save(complete=True, telemetryOnly=True)
        status = {'connect': {'product': 'VertexConnect', 'complete': True}}
        def response(request, **kwargs):
            body = status if isinstance(request, str) else {'nativeWindow': True}
            return io.BytesIO(json.dumps(body).encode())
        with patch.object(sys, 'argv', ['vertexconnect', '--config', str(self.config.path)]), \
             patch('vertexconnect.ThreadingHTTPServer', side_effect=OSError('occupied')), \
             patch('vertexconnect.urllib.request.urlopen', side_effect=response) as urlopen, \
             patch('vertexconnect.ConnectRuntime') as engine, \
             patch('vertexconnect.logging.basicConfig'), \
             patch('vertexconnect.webbrowser.open') as browser:
            self.assertIsNone(vertexconnect.main())
            self.assertEqual(urlopen.call_count, 2)
            self.assertTrue(urlopen.call_args.args[0].full_url.endswith('/api/connect/show'))
            engine.assert_not_called()
            browser.assert_not_called()

    def test_quick_panel_udp_change_survives_reopening_the_application(self):
        self.config.save(complete=True, telemetryOnly=True, auto=False)
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as available:
            available.bind(('127.0.0.1', 0))
            port = available.getsockname()[1]
        self.runtime.command('connect/udp', {'port': port})
        self.assertEqual(ConnectConfig(self.config.path).values['udpPort'], port)
        self.assertEqual(self.runtime.status()['connect']['udpPort'], port)

    def forza(self):
        self.runtime.ingest(packet(event=False))
        self.runtime.pending.join()
        self.runtime.command('connect/forza', {})

    def test_setup_blocks_capture_and_cannot_skip_forza_or_obs(self):
        for name, body in [('start', {}), ('auto', {'enabled': True}),
                           ('connect/forza', {}), ('connect/obs', {}),
                           ('connect/complete', {'telemetryOnly': True})]:
            with self.assertRaises(ValueError):
                self.runtime.command(name, body)
        self.forza()
        with self.assertRaisesRegex(ValueError, 'Conecta OBS'):
            self.runtime.command('connect/complete', {})
        self.assertFalse(self.config.values['complete'])

    def test_telemetry_only_setup_persists_and_manual_recording_works(self):
        self.forza()
        self.runtime.command('connect/complete', {'telemetryOnly': True, 'auto': False})
        self.assertTrue(self.runtime.ready())
        self.assertFalse(self.obs.enabled)
        saved = ConnectConfig(self.config.path)
        self.assertTrue(saved.values['complete'])
        self.assertTrue(saved.values['telemetryOnly'])
        self.assertFalse(saved.values['auto'])
        sid = self.runtime.command('start', {})['id']
        self.runtime.ingest(packet(event=False))
        self.runtime.pending.join()
        self.runtime.command('stop', {})
        self.assertTrue((self.runtime.data/(sid+'.jsonl')).exists())

    def test_obs_secret_is_protected_and_not_exposed_by_status(self):
        self.forza()
        with patch('connect_service.protect_password', return_value='encrypted-fixture'):
            self.runtime.command('connect/obs', {'port': 4455, 'password': 'private-fixture'})
        self.runtime.command('connect/complete', {'telemetryOnly': False})
        self.assertTrue(self.runtime.ready())
        text = self.config.path.read_text(encoding='utf-8')
        self.assertNotIn('private-fixture', text)
        self.assertIn('encrypted-fixture', text)
        self.assertNotIn('obsSecret', json.dumps(self.runtime.status()))
        self.assertNotIn('encrypted-fixture', json.dumps(self.runtime.status()))

    def test_failed_obs_connect_never_completes_setup(self):
        self.forza()
        with patch.object(self.obs, 'connect', side_effect=ValueError('OBS no disponible')):
            with self.assertRaisesRegex(ValueError, 'no disponible'):
                self.runtime.command('connect/obs', {})
        self.assertFalse(self.config.values['complete'])
        self.assertFalse(self.runtime.recorder.auto)

    def test_invalid_packets_and_stale_reception_cannot_unlock_forza(self):
        self.runtime.ingest(b'bad')
        with self.assertRaises(ValueError):
            self.runtime.command('connect/forza', {})
        self.runtime.ingest(packet(event=False))
        self.runtime.last_packet_monotonic = time.monotonic()-4
        with self.assertRaises(ValueError):
            self.runtime.command('connect/forza', {})

    def test_udp_conflict_is_explicit_and_retry_recovers_valid_reception(self):
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as occupied:
            if os.name == 'nt':
                occupied.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            occupied.bind(('127.0.0.1', 0))
            port = occupied.getsockname()[1]
            with self.assertRaisesRegex(ValueError, str(port)):
                self.runtime.command('connect/udp', {'port': port})
        self.runtime.command('connect/udp', {'port': port})
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sender:
            sender.sendto(packet(event=False), ('127.0.0.1', port))
        deadline = time.monotonic()+2
        while self.runtime.last_packet_monotonic is None and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertTrue(self.runtime.status()['connect']['forzaConnected'])
        self.assertIsNone(self.runtime.status()['udpError'])
        self.assertIsNone(self.runtime.recorder.meta)

    def test_new_folder_keeps_existing_session_files(self):
        self.forza()
        self.runtime.command('connect/complete', {'telemetryOnly': True})
        sid = self.runtime.command('start', {})['id']
        with self.assertRaises(ValueError):
            self.runtime.command('connect/data', {'path': str(Path(self.tmp.name)/'new')})
        self.runtime.command('stop', {})
        original = self.runtime.data/(sid+'.json')
        destination = Path(self.tmp.name)/'new'
        self.runtime.command('connect/data', {'path': str(destination)})
        self.assertTrue(original.exists())
        self.assertEqual(self.runtime.data, destination.resolve())
        self.assertEqual(ConnectConfig(self.config.path).values['dataPath'], str(destination.resolve()))

    def test_http_wizard_reaches_ready_and_local_app_without_exposing_password(self):
        http = ThreadingHTTPServer(('127.0.0.1', 0), handler_for(self.runtime))
        http.daemon_threads = True
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{http.server_port}'
        def post(route, body, **headers):
            request = urllib.request.Request(base+'/api/'+route, data=json.dumps(body).encode(),
                                             headers={'Content-Type': 'application/json', **headers})
            with urllib.request.urlopen(request, timeout=3) as response:
                return json.load(response)
        try:
            with urllib.request.urlopen(base+'/connect.html') as response:
                self.assertEqual(response.status, 200)
            with self.assertRaises(urllib.error.HTTPError):
                post('connect/complete', {'telemetryOnly': True})
            self.runtime.ingest(packet(event=False))
            post('connect/forza', {})
            post('connect/complete', {'telemetryOnly': True, 'auto': False})
            with urllib.request.urlopen(base+'/api/status') as response:
                status = json.load(response)
            self.assertTrue(status['connect']['ready'])
            self.assertFalse(status['auto'])
            with self.assertRaises(urllib.error.HTTPError) as rejected:
                post('connect/udp', {'port': 5301}, Origin='https://example.com')
            self.assertEqual(rejected.exception.code, 403)
            with urllib.request.urlopen(base+'/') as response:
                self.assertIn(b'<title>VertexLab</title>', response.read())
        finally:
            http.shutdown()
            http.server_close()
            thread.join(timeout=2)

    def test_library_pagination_reads_previews_only_for_requested_page(self):
        for index in range(30):
            sid = f'{index:032x}'
            meta = dict(id=sid, name=f'QA {index}', created=index, version=2, ended=1,
                        carOrdinal=1009, syncSegments=[dict(tStart=0, tEnd=1, videoStart=0)],
                        videoPath='private-video-location.mp4')
            (self.runtime.data/(sid+'.json')).write_text(json.dumps(meta), encoding='utf-8')
            (self.runtime.data/(sid+'.jsonl')).write_text('', encoding='utf-8')
        with patch('server.second_lap_preview', return_value=dict(path='M0,0 L1,1')) as preview:
            first = self.runtime.sessions(offset=0, limit=12)
            self.assertEqual(preview.call_count, 12)
            second = self.runtime.sessions(offset=12, limit=12)
            self.assertEqual(preview.call_count, 24)
        self.assertEqual(first['total'], 30)
        self.assertEqual(first['nextOffset'], 12)
        self.assertEqual(len(first['items']), 12)
        self.assertEqual(len({item['id'] for item in first['items']+second['items']}), 24)
        self.assertEqual(first['items'][0]['availability'], dict(local=True, cloud=False))
        self.assertNotIn('videoPath', first['items'][0])
        self.assertNotIn('syncSegments', first['items'][0])

    def test_restore_does_not_require_running_game_but_obs_failure_blocks_capture(self):
        self.config.save(complete=True, telemetryOnly=False)
        with patch.object(self.runtime, 'bind_udp'), patch.object(self.obs, 'connect', side_effect=ValueError('OBS cerrado')):
            self.runtime.restore()
        self.assertFalse(self.runtime.ready())
        self.assertFalse(self.runtime.recorder.auto)
        self.assertEqual(self.runtime.setup_error, 'OBS cerrado')
        self.config.save(telemetryOnly=True)
        with patch.object(self.runtime, 'bind_udp'):
            self.runtime.restore()
        self.assertTrue(self.runtime.ready())
        self.assertTrue(self.runtime.recorder.auto)

    def test_reopening_companion_does_not_interrupt_active_recording(self):
        self.forza()
        self.runtime.command('connect/complete', {'telemetryOnly': True, 'auto': False})
        sid = self.runtime.command('start', {})['id']
        shown = []
        self.runtime.show_window = lambda: shown.append(True)
        result = self.runtime.command('connect/show', {})
        self.assertTrue(result['nativeWindow'])
        self.assertEqual(shown, [True])
        self.assertEqual(self.runtime.recorder.meta['id'], sid)

    @unittest.skipUnless(os.name == 'nt', 'Windows DPAPI')
    def test_password_round_trips_under_current_windows_account(self):
        secret = protect_password('OBS-private-test-ñ')
        self.assertNotIn('OBS-private', secret)
        self.assertEqual(protect_password(secret, decrypt=True), 'OBS-private-test-ñ')


if __name__ == '__main__':
    unittest.main()
