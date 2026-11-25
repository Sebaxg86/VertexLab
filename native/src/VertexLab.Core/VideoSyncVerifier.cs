namespace VertexLab.Core;

public sealed record VideoClockObservation(double VideoTime, double RaceTime);
public sealed record VideoSyncVerification(string State, string Method, double CorrectionSeconds, double ResidualSeconds, IReadOnlyList<VideoClockObservation> Observations, string Message);

/// <summary>Fits against clocks actually visible in recorded frames, never HUD speed guesses.</summary>
public static class VideoSyncVerifier
{
    public static VideoSyncVerification Evaluate(SessionMeta meta, SyncSegment segment, IReadOnlyList<TelemetryPacket> rows, IReadOnlyList<VideoClockObservation> observations, double frameInterval)
    {
        var offsets = new List<double>();
        foreach (var observation in observations)
        {
            double predicted = segment.TStart + observation.VideoTime - meta.Offset - segment.VideoStart;
            double? matched = null; int matches = 0;
            for (int i = 1; i < rows.Count; i++)
            {
                var a = rows[i - 1]; var b = rows[i];
                if (a.T < segment.TStart || b.T > segment.TEnd || Math.Abs(a.T - predicted) > 2 || b.BreakBefore || b.T - a.T > .1 || b.RaceTime <= a.RaceTime || b.Timestamp < a.Timestamp) continue;
                if (observation.RaceTime < a.RaceTime || observation.RaceTime >= b.RaceTime) continue;
                matched = a.T + (b.T - a.T) * (observation.RaceTime - a.RaceTime) / (b.RaceTime - a.RaceTime); matches++;
            }
            if (matches == 1 && matched is { } t) offsets.Add(observation.VideoTime - (segment.VideoStart + t - segment.TStart + meta.Offset));
        }
        VideoSyncVerification Failed(string state, string text) => new(state, "recorded-race-clock", 0, 0, observations, text);
        if (offsets.Count < 5 || observations.Count == 0 || observations.Max(x => x.VideoTime) - observations.Min(x => x.VideoTime) < 2)
            return Failed("unavailable", "No hay suficientes lecturas inequívocas del cronómetro grabado; sincronización estimada.");
        offsets.Sort(); double median = offsets[offsets.Count / 2], tolerance = Math.Max(.012, frameInterval * 1.5);
        var inliers = offsets.Where(x => Math.Abs(x - median) <= tolerance).Order().ToArray();
        if (inliers.Length < 5 || inliers.Length < offsets.Count * .8) return Failed("inconsistent", "Las lecturas del video no coinciden; no se aplicó ninguna corrección.");
        median = inliers[inliers.Length / 2]; double residual = inliers.Max(x => Math.Abs(x - median));
        if (Math.Abs(median) > 1 || residual > Math.Max(.012, frameInterval)) return Failed("inconsistent", "El desfase no es estable dentro de un fotograma; requiere revisión.");
        return new("verified", "recorded-race-clock", median, residual, observations, $"Cronómetro verificado en {inliers.Length} imágenes; dispersión máxima {residual * 1000:0.0} ms. La precisión está limitada por los fotogramas y el envío UDP.");
    }
}
