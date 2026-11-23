import base64
import hashlib
import json
import socket
import subprocess
import struct
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from obs_control import OBS
from recorder import Recorder
from server import Runtime, ThreadingHTTPServer, handler_for
from telemetry import decode, analyze


def packet(active=True, event=True, race_time=12, lap_time=12, stamp=12345, car=1009):
    data = bytearray(324)
    struct.pack_into('<iI', data, 0, int(active), stamp)
    struct.pack_into('<iii', data, 212, car, 3, 800)
    struct.pack_into('<fff', data, 244, 10, 20, 30)
    struct.pack_into('<f', data, 256, 25)
    struct.pack_into('<fff', data, 300, 60, lap_time if event else 0, race_time if event else 0)
    struct.pack_into('<H', data, 312, 2 if event else 0)
    data[314] = 1 if event else 0
    data[315], data[316] = 255, 128
    return data


class FakeOBS:
    def __init__(self):
        self.owned = False
        self.enabled = True
        self.calls = []
        self.wall = 100
        self.duration = 0
        self.path = None

    def status(self):
        return dict(enabled=True, connected=True, owned=self.owned, error=None, port=4455)

    def anchor(self):
        return dict(wall=self.wall, video=self.duration, uncertainty=.01, active=True, paused=False)

    def start(self):
        self.calls.append('start'); self.owned = True
        return self.anchor()

    def pause(self):
        if self.owned: self.calls.append('pause')

    def resume(self):
        self.calls.append('resume')
        return self.anchor()

    def stop(self):
        if self.owned:
            self.calls.append('stop'); self.owned = False
            return self.path

    def disconnect(self):
        pass


class DecoderTests(unittest.TestCase):
    def test_instrument_offsets_signed_steer_g_inputs_and_four_tires(self):
        data = packet()
        struct.pack_into('<b',data,320,-127)
        struct.pack_into('<f',data,8,8500)
        struct.pack_into('<fff',data,20,9.80665,-2,-4.903325)
        struct.pack_into('<ffff',data,268,32,212,122,176)
        struct.pack_into('<ffff',data,180,.2,-1.5,.6,2)
        row = decode(data)
        self.assertEqual(row['steer'],-127)
        self.assertEqual(row['engineMaxRpm'],8500)
        self.assertAlmostEqual(row['accelX'],9.80665,places=5)
        self.assertEqual(row['tireTempsC'],[0,100,50,80])
        self.assertAlmostEqual(row['tireSlipCombined'][1],-1.5)

    def test_layout(self):
        row = decode(packet())
        self.assertEqual((row['x'], row['z'], row['speed'], row['lap'], row['lapTime'], row['raceTime']), (10,30,90,2,12,12))
        self.assertEqual((row['carOrdinal'],row['carClass'],row['carPI'],row['racePosition']), (1009,3,800,1))
        self.assertEqual(row['throttle'],100)
        self.assertAlmostEqual(row['brake'],128/255*100)
        with self.assertRaises(ValueError): decode(bytes(323))
        data = packet(); struct.pack_into('<f',data,244,float('nan'))
        with self.assertRaises(ValueError): decode(data)

    def test_distance_and_pause_break(self):
        rows = [dict(decode(packet()),x=x,z=z,t=t,lap=lap,timestamp=i,breakBefore=cut)
                for i,(x,z,t,lap,cut) in enumerate([(0,0,0,0,False),(3,4,.1,0,False),
                    (4,5,.2,0,True),(0,0,3,1,False),(3,4,3.1,1,False),(0,0,4,2,False)])]
        laps = analyze(rows)
        self.assertEqual(laps[0]['rows'][1]['d'],5)
        self.assertEqual(laps[0]['rows'][2]['d'],5)
        self.assertTrue(laps[0]['rows'][2]['gap'])
        self.assertFalse(laps[1]['partial'])


class RecorderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.obs = FakeOBS()
        self.rec = Recorder(self.tmp.name,self.obs)

    def tearDown(self):
        self.rec.finish('test-cleanup')
        self.tmp.cleanup()

    def feed(self, wall, **kwargs):
        self.rec.heartbeat(wall)
        self.rec.feed(decode(packet(**kwargs)),wall)

    def rows(self, sid):
        return [json.loads(line) for line in (Path(self.tmp.name)/(sid+'.jsonl')).read_text().splitlines()]

    def test_free_roam_never_opens_even_first_packet(self):
        for wall in [100,101,102]: self.feed(wall,event=False)
        self.assertIsNone(self.rec.meta)
        self.assertEqual(self.obs.calls,[])

    def test_long_pause_resume_same_file_excludes_pause_and_records_obs_segments(self):
        self.feed(100)
        sid = self.rec.meta['id']
        self.feed(100.1)
        self.rec.heartbeat(100.8)
        self.rec.heartbeat(800)
        self.assertEqual(self.rec.meta['id'],sid)
        self.assertEqual(self.rec.mode,'paused')
        self.assertEqual(len(self.rows(sid)),2)
        self.obs.wall, self.obs.duration = 800, .8
        self.feed(800)
        self.feed(800.1)
        self.assertEqual(self.obs.calls,['start','pause','resume'])
        self.assertAlmostEqual(self.rec.t,.2)
        rows = self.rows(sid)
        self.assertTrue(rows[2]['breakBefore'])
        self.assertAlmostEqual(rows[3]['videoTime'],.9)
        self.assertEqual(len(self.rec.meta['syncSegments']),2)

    def test_instruments_saved_and_replayed_with_obs_segments_across_pause(self):
        expected = []
        for wall, steer, accel, temp in [(100, -127, 1, 80), (100.1, 0, 2, 90), (800, 127, 3, 100), (800.1, -64, 4, 110)]:
            if wall == 800:
                self.rec.heartbeat(100.8)
                self.obs.wall, self.obs.duration = 800, .8
            raw = packet(stamp=int(wall*1000))
            struct.pack_into('<b', raw, 320, steer)
            struct.pack_into('<fff', raw, 20, accel, 0, -accel)
            struct.pack_into('<ffff', raw, 268, *([temp*9/5+32]*4))
            struct.pack_into('<ffff', raw, 180, .2, .4, .6, .8)
            self.rec.feed(decode(raw), wall)
            expected.append((steer, accel, temp))
        sid = self.rec.meta['id']
        self.rec.finish()
        rows = self.rows(sid)
        meta = json.loads((Path(self.tmp.name)/(sid+'.json')).read_text())
        for row, (steer, accel, temp) in zip(rows, expected):
            self.assertEqual(row['steer'], steer)
            self.assertEqual(row['accelX'], accel)
            self.assertAlmostEqual(row['tireTempsC'][0], temp)
            self.assertAlmostEqual(row['tireSlipCombined'][3], .8, places=6)
        self.assertEqual([row['breakBefore'] for row in rows], [False, False, True, False])
        self.assertAlmostEqual(rows[-1]['t'], .2)
        # Exercise the exact browser replay and video functions against saved JSON.
        script = """
const assert=require('node:assert/strict');
const A=require('./public/analysis-model.js'),T=require('./public/timeline.js'),I=require('./public/instruments.js');
let input='';process.stdin.on('data',chunk=>input+=chunk);process.stdin.on('end',()=>{
 const {rows,meta,laps}=JSON.parse(input),replay=A.sessionRows(laps);
 for(const row of [rows[0],rows[2],rows[3]]){
  const sample=A.sampleAtTime(replay,row.t);
  assert.equal(sample.steer,row.steer);assert.equal(sample.accelX,row.accelX);
  assert.deepEqual(sample.tireTempsC,row.tireTempsC);
  assert.ok(Math.abs(T.toVideo(meta,row.t)-row.videoTime)<1e-8);
  assert.ok(Math.abs(I.values(sample).lateral-row.accelX/9.80665)<1e-8);
 }
 assert.equal(A.sampleAtTime(replay,.11).steer,127);
 assert.ok(Math.abs(T.toVideo(meta,.15)-.85)<1e-8);
});
"""
        result = subprocess.run(['node', '-e', script], input=json.dumps(dict(rows=rows,meta=meta,laps=analyze(rows))), text=True, capture_output=True, cwd=Path(__file__).resolve().parents[1])
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_inactive_packets_pause_but_do_not_end(self):
        self.feed(100)
        for wall in [101,105,200]: self.feed(wall,active=False,event=False)
        self.assertIsNotNone(self.rec.meta)
        self.assertEqual(self.rec.mode,'paused')

    def test_free_roam_confirms_end_and_start_next_race(self):
        self.feed(100)
        sid = self.rec.meta['id']
        self.feed(101,event=False); self.feed(103,event=False)
        self.assertIsNone(self.rec.meta)
        meta = json.loads((Path(self.tmp.name)/(sid+'.json')).read_text())
        self.assertEqual(meta['events'][-1]['reason'],'returned-to-free-roam')
        self.assertIn('Mitsubishi',meta['name'])
        self.obs.wall = 104
        self.feed(104,race_time=0,lap_time=.1)
        self.assertNotEqual(self.rec.meta['id'],sid)

    def test_new_clock_or_vehicle_splits_attempt(self):
        self.feed(100,race_time=20)
        first = self.rec.meta['id']
        self.obs.wall = 101
        self.feed(101,race_time=.1)
        self.assertNotEqual(self.rec.meta['id'],first)
        second = self.rec.meta['id']
        self.feed(101.1,car=1006)
        self.assertNotEqual(self.rec.meta['id'],second)

    def test_manual_stop_does_not_immediately_auto_restart(self):
        self.feed(100)
        self.rec.finish()
        self.feed(101)
        self.assertIsNone(self.rec.meta)
        self.feed(102,event=False)
        self.feed(103)
        self.assertIsNotNone(self.rec.meta)

    def test_obs_failure_keeps_telemetry_and_marks_sync_error(self):
        self.obs.start = lambda: (_ for _ in ()).throw(ValueError('OBS ocupado'))
        self.feed(100)
        self.assertEqual(self.rec.meta['syncState'],'error')
        self.assertEqual(len(self.rows(self.rec.meta['id'])),1)
        self.assertIsNone(self.rows(self.rec.meta['id'])[0]['videoTime'])

    def test_video_start_latency_leaves_uncovered_telemetry(self):
        self.obs.wall = 100.2
        self.feed(100)
        sid = self.rec.meta['id']
        self.feed(100.3)
        rows = self.rows(sid)
        self.assertIsNone(rows[0]['videoTime'])
        self.assertAlmostEqual(rows[1]['videoTime'],.1)

    def test_manual_session_records_free_roam(self):
        sid = self.rec.begin(100, name='Prueba manual', manual=True)
        self.feed(100.1,event=False)
        self.assertEqual(len(self.rows(sid)),1)

    def test_lap_clock_without_race_position_opens_time_trial(self):
        data = packet(); data[314] = 0
        self.rec.feed(decode(data),100)
        self.assertIsNotNone(self.rec.meta)

    def test_failed_stop_retains_ownership_and_can_retry(self):
        self.feed(100)
        sid = self.rec.meta['id']
        stop = self.obs.stop
        self.obs.stop = lambda: (_ for _ in ()).throw(ValueError('Error de OBS'))
        self.rec.finish()
        with self.assertRaisesRegex(ValueError,'pendiente'):
            self.rec.begin(101)
        self.obs.stop = stop
        self.obs.path = 'recovered.mp4'
        self.rec.finish()
        meta = json.loads((Path(self.tmp.name)/(sid+'.json')).read_text())
        self.assertEqual(meta['videoPath'],'recovered.mp4')


