namespace VertexLab.Core;

/// <summary>One shared editor viewport. Pointer panning owns the window until a seek, zoom or play resumes follow.</summary>
public sealed class PlaybackViewport
{
    public double Extent { get; private set; } = 1;
    public double Start { get; private set; }
    public double Span { get; private set; } = 1;
    public double End => Start + Span;
    public bool Following { get; private set; } = true;
    public bool Interacting { get; private set; }
    public void Reset(double extent) { Extent = Math.Max(.001, extent); Start = 0; Span = Extent; Following = true; Interacting = false; }
    public void SetRange(double start, double end) { Span = Math.Clamp(end - start, Math.Min(.05, Extent), Extent); Start = Math.Clamp(start, 0, Math.Max(0, Extent - Span)); }
    public void Zoom(double factor, double cursor, double? fraction = null)
    {
        if (!double.IsFinite(factor) || factor <= 0) return;
        double anchor = Math.Clamp(cursor, 0, Extent), width = Math.Clamp(Span / factor, Math.Min(.05, Extent), Extent), part = fraction ?? .5;
        Span = width; Start = Math.Clamp(anchor - width * Math.Clamp(part, 0, 1), 0, Math.Max(0, Extent - width)); Following = true;
    }
    public void BeginPan() { Interacting = true; Following = false; }
    public void Pan(double start) { Following = false; Start = Math.Clamp(start, 0, Math.Max(0, Extent - Span)); }
    public void EndPan() { Interacting = false; }
    public bool Follow(double cursor)
    {
        if (Interacting || !Following || Span >= Extent) return false;
        double next = Math.Clamp(cursor - Span * .5, 0, Math.Max(0, Extent - Span)); if (Math.Abs(next - Start) < 1e-7) return false; Start = next; return true;
    }
    public void ResumeFollow() => Following = true;
}
