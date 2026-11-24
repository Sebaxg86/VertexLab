namespace VertexLab.Core;

/// <summary>Latest-target seeking. Pointer motion updates the cursor immediately, never queues decoder work.</summary>
public sealed class ScrubController
{
    public bool Active { get; private set; }
    public bool PointerHeld { get; private set; }
    double? pending;
    double due, lastApplied, nextPreview;
    const double PreviewInterval = .08;
    bool resume;
    public void Begin(bool wasPlaying, double now)
    {
        if (!Active) { resume = wasPlaying; lastApplied = now; nextPreview = now; Active = true; }
        PointerHeld = true;
    }
    public void Request(double target, bool wasPlaying, double now)
    {
        if (!double.IsFinite(target)) throw new ArgumentOutOfRangeException(nameof(target));
        if (!Active) { resume = wasPlaying; lastApplied = now; nextPreview = now; Active = true; }
        // While dragging, throttle instead of debounce: moving the pointer must not postpone previews forever.
        if (!PointerHeld || pending is null)
            due = PointerHeld ? Math.Max(now, nextPreview) : now + .12;
        pending = target;
    }
    public void End(double now)
    {
        if (!Active) return;
        PointerHeld = false;
        due = now;
    }
    public double? TakeSeek(double now)
    {
        if (!Active || pending is null || now < due) return null;
        var target = pending; pending = null; lastApplied = now; nextPreview = now + PreviewInterval;
        return target;
    }
    public bool TryFinish(double now, out bool resumePlayback)
    {
        resumePlayback = false;
        if (!Active || PointerHeld || pending is not null || now - lastApplied < .18) return false;
        resumePlayback = resume;
        Cancel();
        return true;
    }
    public void Cancel() { Active = false; PointerHeld = false; pending = null; resume = false; }
}
