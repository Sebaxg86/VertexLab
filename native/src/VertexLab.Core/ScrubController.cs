namespace VertexLab.Core;

/// <summary>Latest-target seeking. Pointer motion updates the cursor immediately, never queues decoder work.</summary>
public sealed class ScrubController
{
    public bool Active { get; private set; }
    public bool PointerHeld { get; private set; }
    double? pending;
    double due, lastApplied;
    bool resume;
    public void Begin(bool wasPlaying, double now)
    {
        if (!Active) { resume = wasPlaying; lastApplied = now; Active = true; }
        PointerHeld = true;
    }
    public void Request(double target, bool wasPlaying, double now)
    {
        if (!double.IsFinite(target)) throw new ArgumentOutOfRangeException(nameof(target));
        if (!Active) { resume = wasPlaying; lastApplied = now; Active = true; }
        pending = target;
        due = now + .12;
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
        var target = pending; pending = null; lastApplied = now;
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
