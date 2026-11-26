import json
from pathlib import Path
import tempfile
import unittest
from uninstall_cleanup import clean_preferences


class UninstallCleanupTests(unittest.TestCase):
    def fixture(self, root, data):
        (root / 'connect.json').write_text(json.dumps({'dataPath': str(data)}))
        (root / 'window.json').write_text('{}')
        cache = root / 'WebView'
        cache.mkdir()
        (cache / 'cache.bin').write_bytes(b'cache')
        return cache

    def test_cleans_preferences_but_keeps_sessions_videos_and_unknown_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / 'sessions'
            sessions.mkdir()
            sample = sessions / 'saved.jsonl'
            sample.write_bytes(b'telemetry')
            video = sessions / 'video.mp4'
            video.write_bytes(b'video')
            database = root / 'library.db'
            database.write_bytes(b'legacy library')
            cache = self.fixture(root, sessions)
            clean_preferences(root)
            self.assertFalse(cache.exists())
            self.assertFalse((root / 'connect.json').exists())
            self.assertEqual(sample.read_bytes(), b'telemetry')
            self.assertEqual(video.read_bytes(), b'video')
            self.assertEqual(database.read_bytes(), b'legacy library')

    def test_preserves_cache_when_configured_library_is_inside_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cache = self.fixture(root, root / 'WebView' / 'sessions')
            clean_preferences(root)
            self.assertTrue((cache / 'cache.bin').exists())

    def test_preserves_unexpected_media_in_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cache = self.fixture(root, root / 'sessions')
            (cache / 'saved.vrtx').write_bytes(b'archive')
            clean_preferences(root)
            self.assertEqual((cache / 'saved.vrtx').read_bytes(), b'archive')

    def test_corrupt_config_keeps_cache_and_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cache = self.fixture(root, root / 'sessions')
            (root / 'connect.json').write_text('{invalid')
            clean_preferences(root)
            self.assertTrue(cache.exists())

    def test_external_library_remains_byte_for_byte(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root = base / 'preferences'
            root.mkdir()
            external = base / 'my-races'
            external.mkdir()
            recording = external / 'race.mp4'
            recording.write_bytes(b'original recording')
            self.fixture(root, external)
            clean_preferences(root)
            self.assertEqual(recording.read_bytes(), b'original recording')

    def test_linked_preferences_root_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            target = base / 'target'
            target.mkdir()
            (target / 'connect.json').write_text('{}')
            link = base / 'redirected'
            try:
                link.symlink_to(target, target_is_directory=True)
            except OSError:
                self.skipTest('Directory links unavailable on this machine')
            with self.assertRaises(ValueError):
                clean_preferences(link)
            self.assertTrue((target / 'connect.json').exists())
