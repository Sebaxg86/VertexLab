namespace VertexLab.Core;

public static class LapComparison
{
    // Each lap retains its own timestamp and video mapping; only distance is shared.
    public static double? MapTime(SessionAnalysis session, double time, int sourceLap, int targetLap)
    {
        var source = session.Laps.FirstOrDefault(l => l.Id == sourceLap); var target = session.Laps.FirstOrDefault(l => l.Id == targetLap);
        if (source is null || target is null) return null;
        time = Math.Clamp(time, source.Start, source.End);
        // Never round-trip the master clock through distance: a stopped car has many
        // timestamps at the same distance. Only comparison clocks interpolate.
        if (sourceLap == targetLap) return time;
        var rows = session.LapPoints(sourceLap);
        int lo = 0, hi = rows.Count;
        while (lo < hi) { int m = (lo + hi) / 2; if (rows[m].Packet.T <= time) lo = m + 1; else hi = m; }
        if (rows.Count == 0) return null;
        var a = rows[Math.Max(0, lo - 1)]; var b = rows[Math.Min(lo, rows.Count - 1)];
        if (time > a.Packet.T && b.Gap) return null;
        double d = a.Distance + (b.Distance - a.Distance) * (b.Packet.T > a.Packet.T ? (time - a.Packet.T) / (b.Packet.T - a.Packet.T) : 0);
        rows = session.LapPoints(targetLap); lo = 0; hi = rows.Count;
        if (rows.Count == 0 || d < rows[0].Distance || d > rows[^1].Distance) return null;
        while (lo < hi) { int m = (lo + hi) / 2; if (rows[m].Distance < d) lo = m + 1; else hi = m; }
        b = rows[Math.Min(lo, rows.Count - 1)]; a = rows[Math.Max(0, lo - 1)];
        if (b.Distance == d) return b.Packet.T;
        if (b.Gap) return null;
        return a.Packet.T + (b.Packet.T - a.Packet.T) * (d - a.Distance) / (b.Distance - a.Distance);
    }
}