class FakeWebSocket:
    def __init__(self, active=False, reject_pause=False, delay=0):
        self.responses = [dict(op=0,d=dict(authentication=dict(salt='salt',challenge='challenge')))]
        self.sent = []
        self.active = active
        self.paused = False
        self.reject_pause = reject_pause
        self.delay = delay
        self.transition = None
        self.remaining = 0

    def send(self, payload):
        item = json.loads(payload); self.sent.append(item)
        if item['op'] == 1:
            self.responses.append(dict(op=2,d=dict(negotiatedRpcVersion=1)))
        elif item['op'] == 6:
            name = item['d']['requestType']
            changes = {'StartRecord':('active',True), 'StopRecord':('active',False),
                       'PauseRecord':('paused',True), 'ResumeRecord':('paused',False)}
            if name in changes and not (name == 'PauseRecord' and self.reject_pause):
                self.transition = changes[name]
                self.remaining = self.delay
            if name == 'GetRecordStatus' and self.transition:
                if self.remaining > 0:
                    self.remaining -= 1
                else:
                    setattr(self,*self.transition)
                    self.transition = None
            data = dict(outputActive=self.active,outputPaused=self.paused,outputDuration=1500,outputPath='test.mp4')
            self.responses.append(dict(op=7,d=dict(requestId=item['d']['requestId'],requestStatus=dict(result=True),responseData=data)))

    def recv(self): return json.dumps(self.responses.pop(0))
    def close(self): pass


