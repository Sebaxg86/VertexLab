"""FH6 324-byte little-endian Data Out decoder. See README for source."""
import math
import struct

def decode(data):
    if len(data) != 324:
        raise ValueError(f'Expected 324 bytes, received {len(data)}')
    def f(offset):
        value = struct.unpack_from('<f', data, offset)[0]
        if not math.isfinite(value):
            raise ValueError('Non-finite telemetry')
        return value
    return dict(active=struct.unpack_from('<i', data)[0] == 1,
                timestamp=struct.unpack_from('<I', data, 4)[0],
                x=f(244), y=f(248), z=f(252), speed=f(256)*3.6,
                distance=f(292), lapTime=f(304), raceTime=f(308),
                lap=struct.unpack_from('<H', data, 312)[0],
                racePosition=data[314],
                carOrdinal=struct.unpack_from('<i', data, 212)[0],
                carClass=struct.unpack_from('<i', data, 216)[0],
                carPI=struct.unpack_from('<i', data, 220)[0],
                rpm=f(16), engineMaxRpm=f(8), gear=data[319],
                smashableVelDiff=f(236), smashableMass=f(240),
                steer=struct.unpack_from('<b', data, 320)[0],
                accelX=f(20), accelY=f(24), accelZ=f(28),
                tireTempsC=[(f(268+i*4)-32)*5/9 for i in range(4)],
                tireSlipCombined=[f(180+i*4) for i in range(4)],
                tireSlipRatio=[f(84+i*4) for i in range(4)],
                suspension=[f(68+i*4) for i in range(4)],
                throttle=data[315]/255*100, brake=data[316]/255*100)

def analyze(rows):
    laps = []
    for row in rows:
        if not laps or row['lap'] != laps[-1]['number'] or row['timestamp'] < laps[-1]['rows'][-1]['timestamp']:
            laps.append(dict(number=row['lap'], rows=[], partial=True))
        lap = laps[-1]
        previous = lap['rows'][-1] if lap['rows'] else None
        row = dict(row)
        step = math.hypot(row['x']-previous['x'], row['z']-previous['z']) if previous else 0
        # Gaps and teleports break the polyline and do not add fictitious distance.
        row['gap'] = bool(previous and (row.get('breakBefore') or row['t']-previous['t'] > 1 or step > 100))
        row['d'] = (previous['d'] if previous else 0) + (step if not row['gap'] else 0)
        lap['rows'].append(row)
    def is_complete(index):
        lap = laps[index]
        lrows = lap['rows']
        if len(lrows) < 2 or any(r['gap'] for r in lrows):
            return False
        if 0 < index < len(laps)-1:
            return True
        lt0 = lrows[0].get('lapTime')
        max_lt = max((r.get('lapTime') or 0 for r in lrows if isinstance(r.get('lapTime'), (int, float)) and math.isfinite(r.get('lapTime'))), default=0)
        if not isinstance(lt0, (int, float)) or not math.isfinite(lt0) or max_lt <= 0:
            return False
        if index == 0 and len(laps) > 1:
            return 0 <= lt0 <= 1.0 and laps[1]['number'] != lap['number']
        if index == len(laps)-1:
            if not (0 <= lt0 <= 1.0):
                return False
            line_row = lrows[0] if index > 0 else next((r for r in lrows if isinstance(r.get('lapTime'), (int, float)) and r['lapTime'] > 0), lrows[0])
            close_dist = math.hypot(lrows[-1]['x']-line_row['x'], lrows[-1]['z']-line_row['z'])
            lap_d = lrows[-1]['d']
            prev_ds = [laps[j]['rows'][-1]['d'] for j in range(len(laps)-1) if len(laps[j]['rows']) > 1 and laps[j]['rows'][-1]['d'] > 100]
            ref_d = prev_ds[-1] if prev_ds else 0
            if ref_d > 0:
                return close_dist <= 60 and lap_d >= ref_d*.85
            return lap_d >= 200 and max_lt >= 10 and close_dist <= 60
        return False
    for i, lap in enumerate(laps):
        lap['id'] = i
        lap['partial'] = not is_complete(i)
    return laps
