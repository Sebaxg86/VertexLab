import gzip
import json
import tempfile
import unittest
import urllib.parse
from pathlib import Path

from cloud_sync import CloudError, CloudSyncService


class FakeCloudTransport:
    """In-memory mock for Supabase REST/Edge Functions and Google Drive API v3."""

    def __init__(self):
        self.files = {}
        self.uploads = {}
        self.rows = {}
        self.profile = {
            'id': 'user-123',
            'email': 'driver@example.com',
            'drive_connected': True,
            'drive_email': 'driver@gmail.com',
            'drive_root_folder_id': 'root_folder_1234',
            'drive_root_folder_name': 'VertexLab',
        }
        self.next_id = 1
        self.deleted_drive_ids = []

    def _new_id(self, prefix='drv'):
        self.next_id += 1
        return f'{prefix}_{self.next_id:08d}'

    def __call__(self, url, method='GET', headers=None, data=None, timeout=30):
        headers = headers or {}
        if '/functions/v1/drive-auth' in url:
            body = json.loads(data.decode('utf-8'))
            action = body.get('action')
            if action == 'token':
                return 200, {}, json.dumps({
                    'connected': True,
                    'accessToken': 'ya29.fake-drive-token',
                    'expiresIn': 3600,
                    'driveEmail': self.profile['drive_email'],
                    'driveRootFolderId': self.profile['drive_root_folder_id'],
                    'driveRootFolderName': self.profile['drive_root_folder_name'],
                }).encode('utf-8')
            if action == 'folder':
                self.profile['drive_root_folder_id'] = body['folderId']
                self.profile['drive_root_folder_name'] = body['folderName']
                return 200, {}, json.dumps({
                    'ok': True,
                    'driveRootFolderId': body['folderId'],
                    'driveRootFolderName': body['folderName'],
                }).encode('utf-8')
            if action == 'disconnect':
                self.profile['drive_connected'] = False
                return 200, {}, json.dumps({'connected': False}).encode('utf-8')

        if '/upload/drive/v3/files' in url and method == 'POST':
            meta = json.loads(data.decode('utf-8'))
            session_url = f'https://upload.fake/{self._new_id("up")}'
            self.uploads[session_url] = {'meta': meta, 'chunks': bytearray()}
            return 200, {'Location': session_url}, b''

        if url.startswith('https://upload.fake/') and method == 'PUT':
            slot = self.uploads[url]
            slot['chunks'].extend(data or b'')
            content_range = headers.get('Content-Range', '')
            if content_range:
                _, span = content_range.split(' ')
                bounds, total = span.split('/')
                _, end = bounds.split('-')
                if int(end) + 1 < int(total):
                    return 308, {}, b''
            fid = self._new_id('file')
            self.files[fid] = {'meta': slot['meta'], 'bytes': bytes(slot['chunks'])}
            return 200, {}, json.dumps({'id': fid, 'name': slot['meta']['name'], 'size': len(slot['chunks'])}).encode('utf-8')

        if '/drive/v3/files' in url and method == 'POST':
            meta = json.loads(data.decode('utf-8'))
            fid = self._new_id('dir')
            self.files[fid] = {'meta': meta, 'bytes': b''}
            return 200, {}, json.dumps({'id': fid, 'name': meta['name']}).encode('utf-8')

        if '/drive/v3/files/' in url and 'alt=media' in url and method == 'GET':
            fid = url.split('/drive/v3/files/')[1].split('?')[0]
            payload = self.files[fid]['bytes']
            if 'Range' in headers:
                start_s, end_s = headers['Range'].replace('bytes=', '').split('-')
                start, end = int(start_s), int(end_s)
                return 206, {}, payload[start:end + 1]
            return 200, {}, payload

        if '/drive/v3/files/' in url and method == 'DELETE':
            fid = url.split('/drive/v3/files/')[1].split('?')[0]
            self.deleted_drive_ids.append(fid)
            self.files.pop(fid, None)
            return 204, {}, b''

        if '/rest/v1/cloud_sessions' in url:
            if method == 'POST':
                row = json.loads(data.decode('utf-8'))
                self.rows[row['id']] = row
                return 201, {}, json.dumps([row]).encode('utf-8')
            if method == 'GET':
                return 200, {}, json.dumps(list(self.rows.values())).encode('utf-8')
            if method == 'PATCH':
                sid = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)['id'][0].removeprefix('eq.')
                self.rows[sid].update(json.loads(data.decode('utf-8')))
                return 200, {}, json.dumps([self.rows[sid]]).encode('utf-8')
            if method == 'DELETE':
                sid = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)['id'][0].removeprefix('eq.')
                self.rows.pop(sid, None)
                return 204, {}, b''

        return 404, {}, b'{}'


