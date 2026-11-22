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
        row['gap'] = bool(previous and (row['t']-previous['t'] > 1 or step > 100))
        row['d'] = (previous['d'] if previous else 0) + (step if not row['gap'] else 0)
        lap['rows'].append(row)
    for i, lap in enumerate(laps):
        lap['id'] = i
        lap['partial'] = i == 0 or i == len(laps)-1 or any(r['gap'] for r in lap['rows'])
    return laps
