namespace VertexLab.Core;

public readonly record struct VideoCorrection(bool Seek, bool Pause, double Rate);

/// <summary>Follow the derivative of the distance-aligned video clock. Small drift
/// adjusts playback speed; only discontinuities require a decoder seek.</summary>
public sealed class ComparisonClock
{
    double? previousTarget; double previousWall, lastSeek = double.NegativeInfinity, rate = 1;
    public void Reset() { previousTarget = null; lastSeek = double.NegativeInfinity; rate = 1; }
    public VideoCorrection Update(double target, double actual, double wall, double fallbackRate, bool force, bool seeking)
    {
        double elapsed = wall - previousWall;
        double velocity = previousTarget is { } previous && elapsed > .025 && elapsed < .75 ? Math.Max(0, (target - previous) / elapsed) : fallbackRate;
        previousTarget = target; previousWall = wall;
        bool seek = force || (!seeking && wall - lastSeek > 1 && Math.Abs(target - actual) > .65);
        if (seek) lastSeek = wall;
        if (force) rate = fallbackRate;
        else rate += (Math.Clamp(velocity, 0, 4) - rate) * .3;
        return new(seek, velocity < .02, Math.Clamp(rate + Math.Clamp((target - actual) * .25, -.12, .12), .25, 4));
    }
}