class CloudSyncTests(unittest.TestCase):
    def _make_session(self, directory, sid='0123456789abcdef0123456789abcdef', with_video=True):
        directory = Path(directory)
        video_path = None
        if with_video:
            video_path = directory / 'obs-capture.mp4'
            video_path.write_bytes(b'FAKE-MP4-HEADER-' + bytes(range(256)) * 2048)
        meta = {
            'id': sid,
            'name': 'Monza Test',
            'created': 1700000000.0,
            'ended': 1700000120.0,
            'duration': 120.0,
            'offset': 0.15,
            'version': 2,
            'carOrdinal': 123,
            'carClass': 4,
            'carPI': 800,
            'automatic': True,
            'featured': True,
            'syncSegments': [{'tStart': 0.0, 'tEnd': 10.0, 'videoStart': 0.0}],
            'videoPath': str(video_path) if video_path else None,
        }
        rows = [
            {'t': 0.0, 'timestamp': 1000, 'lap': 0, 'x': 0.0, 'z': 0.0, 'speed': 10.0},
            {'t': 1.0, 'timestamp': 2000, 'lap': 0, 'x': 15.0, 'z': 5.0, 'speed': 30.0},
            {'t': 2.0, 'timestamp': 3000, 'lap': 1, 'x': 30.0, 'z': 15.0, 'speed': 40.0},
        ]
        (directory / f'{sid}.json').write_text(json.dumps(meta), encoding='utf-8')
        (directory / f'{sid}.jsonl').write_text('\n'.join(json.dumps(r) for r in rows) + '\n', encoding='utf-8')
        return sid, video_path

    def test_sync_uploads_components_and_downloads_without_duplicating(self):
        transport = FakeCloudTransport()
        service = CloudSyncService('https://demo.supabase.co', 'anon-key', http=transport)
        service.set_session('user-jwt', {'id': 'user-123', 'email': 'driver@example.com'}, dict(transport.profile))

        with tempfile.TemporaryDirectory() as src_dir, tempfile.TemporaryDirectory() as dst_dir:
            sid, video_path = self._make_session(src_dir)
            row = service.sync_session(src_dir, sid)

            self.assertEqual(row['id'], sid)
            self.assertEqual(row['telemetry_encoding'], 'gzip')
            self.assertEqual(row['video_size'], video_path.stat().st_size)
            self.assertIn(row['drive_meta_file_id'], transport.files)
            self.assertIn(row['drive_telemetry_file_id'], transport.files)
            self.assertIn(row['drive_video_file_id'], transport.files)

            # Telemetry uploaded gzip-compressed
            decompressed = gzip.decompress(transport.files[row['drive_telemetry_file_id']]['bytes']).decode('utf-8')
            self.assertEqual(len(decompressed.strip().splitlines()), 3)

            # Download to a second device
            dl = service.download_session(dst_dir, row)
            self.assertFalse(dl['alreadyLocal'])
            self.assertTrue(dl['hasVideo'])
            self.assertTrue((Path(dst_dir) / f'{sid}.json').is_file())
            self.assertTrue((Path(dst_dir) / f'{sid}.jsonl').is_file())
            self.assertTrue((Path(dst_dir) / f'{sid}.mp4').is_file())
            self.assertEqual((Path(dst_dir) / f'{sid}.mp4').read_bytes(), video_path.read_bytes())

            # Second download does not duplicate files
            dl2 = service.download_session(dst_dir, row)
            self.assertTrue(dl2['alreadyLocal'])

            # Delete from cloud removes Drive folder and Supabase row
            service.delete_cloud_session(sid, row['drive_folder_id'])
            self.assertIn(row['drive_folder_id'], transport.deleted_drive_ids)
            self.assertEqual(service.list_cloud_sessions(), [])

    def test_sync_rejects_active_unended_v2_session(self):
        transport = FakeCloudTransport()
        service = CloudSyncService('https://demo.supabase.co', 'anon-key', http=transport)
        service.set_session('user-jwt', {'id': 'user-123'}, dict(transport.profile))

        with tempfile.TemporaryDirectory() as src_dir:
            sid, _ = self._make_session(src_dir, with_video=False)
            meta_path = Path(src_dir) / f'{sid}.json'
            meta = json.loads(meta_path.read_text(encoding='utf-8'))
            meta['ended'] = None
            meta_path.write_text(json.dumps(meta), encoding='utf-8')
            with self.assertRaises(CloudError):
                service.sync_session(src_dir, sid)


if __name__ == '__main__':
    unittest.main()
