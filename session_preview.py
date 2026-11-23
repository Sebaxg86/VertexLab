"""Small, cached picker previews from the second recorded lap only."""
import json
import math


def second_lap_preview(path):
    points = []
    group = -1
    previous = None
    lap_number = None
    closed = False
    try:
        with path.open(encoding='utf-8') as source:
            for line in source:
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue  # An active capture may have an unfinished last line.
                if previous is None or row['lap'] != previous['lap'] or row['timestamp'] < previous['timestamp']:
                    group += 1
                    if group > 1:
                        closed = True
                        break
                if group == 1:
                    lap_number = row['lap'] + 1
                    x, z = row['x'], row['z']
                    if math.isfinite(x) and math.isfinite(z):
                        gap = not points or bool(row.get('breakBefore')) or row['t']-previous['t'] > 1 or math.hypot(x-previous['x'], z-previous['z']) > 100
                        points.append((x, z, gap))
                previous = row
    except FileNotFoundError:
        return None
    if len(points) < 2:
        return None
    xmin, xmax = min(p[0] for p in points), max(p[0] for p in points)
    zmin, zmax = min(p[1] for p in points), max(p[1] for p in points)
    extent = max(xmax-xmin, zmax-zmin)
    if extent < .01:
        return None
    scale = min(80/(xmax-xmin or 1), 48/(zmax-zmin or 1))
    stride = max(1, math.ceil(len(points)/180))
    commands = []
    for i, (x, z, gap) in enumerate(points):
        if i % stride and not gap and i != len(points)-1:
            continue
        px, py = 48+(x-(xmin+xmax)/2)*scale, 32-(z-(zmin+zmax)/2)*scale
        commands.append(f'{"M" if gap else "L"}{px:.2f},{py:.2f}')
    return dict(path=' '.join(commands), lap=lap_number, partial=not closed)
