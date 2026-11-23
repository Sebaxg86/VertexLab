import io
import json
import tempfile
import threading
import unittest
import urllib.request
import zipfile
from pathlib import Path

from portable import export_session, import_session
from server import Runtime, ThreadingHTTPServer, handler_for
from test_racelab import FakeOBS, packet
from telemetry import decode


class PortableTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.source = self.root/'source'
        self.source.mkdir()
        self.sid = '1'*32
        self.video = self.source/'original.mp4'
        # Binary fixture for integrity/range tests, not a playable or simulated race.
        self.video.write_bytes(bytes(range(256))*4096)
        self.rows = [dict(decode(packet(stamp=i)), t=i/10, lap=i//2) for i in range(6)]
        self.telemetry = self.source/(self.sid+'.jsonl')
        self.telemetry.write_text(''.join(json.dumps(row)+'\n' for row in self.rows), encoding='utf-8')
        self.meta = dict(id=self.sid, name='Prueba portable', created=100, ended=200,
                         version=2, carOrdinal=1009, videoPath=str(self.video), offset=.012,
                         featured=True, syncState='estimated',
                         syncSegments=[dict(tStart=0,tEnd=.2,videoStart=0), dict(tStart=.2,tEnd=.5,videoStart=1.0)])
        (self.source/(self.sid+'.json')).write_text(json.dumps(self.meta), encoding='utf-8')
        self.view = dict(version=1, allMode=False, selected=[1,2], reference=2, t=.45,
                         videoChoices=[2,1], zoom=8, panNormalized=[.2,-.3], expandedMetric='speed')
        self.archive = self.root/'test.vrtx'

    def tearDown(self):
        self.tmp.cleanup()

    def export(self):
        export_session(self.meta, self.telemetry, self.archive, self.view)

    def rewrite(self, transform):
        with zipfile.ZipFile(self.archive) as z:
            contents = {name:z.read(name) for name in z.namelist()}
        transform(contents)
        with zipfile.ZipFile(self.archive,'w') as z:
            for name, payload in contents.items():
                z.writestr(name,payload)

    def test_roundtrip_preserves_raw_data_video_sync_and_view_with_new_identity(self):
        self.export()
        with zipfile.ZipFile(self.archive) as z:
            self.assertNotIn('videoPath', json.loads(z.read('session.json')))
            self.assertEqual(z.getinfo('video.mp4').compress_type,zipfile.ZIP_STORED)
        destination = self.root/'laptop'
        result = import_session(self.archive,destination)
        restored = json.loads((destination/(result['id']+'.json')).read_text(encoding='utf-8'))
        self.assertNotEqual(result['id'],self.sid)
        self.assertEqual(restored['syncSegments'],self.meta['syncSegments'])
        self.assertEqual(restored['offset'],.012)
        self.assertEqual(restored['portableView'],self.view)
        self.assertTrue(restored['featured'])
        self.assertEqual(Path(restored['videoPath']).read_bytes(),self.video.read_bytes())
        self.assertEqual((destination/(result['id']+'.jsonl')).read_bytes(),self.telemetry.read_bytes())
        second = import_session(self.archive,destination)
        self.assertNotEqual(result['id'],second['id'])
        self.assertTrue((destination/(result['id']+'.json')).is_file())

    def test_corruption_is_rejected_without_publishing_any_session(self):
        self.export()
        self.rewrite(lambda c:c.update({'video.mp4':b'corrupt'}))
        destination = self.root/'bad'
        with self.assertRaises(ValueError):
            import_session(self.archive,destination)
        self.assertEqual(list(destination.iterdir()),[])

    def test_same_size_video_tampering_is_caught_by_checksum(self):
        self.export()
        self.rewrite(lambda c:c.update({'video.mp4':b'X'+c['video.mp4'][1:]}))
        with self.assertRaisesRegex(ValueError, 'dañado'):
            import_session(self.archive,self.root/'checksum')
        self.assertEqual(list((self.root/'checksum').iterdir()),[])

    def test_unsaved_analysis_offset_is_carried_into_portable_metadata(self):
        export_session(self.meta,self.telemetry,self.archive,dict(self.view,offset=.345))
        with zipfile.ZipFile(self.archive) as archive:
            self.assertEqual(json.loads(archive.read('session.json'))['offset'],.345)

    def test_unknown_version_and_extra_paths_are_rejected(self):
        for mutation in ('version','path'):
            self.export()
            def change(contents):
                if mutation == 'path':
                    contents['../escape.txt'] = b'unsafe'
                else:
                    manifest = json.loads(contents['manifest.json'])
                    manifest['version'] = 999
                    contents['manifest.json'] = json.dumps(manifest).encode()
            self.rewrite(change)
            with self.assertRaises(ValueError):
                import_session(self.archive,self.root/'rejected')
        self.assertFalse((self.root/'escape.txt').exists())

    def test_missing_video_and_active_recording_cannot_export_silently(self):
        for meta in (dict(self.meta,ended=None),dict(self.meta,videoPath=str(self.root/'missing.mp4'))):
            with self.assertRaises(ValueError):
                export_session(meta,self.telemetry,self.archive,self.view)

    def test_telemetry_only_session_is_explicit_and_remains_usable(self):
        export_session(dict(self.meta,videoPath=None),self.telemetry,self.archive,self.view)
        result = import_session(self.archive,self.root/'no-video')
        self.assertFalse(result['hasVideo'])
        self.assertEqual(result['samples'],6)

    def test_legacy_recordings_without_version_or_end_metadata_remain_portable(self):
        legacy = {key:self.meta[key] for key in ('id','name','created','offset')}
        export_session(legacy,self.telemetry,self.archive,self.view)
        destination = self.root/'legacy'
        result = import_session(self.archive,destination)
        meta = json.loads((destination/(result['id']+'.json')).read_text(encoding='utf-8'))
        self.assertEqual(meta['version'],1)
        self.assertIsNone(meta['videoPath'])
        self.assertEqual((destination/(result['id']+'.jsonl')).read_bytes(),self.telemetry.read_bytes())

    def test_nonfinite_or_unordered_telemetry_is_rejected(self):
        for rows in ([dict(self.rows[0],t=2),self.rows[1]], [dict(self.rows[0],x=float('nan'))]):
            self.telemetry.write_text(''.join(json.dumps(r)+'\n' for r in rows))
            with self.assertRaises(ValueError):
                self.export()

    def test_http_export_import_then_video_range_is_identical_on_second_runtime(self):
        other = self.root/'other-device'
        other.mkdir()
        runtimes = [Runtime(self.source,FakeOBS()),Runtime(other,FakeOBS())]
        servers = []
        try:
            for runtime in runtimes:
                server = ThreadingHTTPServer(('127.0.0.1',0),handler_for(runtime))
                server.daemon_threads = True
                threading.Thread(target=server.serve_forever,daemon=True).start()
                servers.append(server)
            def request(index,route,payload=None,headers=None):
                base = 'http://127.0.0.1:'+str(servers[index].server_port)
                return urllib.request.urlopen(urllib.request.Request(base+route,data=payload,headers=headers or {}),timeout=15)
            with request(0,'/api/portable/export/'+self.sid,json.dumps({'view':self.view}).encode(),{'Content-Type':'application/json'}) as response:
                prepared = json.load(response)
            with request(0,prepared['url']) as response:
                package = response.read()
                self.assertIn('.vrtx',response.headers['Content-Disposition'])
            self.assertEqual(runtimes[0].portable_exports,{})
            with request(1,'/api/portable/import',package,{'Content-Type':'application/vnd.vertexlab.session+zip'}) as response:
                imported = json.load(response)
            with request(1,'/api/sessions/'+imported['id']) as response:
                session = json.load(response)
            self.assertEqual(session['meta']['portableView'],self.view)
            self.assertEqual(session['meta']['syncSegments'],self.meta['syncSegments'])
            with request(1,'/api/video/'+imported['id'],headers={'Range':'bytes=123-456'}) as response:
                self.assertEqual(response.status,206)
                self.assertEqual(response.read(),self.video.read_bytes()[123:457])
        finally:
            for server in servers:
                server.shutdown();server.server_close()
            for runtime in runtimes:
                runtime.close()


if __name__ == '__main__':
    unittest.main()
