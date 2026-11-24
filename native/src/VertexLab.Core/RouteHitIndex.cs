namespace VertexLab.Core;

/// <summary>Indexes actual route segments; queries touch only cells around the pointer, including points between samples.</summary>
public sealed class RouteHitIndex
{
    readonly record struct Segment(AnalysisPoint A, AnalysisPoint B);
    readonly List<Segment> segments = [];
    readonly Dictionary<(int X, int Z), List<int>> cells = [];
    readonly double cellSize, xmin, zmin;
    readonly int[] visited;
    int stamp;
    public int LastCandidateCount { get; private set; }
    public RouteHitIndex(IReadOnlyList<AnalysisPoint> rows)
    {
        if (rows.Count == 0) { cellSize = 1; visited = []; return; }
        xmin = rows.Min(p => p.Packet.X); zmin = rows.Min(p => p.Packet.Z);
        cellSize = Math.Max(1, Math.Max(rows.Max(p => p.Packet.X) - xmin, rows.Max(p => p.Packet.Z) - zmin) / 64);
        AnalysisPoint? previous = null;
        foreach (var point in rows)
        {
            bool continuous = previous is not null && previous.LapId == point.LapId && !point.Gap && !point.Packet.BreakBefore && point.Packet.T - previous.Packet.T <= 1;
            var a = continuous ? previous! : point; int id = segments.Count; segments.Add(new(a, point));
            int ax = CellX(Math.Min(a.Packet.X, point.Packet.X)), bx = CellX(Math.Max(a.Packet.X, point.Packet.X)), az = CellZ(Math.Min(a.Packet.Z, point.Packet.Z)), bz = CellZ(Math.Max(a.Packet.Z, point.Packet.Z));
            for (int x = ax; x <= bx; x++) for (int z = az; z <= bz; z++) { if (!cells.TryGetValue((x, z), out var bucket)) cells[(x, z)] = bucket = []; bucket.Add(id); }
            previous = point;
        }
        visited = new int[segments.Count];
    }
    int CellX(double x) => (int)Math.Floor((x - xmin) / cellSize);
    int CellZ(double z) => (int)Math.Floor((z - zmin) / cellSize);
    public AnalysisPoint? Find(double x, double z, double radius)
    {
        LastCandidateCount = 0; if (!double.IsFinite(x) || !double.IsFinite(z) || !double.IsFinite(radius) || radius < 0 || segments.Count == 0) return null;
        if (stamp == int.MaxValue) { Array.Clear(visited); stamp = 0; }
        stamp++;
        double best = radius * radius; AnalysisPoint? result = null;
        for (int cx = CellX(x - radius); cx <= CellX(x + radius); cx++) for (int cz = CellZ(z - radius); cz <= CellZ(z + radius); cz++)
        {
            if (!cells.TryGetValue((cx, cz), out var bucket)) continue;
            foreach (int id in bucket)
            {
                if (visited[id] == stamp) continue; visited[id] = stamp; LastCandidateCount++; var s = segments[id];
                double dx = s.B.Packet.X - s.A.Packet.X, dz = s.B.Packet.Z - s.A.Packet.Z, length = dx * dx + dz * dz;
                double fraction = length > 0 ? Math.Clamp(((x - s.A.Packet.X) * dx + (z - s.A.Packet.Z) * dz) / length, 0, 1) : 0;
                double px = s.A.Packet.X + dx * fraction, pz = s.A.Packet.Z + dz * fraction, d = (x - px) * (x - px) + (z - pz) * (z - pz);
                if (d <= best) { best = d; result = fraction < .5 ? s.A : s.B; }
            }
        }
        return result;
    }
}
