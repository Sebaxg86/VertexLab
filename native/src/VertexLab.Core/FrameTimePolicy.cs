namespace VertexLab.Core;

/// <summary>Decode from keyframes without repeatedly seeking during preroll.
/// A new seek generation must bypass a full queue so old frames can be released.</summary>
public static class FrameTimePolicy
{
    public static bool QueueFull(int count, int requestedGeneration, int decoderGeneration) => count >= 6 && requestedGeneration == decoderGeneration;
    public static bool NeedsSeek(int requestedGeneration, int decoderGeneration, bool preroll, double target, double decodedTime) =>
        requestedGeneration != decoderGeneration || (!preroll && (!double.IsFinite(decodedTime) || target > decodedTime + .6));
    public static double FrameInterval(ulong rate)
    {
        uint numerator = (uint)(rate >> 32), denominator = (uint)rate;
        return numerator > 0 && denominator > 0 ? Math.Clamp(denominator / (double)numerator, 1d / 240, 1) : 1d / 60;
    }
}
