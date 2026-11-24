namespace VertexLab.Core;

public static class LapComparison
{
    // Each lap retains its own timestamp and video mapping; only distance is shared.
    public static double? MapTime(SessionAnalysis session, double time, int sourceLap, int targetLap)
    {
        var source = session.Laps.FirstOrDefault(l => l.Id == sourceLap); var target = session.Laps.FirstOrDefault(l => l.Id == targetLap);
        if (source is null || target is null) return null;
        var point = session.At(Math.Clamp(time, source.Start, source.End));
        return point is null ? null : session.AtDistance(targetLap, point.Distance)?.Packet.T;
    }
}
