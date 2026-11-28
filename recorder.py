"""Race lifecycle and a pause-free analysis clock, independent from UDP/UI."""
import json
import re
import time
import uuid
from pathlib import Path

CATALOG_PATH = Path(__file__).parent/'cars.json'
CARS = json.loads(CATALOG_PATH.read_text(encoding='utf-8')) if CATALOG_PATH.exists() else {}


def car_name(ordinal):
    return CARS.get(str(ordinal), f'Vehículo #{ordinal}')


class Recorder:
    PAUSE_AFTER = .6
    END_CONFIRM = 1.5

    def __init__(self, data, obs, ownership_path=None):
        self.data = Path(data)
        self.data.mkdir(exist_ok=True, parents=True)
        self.obs = obs
        self.ownership_path = Path(ownership_path) if ownership_path else None
        self.auto = True
        self.meta = None
        self.file = None
        self.mode = 'armed'
        self.last = None
        self.last_row = None
        self.t = 0
        self.negative_since = None
        self.block_auto = False
        self.segment = None
        self.paused_video = None
        self.error = None
        self.last_saved = None
        self.revision = 0

    def _lease_path(self):
        return self.ownership_path if self.ownership_path is not None else self.data / '.obs-owned.json'

    def _write_obs_lease(self):
        if not self.meta:
            return
        path = self._lease_path()
        try:
            path.parent.mkdir(exist_ok=True, parents=True)
            payload = dict(
                sessionId=self.meta['id'],
                dataPath=str(self.data.resolve()),
                obsPort=getattr(self.obs, 'port', 4455),
                startedAt=time.time(),
            )
            temporary = path.with_suffix('.tmp')
            temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
            temporary.replace(path)
        except OSError:
            pass

    def _read_obs_lease(self):
        path = self._lease_path()
        try:
            if not path.is_file():
                return None
            data = json.loads(path.read_text(encoding='utf-8'))
            return data if isinstance(data, dict) and data.get('sessionId') else None
        except (OSError, ValueError):
            return None

    def _clear_obs_lease(self):
        try:
            self._lease_path().unlink(missing_ok=True)
        except OSError:
            pass

    @staticmethod
    def _expected_video_duration(meta):
        segments = meta.get('syncSegments') or []
        if not segments:
            return None
        last = segments[-1]
        vstart = last.get('videoStart')
        tstart = last.get('tStart')
        tend = last.get('tEnd')
        if not all(isinstance(v, (int, float)) for v in (vstart, tstart, tend)):
            return None
        return float(vstart) + max(0.0, float(tend) - float(tstart))

    def _finalize_orphan_session(self, session_path, video_path=None):
        try:
            if not session_path.is_file():
                return
            meta = json.loads(session_path.read_text(encoding='utf-8'))
            if video_path and not meta.get('videoPath'):
                meta['videoPath'] = video_path
            if meta.get('ended') is None:
                segments = meta.get('syncSegments') or []
                duration = meta.get('duration')
                if not isinstance(duration, (int, float)):
                    duration = float(segments[-1]['tEnd']) if segments and isinstance(segments[-1].get('tEnd'), (int, float)) else 0.0
                meta['ended'] = time.time()
                meta['duration'] = duration
                meta.setdefault('events', []).append(dict(type='end', t=duration, reason='recovered-after-restart'))
            temporary = session_path.with_suffix('.tmp')
            temporary.write_text(json.dumps(meta, ensure_ascii=False), encoding='utf-8')
            temporary.replace(session_path)
        except (OSError, ValueError):
            pass

    def _find_legacy_orphan_session(self):
        if not self.data.is_dir():
            return None, None
        candidates = sorted(self.data.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True)
        for path in candidates[:10]:
            try:
                meta = json.loads(path.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                continue
            if meta.get('ended') is None and not meta.get('videoPath') and meta.get('syncSegments'):
                return path, meta
        return None, None

    def recover_obs_recording(self):
        """Recover an OBS recording left active/paused by a previous VertexLab instance."""
        if self.meta or self.obs.owned or not getattr(self.obs, 'enabled', False):
            return False
        lease = self._read_obs_lease()
        legacy_path, legacy_meta = (None, None) if lease else self._find_legacy_orphan_session()
        if not lease and not legacy_meta:
            return False
        status = getattr(self.obs, 'last_record_status', None)
        if status is None:
            request = getattr(self.obs, 'request', None)
            if not request or getattr(self.obs, 'ws', None) is None:
                return False
            try:
                status = request('GetRecordStatus')
            except Exception:
                return False
        if not isinstance(status, dict):
            return False
        active = bool(status.get('outputActive'))
        if not active:
            if lease:
                session_dir = Path(lease.get('dataPath') or self.data)
                self._finalize_orphan_session(session_dir / (lease['sessionId'] + '.json'))
                self._clear_obs_lease()
                self.revision += 1
            return False

        target_path = None
        if lease:
            lease_port = lease.get('obsPort')
            if lease_port is None or int(lease_port) == int(getattr(self.obs, 'port', 4455)):
                session_dir = Path(lease.get('dataPath') or self.data)
                candidate = session_dir / (lease['sessionId'] + '.json')
                target_path = candidate if candidate.is_file() else (self.data / (lease['sessionId'] + '.json'))
        elif legacy_meta and status.get('outputPaused') is True:
            expected = self._expected_video_duration(legacy_meta)
            actual = status.get('outputDuration')
            if expected is not None and isinstance(actual, (int, float)) and abs(expected - actual / 1000.0) <= 5.0:
                target_path = legacy_path

        if target_path is None:
            return False

        self.obs.owned = True
        try:
            video_path = self.obs.stop()
        except Exception as exc:
            self.obs.owned = False
            self.error = str(exc)
            self.obs.error = self.error
            return False
        self._finalize_orphan_session(target_path, video_path=video_path)
        self._clear_obs_lease()
        self.error = None
        self.obs.error = None
        self.revision += 1
        return True

    def status(self):
        return dict(mode=self.mode, auto=self.auto, recording=self.meta['id'] if self.meta else None,
                    sessionName=self.meta['name'] if self.meta else None, elapsed=self.t,
                    error=self.error, lastSaved=self.last_saved, revision=self.revision,
                    obs=self.obs.status())

    def persist(self):
        if self.meta:
            self.data.mkdir(exist_ok=True, parents=True)
            path = self.data/(self.meta['id']+'.json')
            temporary = path.with_suffix('.tmp')
            temporary.write_text(json.dumps(self.meta, ensure_ascii=False), encoding='utf-8')
            temporary.replace(path)

    def obs_call(self, method):
        try:
            return getattr(self.obs, method)()
        except Exception as e:
            self.error = str(e)
            self.obs.error = self.error
            if self.meta:
                self.meta['syncState'] = 'error'
                self.meta['events'].append(dict(type='obs-error', t=self.t, message=self.error))
                self.persist()
            return None

    def begin(self, wall, row=None, name=None, manual=False):
        if self.meta:
            raise ValueError('Ya hay una sesión abierta')
        if self.obs.owned:
            raise ValueError('OBS conserva una grabación pendiente. Reintenta finalizarla antes de grabar otra sesión.')
        self.data.mkdir(exist_ok=True, parents=True)
        name = name.strip() if name else None
        if manual and not name:
            counter_path = self.data/'.manual-sequence'
            try:
                counter = int(counter_path.read_text())
            except (FileNotFoundError, ValueError):
                counter = 0
            for path in self.data.glob('*.json'):
                match = re.fullmatch(r'Sesión libre (\d+)', json.loads(path.read_text(encoding='utf-8')).get('name', ''))
                if match:
                    counter = max(counter, int(match[1]))
            counter += 1
            temporary = self.data/'.manual-sequence.tmp'
            temporary.write_text(str(counter))
            temporary.replace(counter_path)
            name = f'Sesión libre {counter:03d}'
        ordinal = row.get('carOrdinal', 0) if row else 0
        meta = dict(id=uuid.uuid4().hex, name=name or car_name(ordinal), created=time.time(),
                    offset=0, version=2, carOrdinal=ordinal, carClass=(row or {}).get('carClass'),
                    carPI=(row or {}).get('carPI'), automatic=not manual, events=[],
                    syncSegments=[], syncState='none', ended=None, videoPath=None)
        handle = (self.data/(meta['id']+'.jsonl')).open('a', encoding='utf-8')
        try:
            self.meta = meta
            self.file = handle
            self.mode = 'recording'
            self.t = 0
            self.last = wall
            self.last_row = None
            self.segment = None
            self.paused_video = None
            self.negative_since = None
            self.error = None
            anchor = self.obs_call('start')
            if self.obs.owned:
                self._write_obs_lease()
            if anchor:
                self.set_segment(anchor, wall, baseline=0)
            self.persist()
            self.revision += 1
            return self.meta['id']
        except Exception:
            try:
                handle.close()
            except OSError:
                pass
            self.meta = None
            self.file = None
            self.mode = 'armed' if self.auto else 'idle'
            self.segment = None
            self.paused_video = None
            self.negative_since = None
            raise

    def set_segment(self, anchor, wall, baseline=None):
        # Only backdate coverage by footage actually confirmed since start or
        # the confirmed pause. Never subtract the entire cumulative OBS duration
        # on resume. Timestamped queued UDP packets remain on their receive clock.
        anchor_t = self.t + max(0, anchor['wall']-wall)
        footage = max(0, anchor['video']-baseline) if baseline is not None else 0
        coverage_start = max(self.t, anchor_t-footage)
        self.segment = dict(tStart=coverage_start, tEnd=coverage_start,
                            videoStart=anchor['video']+coverage_start-anchor_t,
                            uncertainty=anchor['uncertainty'], wallAnchor=anchor['wall'])
        if anchor.get('observations'):
            self.segment['anchorObservations'] = anchor['observations']
            self.segment['anchorMethod'] = anchor['method']
        self.meta['syncSegments'].append(self.segment)
        if self.meta['syncState'] != 'error':
            self.meta['syncState'] = 'estimated'

    def pause(self, reason='silence'):
        if self.mode != 'recording':
            return
        self.mode = 'paused'
        self.meta['events'].append(dict(type='pause', t=self.t, reason=reason))
        anchor = self.obs_call('pause')
        self.paused_video = anchor['video'] if anchor else None
        self.persist()

    def heartbeat(self, wall):
        if self.meta and self.last is not None and wall-self.last >= self.PAUSE_AFTER:
            self.pause()

    def finish(self, reason='manual'):
        if not self.meta:
            # Retry a failed stop without silently abandoning a recording we own.
            if self.obs.owned:
                path = self.obs_call('stop')
                if not self.obs.owned:
                    self._clear_obs_lease()
                if path and self.last_saved:
                    file = self.data/(self.last_saved+'.json')
                    meta = json.loads(file.read_text(encoding='utf-8'))
                    meta['videoPath'] = path
                    file.write_text(json.dumps(meta, ensure_ascii=False), encoding='utf-8')
            return
        path = self.obs_call('stop')
        if not self.obs.owned:
            self._clear_obs_lease()
        if path:
            self.meta['videoPath'] = path
        self.meta['ended'] = time.time()
        self.meta['duration'] = self.t
        self.meta['events'].append(dict(type='end', t=self.t, reason=reason))
        try:
            self.persist()
            self.last_saved = self.meta['id']
        finally:
            if self.file:
                try:
                    self.file.close()
                except OSError:
                    pass
            self.meta = None
            self.file = None
            self.mode = 'armed' if self.auto else 'idle'
            self.segment = None
            self.negative_since = None
            self.revision += 1
            if reason == 'manual':
                self.block_auto = True

    def feed(self, row, wall):
        manual = self.meta is not None and not self.meta['automatic']
        in_event = row['active'] and (manual or row['racePosition'] > 0 or row['lapTime'] > 0)
        if not in_event:
            self.block_auto = False
            if self.meta:
                self.pause('inactive-event')
                # Inactive packets are also sent by some pause states. Only active
                # free-roam with both event signals cleared confirms departure.
                if row['active']:
                    if self.negative_since is None:
                        self.negative_since = wall
                    elif wall-self.negative_since >= self.END_CONFIRM:
                        self.finish('returned-to-free-roam')
                else:
                    self.negative_since = None
            return

        self.negative_since = None
        if self.meta and self.last_row:
            previous = self.last_row
            fresh_clock = row['raceTime'] < 2 and previous['raceTime'] > 5
            different_car = row['carOrdinal'] and self.meta['carOrdinal'] and row['carOrdinal'] != self.meta['carOrdinal']
            if fresh_clock or different_car:
                self.finish('new-event')
        if not self.meta:
            if not self.auto or self.block_auto:
                return
            self.begin(wall, row)

        resumed = self.mode == 'paused'
        if self.last is not None:
            # A resumed section advances by one sample, never by the pause length.
            self.t += 0 if resumed else max(0, wall-self.last)
        if resumed:
            self.mode = 'recording'
            self.meta['events'].append(dict(type='resume', t=self.t))
            self.segment = None
            anchor = self.obs_call('resume')
            if anchor:
                self.set_segment(anchor, wall, baseline=self.paused_video)
        if not self.meta['carOrdinal'] and row['carOrdinal']:
            self.meta.update(carOrdinal=row['carOrdinal'], carClass=row['carClass'], carPI=row['carPI'])
            if self.meta['automatic']:
                self.meta['name'] = car_name(row['carOrdinal'])
            self.persist()
        row = dict(row, t=self.t, wall=wall, breakBefore=resumed,
                   videoTime=(self.segment['videoStart'] + self.t-self.segment['tStart'])
                   if self.segment and self.t >= self.segment['tStart'] else None)
        if self.segment:
            self.segment['tEnd'] = max(self.segment['tStart'], self.t)
        if self.file is None:
            self.data.mkdir(exist_ok=True, parents=True)
            self.file = (self.data/(self.meta['id']+'.jsonl')).open('a', encoding='utf-8')
        self.file.write(json.dumps(row)+'\n')
        self.file.flush()
        self.last = wall
        self.last_row = row
