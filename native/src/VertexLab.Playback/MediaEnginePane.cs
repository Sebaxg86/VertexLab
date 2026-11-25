using System.Diagnostics;
using Color = System.Drawing.Color;
using Vortice.MediaFoundation;
using Vortice.Mathematics;
using static Vortice.MediaFoundation.MediaFactory;
namespace VertexLab.Playback;
// Native Windows playback with a single authoritative media clock.
public sealed class MediaEnginePane : Panel
{
    readonly Panel canvas = new() { BackColor = Color.Black };
    public IMFMediaEngine Engine { get; private set; } = null!;
    IMFMediaEngineEx extended = null!;
    public bool Ready { get; private set; }
    public bool Seeking { get; private set; }
    public int Seeks { get; private set; }
    public int RateChanges { get; private set; }
    public List<double> SeekMilliseconds { get; } = [];
    public Dictionary<string, int> EventCounts { get; } = [];
    public string? Failure { get; private set; }
    double? pending; double seekStarted, lastRateChange = double.NegativeInfinity;
    public event Action? Changed;
    public static double Now => Stopwatch.GetTimestamp() / (double)Stopwatch.Frequency;
    public MediaEnginePane() { BackColor = Color.Black; Dock = DockStyle.Fill; Controls.Add(canvas); Resize += (_, _) => Fit(); }
    public void Open(string path, bool muted)
    {
        _ = Handle; // Create the parent before callbacks can be posted to its UI thread.
        using var factory = new IMFMediaEngineClassFactory();
        using var attributes = MFCreateAttributes(2);
        attributes.Set(MediaEngineAttributeGuids.PlaybackHwndGuid, (ulong)canvas.Handle);
        Engine = factory.CreateInstance(MediaEngineCreateFlags.None, attributes, Notify);
        extended = Engine.QueryInterface<IMFMediaEngineEx>();
        Engine.Muted = muted;
        Engine.SetSource(new Uri(Path.GetFullPath(path)).AbsoluteUri).CheckError();
        Engine.Load();
    }
    void Notify(MediaEngineEvent kind, nuint first, int second)
    {
        if (IsDisposed || !IsHandleCreated) return;
        try { BeginInvoke(() =>
        {
            if (IsDisposed) return;
            EventCounts[kind.ToString()] = EventCounts.GetValueOrDefault(kind.ToString()) + 1;
            if (kind == MediaEngineEvent.CanPlay) { Ready = true; Fit(); }
            if (kind == MediaEngineEvent.Seeked)
            {
                Seeking = false; SeekMilliseconds.Add((Now - seekStarted) * 1000);
                if (pending is { } next) { pending = null; Seek(next); }
            }
            if (kind == MediaEngineEvent.Error) Failure = $"Media Engine error: {first}, HRESULT 0x{second:X8}";
            Changed?.Invoke();
        }); } catch (InvalidOperationException) { }
    }
    public void Seek(double target)
    {
        if (!Ready) return;
        if (Seeking) { pending = target; return; }
        Seeking = true; seekStarted = Now; Seeks++;
        extended.SetCurrentTimeEx(Math.Clamp(target, 0, Engine.Duration), MediaEngineSeekMode.Normal);
    }
    public void SetRate(double value)
    {
        value = Math.Clamp(value, .25, 4);
        value = Math.Round(value / .025) * .025;
        if (Math.Abs(Engine.PlaybackRate - value) < .025 || Now - lastRateChange < .3) return;
        Engine.PlaybackRate = value; lastRateChange = Now; RateChanges++;
    }
    public long Stat(MediaEngineStatistic statistic)
    {
        var value = extended.GetStatistics(statistic);
        return Convert.ToInt64(value.Value);
    }
    void Fit()
    {
        if (extended is null || !Ready || Width == 0 || Height == 0) return;
        var size = Engine.NativeVideoSize;
        double scale = Math.Min(Width / (double)Math.Max(1, size.Width), Height / (double)Math.Max(1, size.Height));
        int w = (int)(size.Width * scale), h = (int)(size.Height * scale);
        canvas.SetBounds((Width - w) / 2, (Height - h) / 2, Math.Max(1, w), Math.Max(1, h));
        extended.UpdateVideoStream(null, new Vortice.RawRect(0, 0, w, h), new ColorBgra(0, 0, 0, 255));
    }
    protected override void Dispose(bool disposing)
    {
        if (disposing && Engine is not null) { Engine.Shutdown(); extended.Dispose(); Engine.Dispose(); }
        base.Dispose(disposing);
    }
}
