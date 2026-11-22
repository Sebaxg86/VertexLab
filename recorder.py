"""Race lifecycle and a pause-free analysis clock, independent from UDP/UI."""
import json
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

    def __init__(self, data, obs):
        self.data = Path(data)
        self.data.mkdir(exist_ok=True, parents=True)
        self.obs = obs
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
        self.error = None
        self.last_saved = None
        self.revision = 0

    def status(self):
        return dict(mode=self.mode, auto=self.auto, recording=self.meta['id'] if self.meta else None,
                    sessionName=self.meta['name'] if self.meta else None, elapsed=self.t,
                    error=self.error, lastSaved=self.last_saved, revision=self.revision,
                    obs=self.obs.status())

    def persist(self):
        if self.meta:
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
        ordinal = row.get('carOrdinal', 0) if row else 0
        self.meta = dict(id=uuid.uuid4().hex, name=name or car_name(ordinal), created=time.time(),
                         offset=0, version=2, carOrdinal=ordinal, carClass=(row or {}).get('carClass'),
                         carPI=(row or {}).get('carPI'), automatic=not manual, events=[],
                         syncSegments=[], syncState='none', ended=None, videoPath=None)
        self.file = (self.data/(self.meta['id']+'.jsonl')).open('a', encoding='utf-8')
        self.mode = 'recording'
        self.t = 0
        self.last = wall
        self.last_row = None
        self.segment = None
        self.negative_since = None
        self.error = None
        anchor = self.obs_call('start')
        if anchor:
            self.set_segment(anchor, wall)
        self.persist()
        self.revision += 1
        return self.meta['id']

    def set_segment(self, anchor, wall):
        # Acknowledge measured OBS output time. Do not claim coverage for telemetry
        # received before the confirmed anchor, including resumed sections.
        coverage_start = self.t + max(0, anchor['wall']-wall)
        self.segment = dict(tStart=coverage_start, tEnd=coverage_start,
                            videoStart=anchor['video'],
                            uncertainty=anchor['uncertainty'], wallAnchor=anchor['wall'])
        self.meta['syncSegments'].append(self.segment)
        if self.meta['syncState'] != 'error':
            self.meta['syncState'] = 'estimated'

    def pause(self, reason='silence'):
        if self.mode != 'recording':
            return
        self.mode = 'paused'
        self.meta['events'].append(dict(type='pause', t=self.t, reason=reason))
        self.obs_call('pause')
        self.persist()

    def heartbeat(self, wall):
        if self.meta and self.last is not None and wall-self.last >= self.PAUSE_AFTER:
            self.pause()

    def finish(self, reason='manual'):
        if not self.meta:
            # Retry a failed stop without silently abandoning a recording we own.
            if self.obs.owned:
                path = self.obs_call('stop')
                if path and self.last_saved:
                    file = self.data/(self.last_saved+'.json')
                    meta = json.loads(file.read_text(encoding='utf-8'))
                    meta['videoPath'] = path
                    file.write_text(json.dumps(meta, ensure_ascii=False), encoding='utf-8')
            return
        path = self.obs_call('stop')
        if path:
            self.meta['videoPath'] = path
        self.meta['ended'] = time.time()
        self.meta['duration'] = self.t
        self.meta['events'].append(dict(type='end', t=self.t, reason=reason))
        self.persist()
        self.file.close()
        self.last_saved = self.meta['id']
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
                self.set_segment(anchor, wall)
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
        self.file.write(json.dumps(row)+'\n')
        self.file.flush()
        self.last = wall
        self.last_row = row
