"""Cached, genuine route previews: second lap, first lap, or a free session."""
import json
import math


def second_lap_preview(path, manual=False):
    laps = [[], []]
    numbers = [None, None]
    whole = []
    group = -1
    previous = None
    has_event = False
    try:
        with path.open(encoding='utf-8') as source:
            for line in source:
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if previous is None or row['lap'] != previous['lap'] or row['timestamp'] < previous['timestamp']:
                    group += 1
                    if group > 1 and not manual:
                        break
                has_event = has_event or row.get('racePosition', 0) > 0 or row.get('lapTime', 0) > 0
                x, z = row['x'], row['z']
                if math.isfinite(x) and math.isfinite(z):
                    gap = previous is None or bool(row.get('breakBefore')) or row['t']-previous['t'] > 1 or math.hypot(x-previous['x'], z-previous['z']) > 100
                    if group < 2:
                        numbers[group] = row['lap'] + 1
                        laps[group].append((x, z, gap or not laps[group]))
                    if manual and not has_event:
                        whole.append((x, z, gap))
                    elif whole:
                        whole.clear()
                previous = row
    except FileNotFoundError:
        return None
    if manual and not has_event:
        return _draw(whole, source='session', lap=None, partial=False)
    # Prefer the second recorded lap; fall back if it has no usable movement.
    for index in [1, 0]:
        preview = _draw(laps[index], source='lap', lap=numbers[index], partial=group <= index, recordedLap=index+1)
        if preview:
            return preview
    return None


def _draw(points, **metadata):
    if len(points) < 2:
        return None
    xmin, xmax = min(p[0] for p in points), max(p[0] for p in points)
    zmin, zmax = min(p[1] for p in points), max(p[1] for p in points)
    if max(xmax-xmin, zmax-zmin) < .01:
        return None
    scale = min(80/(xmax-xmin or 1), 48/(zmax-zmin or 1))
    stride = max(1, math.ceil(len(points)/180))
    commands = []
    for i, (x, z, gap) in enumerate(points):
        if i % stride and not gap and i != len(points)-1:
            continue
        px, py = 48+(x-(xmin+xmax)/2)*scale, 32-(z-(zmin+zmax)/2)*scale
        commands.append(f'{"M" if gap else "L"}{px:.2f},{py:.2f}')
    return dict(path=' '.join(commands), **metadata)
