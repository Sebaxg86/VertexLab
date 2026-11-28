import io
import json
import zipfile
import unittest
from pathlib import Path
from portable import import_sessions
from server import Runtime
import test_portable as portable_tests
from test_racelab import FakeOBS


class BatchPortableTests(unittest.TestCase):
    setUp = portable_tests.PortableTests.setUp
    tearDown = portable_tests.PortableTests.tearDown
    export = portable_tests.PortableTests.export

    def test_batch_roundtrip_keeps_video_telemetry_and_duplicate_names(self):
        second = '2'*32
        meta = dict(self.meta, id=second)
        (self.source/(second+'.json')).write_text(json.dumps(meta))
        (self.source/(second+'.jsonl')).write_bytes(self.telemetry.read_bytes())
        runtime = Runtime(self.source, FakeOBS())
        try:
            result = runtime.prepare_exports([self.sid,second], '2026-11-26')
            self.assertEqual(result['name'], 'VRTX-Sessions-2026-11-26.zip')
            package = runtime.portable_exports[result['url'].rsplit('/',1)[-1]][0]
            with zipfile.ZipFile(package) as outer:
                self.assertEqual(len(set(outer.namelist())),2)
                for entry in outer.infolist():
                    self.assertEqual(entry.compress_type,zipfile.ZIP_STORED)
                    with zipfile.ZipFile(io.BytesIO(outer.read(entry))) as session:
                        self.assertEqual(session.read('video.mp4'),self.video.read_bytes())
            destination = self.root/'imported'
            restored = import_sessions(package,destination)
            self.assertEqual(restored['count'],2)
            for item in restored['sessions']:
                info=json.loads((destination/(item['id']+'.json')).read_text())
                self.assertEqual(Path(info['videoPath']).parent.resolve(), destination.resolve())
                self.assertEqual(Path(info['videoPath']).read_bytes(),self.video.read_bytes())
                self.assertEqual((destination/(item['id']+'.jsonl')).read_bytes(),self.telemetry.read_bytes())
        finally:
            runtime.close()

    def test_one_session_keeps_original_vrtx_format(self):
        runtime=Runtime(self.source,FakeOBS())
        try:
            result=runtime.prepare_exports([self.sid],'2026-11-26')
            self.assertTrue(result['name'].endswith('.vrtx'))
        finally:
            runtime.close()

    def test_corrupt_second_session_publishes_nothing(self):
        self.export()
        package=self.root/'batch.zip'
        with zipfile.ZipFile(package,'w') as archive:
            archive.write(self.archive,'one.vrtx')
            archive.writestr('two.vrtx',b'invalid')
        destination=self.root/'destination'
        destination.mkdir()
        original=destination/'keep.vrtx'
        original.write_bytes(b'keep existing')
        with self.assertRaises(ValueError):import_sessions(package,destination)
        self.assertEqual(list(destination.iterdir()),[original])
        self.assertEqual(original.read_bytes(),b'keep existing')

    def test_zip_paths_and_non_session_files_are_rejected(self):
        for name in ['../escape.vrtx','C:/escape.vrtx','/escape.vrtx','readme.txt']:
            package=self.root/'bad.zip'
            with zipfile.ZipFile(package,'w') as archive:archive.writestr(name,b'bad')
            with self.assertRaises(ValueError):import_sessions(package,self.root/'destination')