class OBSProtocolTests(unittest.TestCase):
    def connect(self, fake):
        obs = OBS()
        obs.STATE_TIMEOUT = .05
        obs.STATE_POLL = .001
        with patch('websocket.create_connection', return_value=fake): obs.connect(4455,'password')
        return obs

    def test_authentication_start_pause_resume_stop(self):
        fake = FakeWebSocket(); obs = self.connect(fake)
        secret = base64.b64encode(hashlib.sha256(b'passwordsalt').digest()).decode()
        expected = base64.b64encode(hashlib.sha256((secret+'challenge').encode()).digest()).decode()
        self.assertEqual(fake.sent[0]['d']['authentication'],expected)
        self.assertEqual(obs.start()['video'],1.5)
        obs.pause(); obs.resume()
        self.assertEqual(obs.stop(),'test.mp4')
        self.assertFalse(obs.owned)

    def test_existing_recording_is_never_controlled(self):
        fake = FakeWebSocket(active=True); obs = self.connect(fake)
        with self.assertRaisesRegex(ValueError,'ya graba'): obs.start()
        obs.pause(); obs.resume(); obs.stop()
        names = [m['d']['requestType'] for m in fake.sent if m['op']==6]
        self.assertEqual(names,['GetRecordStatus','GetRecordStatus'])

    def test_unconfirmed_pause_is_error(self):
        obs = self.connect(FakeWebSocket(reject_pause=True)); obs.start()
        with self.assertRaisesRegex(ValueError,'no confirmó la pausa'): obs.pause()

    def test_async_acknowledgments_wait_for_real_state_on_all_transitions(self):
        fake = FakeWebSocket(delay=3); obs = self.connect(fake)
        self.assertTrue(obs.start()['active'])
        self.assertTrue(obs.pause()['paused'])
        self.assertFalse(obs.resume()['paused'])
        self.assertEqual(obs.stop(),'test.mp4')
        self.assertFalse(fake.active)
        self.assertFalse(obs.owned)


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.runtime = Runtime(self.tmp.name,FakeOBS())
        self.http = ThreadingHTTPServer(('127.0.0.1',0),handler_for(self.runtime))
        self.http.daemon_threads = True
        threading.Thread(target=self.http.serve_forever,daemon=True).start()
        self.base = f'http://127.0.0.1:{self.http.server_port}'

    def tearDown(self):
        self.runtime.close(); self.http.shutdown(); self.http.server_close(); self.tmp.cleanup()

    def request(self, route, body=None, headers=None):
        req = urllib.request.Request(self.base+route,data=json.dumps(body).encode() if body is not None else None,
                                     headers=headers or {'Content-Type':'application/json'})
        return urllib.request.urlopen(req,timeout=5)

    def test_status_exposes_current_instruments_and_monotonic_packet_age(self):
        raw = packet(event=False)
        struct.pack_into('<b', raw, 320, -64)
        struct.pack_into('<fff', raw, 20, 3.0, 0.0, -4.0)
        struct.pack_into('<ffff', raw, 268, 176, 194, 212, 158)
        self.runtime.ingest(raw)
        with self.request('/api/status') as response:
            status = json.load(response)
        self.assertEqual(status['telemetryVersion'], 2)
        self.assertGreaterEqual(status['packetAge'], 0)
        self.assertLess(status['packetAge'], 1)
        self.assertEqual(status['packet']['steer'], -64)
        self.assertEqual(status['packet']['accelX'], 3)
        self.assertEqual(status['packet']['accelZ'], -4)
        self.assertEqual(status['packet']['tireTempsC'], [80, 90, 100, 70])
        with patch('server.time.time', return_value=0):
            self.assertLess(self.runtime.status()['packetAge'], 1)

    @unittest.skipUnless(sys.platform == 'win32', 'Windows exclusive listener')
    def test_second_server_cannot_share_http_port(self):
        with self.assertRaises(OSError):
            ThreadingHTTPServer(self.http.server_address, handler_for(self.runtime))

    def test_udp_auto_record_reload_and_video_range(self):
        video = Path(self.tmp.name)/'synthetic-test.mp4'
        video.write_bytes(b'0123456789')
        self.runtime.recorder.obs.path = str(video)
        thread = threading.Thread(target=self.runtime.listen,args=('127.0.0.1',0),daemon=True); thread.start()
        deadline = time.monotonic()+2
        while (not self.runtime.sock or self.runtime.sock.getsockname()[1] == 0) and time.monotonic()<deadline: time.sleep(.01)
        port = self.runtime.sock.getsockname()[1]
        with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as sender:
            for _ in range(3): sender.sendto(packet(),('127.0.0.1',port)); time.sleep(.02)
            sender.sendto(b'bad',('127.0.0.1',port))
        time.sleep(.05)
        with self.request('/api/stop',{}) as response: self.assertTrue(json.load(response)['ok'])
        with self.request('/api/sessions') as response: sessions = json.load(response)
        self.assertEqual(len(sessions),1)
        sid = sessions[0]['id']
        with self.request('/api/sessions/'+sid) as response: data = json.load(response)
        self.assertEqual(len(data['laps'][0]['rows']),3)
        self.assertIn('tireTempsC',data['laps'][0]['rows'][0])
        self.assertIn('steer',data['laps'][0]['rows'][0])
        self.assertEqual(data['meta']['videoPath'],str(video))
        with self.request('/api/sync/'+sid,{'offset':2.5}) as response: self.assertEqual(json.load(response)['offset'],2.5)
        with self.request('/api/video/'+sid,headers={'Range':'bytes=2-5'}) as response:
            self.assertEqual(response.status,206); self.assertEqual(response.read(),b'2345')
        with self.request('/api/status') as response: self.assertEqual(json.load(response)['invalid'],1)

    def test_sse_reports_live_without_recording(self):
        self.runtime.ingest(packet(event=False))
        self.runtime.pending.join()
        with self.request('/events') as response:
            event = response.readline().decode()
            state = json.loads(event[6:])
        self.assertEqual(state['mode'],'armed')
        self.assertEqual(state['packet']['speed'],90)
        self.assertIsNone(state['recording'])

    def test_cross_origin_and_invalid_host_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request('/api/stop',{},headers={'Origin':'http://attacker.example'})
        self.assertEqual(caught.exception.code,403)
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request('/api/status',headers={'Host':'attacker.example'})
        self.assertEqual(caught.exception.code,403)


if __name__ == '__main__': unittest.main()
