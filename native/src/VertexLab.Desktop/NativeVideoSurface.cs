using System.Diagnostics;
using MediaPlayer = LibVLCSharp.Shared.MediaPlayer;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using LibVLCSharp.Shared;
using LibVLCSharp.WPF;
using VertexLab.Core;

namespace VertexLab.Desktop;

public sealed class VideoErrorEventArgs(Exception exception) : EventArgs
{
    public Exception ErrorException { get; } = exception;
}

/// <summary>Native GPU video output. The dispatcher only publishes desired state;
/// a serial worker owns decoder calls and coalesces pending seeks.</summary>
public sealed class NativeVideoSurface : UserControl, IDisposable
{
    static readonly Lazy<LibVLC> Engine = new(() => { LibVLCSharp.Shared.Core.Initialize(); return new LibVLC("--no-video-title-show", "--no-osd"); });
    readonly VideoView view = new(); readonly object gate = new();
    readonly CancellationTokenSource stop = new();
    Uri? source; int revision, releasedRevision = -1; bool desiredPlaying, muted, disposed, suppressed;
    double volume = 1, rate = 1, position, positionClock; bool advancing, seeking;
    double? pendingSeek; long seekSerial; int width, height;
    Task? worker;
    static double Now => Stopwatch.GetTimestamp() / (double)Stopwatch.Frequency;
    public event RoutedEventHandler? MediaOpened, MediaEnded;
    public event EventHandler<VideoErrorEventArgs>? MediaFailed;
    public static readonly DependencyProperty OverlayProperty = DependencyProperty.Register(nameof(Overlay), typeof(object), typeof(NativeVideoSurface), new PropertyMetadata(null, (d, e) => ((NativeVideoSurface)d).view.Content = e.NewValue));
    public object Overlay { get => GetValue(OverlayProperty); set => SetValue(OverlayProperty, value); }
    public NativeVideoSurface()
    {
        Background = Brushes.Black; Content = view;
        Loaded += (_, _) => { worker ??= Run(); };
    }
    public Uri? Source { get { lock (gate) return source; } set { lock (gate) { if (source == value) return; source = value; revision++; desiredPlaying = false; position = 0; advancing = false; seeking = value is not null; pendingSeek = null; } } }
    public TimeSpan Position
    {
        get { lock (gate) return TimeSpan.FromSeconds(Math.Max(0, position + (advancing && !seeking ? Math.Min(.3, Now - positionClock) * rate : 0))); }
        set { lock (gate) { pendingSeek = Math.Max(0, value.TotalSeconds); seekSerial++; position = pendingSeek.Value; positionClock = Now; seeking = true; } }
    }
    public bool IsSeeking { get { lock (gate) return seeking; } }
    public double SpeedRatio { get { lock (gate) return rate; } set { lock (gate) rate = Math.Clamp(value, .25, 4); } }
    public double Volume { get { lock (gate) return volume; } set { lock (gate) volume = Math.Clamp(value, 0, 1); } }
    public bool IsMuted { get { lock (gate) return muted; } set { lock (gate) muted = value; } }
    public int NaturalVideoWidth => width;
    public int NaturalVideoHeight => height;
    public bool Suppressed { get => suppressed; set { suppressed = value; view.Visibility = value ? Visibility.Hidden : Visibility.Visible; } }
    public void Play() { lock (gate) desiredPlaying = true; }
    public void Pause() { lock (gate) { position = Position.TotalSeconds; positionClock = Now; desiredPlaying = false; advancing = false; } }
    public void Close() => Source = null;
    public async Task ReleaseAsync()
    {
        Close(); int expected = revision;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        while (Volatile.Read(ref releasedRevision) < expected && worker is { IsCompleted: false }) await Task.Delay(16, timeout.Token);
    }
    void Dispatch(int version, Action action) => Dispatcher.BeginInvoke(() => { if (!disposed && revision == version) action(); });

    async Task Run()
    {
        MediaPlayer? player = null; Media? media = null;
        try
        {
            player = await Task.Run(() => new MediaPlayer(Engine.Value) { EnableHardwareDecoding = true });
            if (disposed) { player.Dispose(); return; }
            view.MediaPlayer = player;
            var decoder = player;
            await Task.Run(async () =>
            {
                int current = -1; bool ready = false, announced = false; bool? appliedPlaying = null;
                long appliedSeek = -1, issuedSeek = -1; double seekTarget = 0, seekStarted = 0, lastNative = -1, clockBase = Now, lastStats = 0;
                int seekCount = 0;
                double appliedRate = -1, appliedVolume = -1; bool? appliedMuted = null;
                // Callbacks never call LibVLC (which may hold its own decoder lock).
                decoder.Playing += (_, _) => Volatile.Write(ref ready, true);
                decoder.EndReached += (_, _) => { int v = current; lock (gate) advancing = false; Dispatch(v, () => MediaEnded?.Invoke(this, new RoutedEventArgs())); };
                decoder.EncounteredError += (_, _) => { int v = current; Dispatch(v, () => MediaFailed?.Invoke(this, new(new InvalidOperationException("El motor de video no pudo decodificar este archivo.")))); };
                while (!stop.IsCancellationRequested)
                {
                    Uri? file; int version; bool play, mute; double speed, level; double? seek; long serial;
                    lock (gate) { file = source; version = revision; play = desiredPlaying; mute = muted; speed = rate; level = volume; seek = pendingSeek; serial = seekSerial; }
                    if (current != version)
                    {
                        decoder.Stop(); media?.Dispose(); media = null; current = version; Volatile.Write(ref releasedRevision, version); Volatile.Write(ref ready, false); announced = false; appliedPlaying = null; appliedSeek = issuedSeek = -1; lastNative = -1; width = height = 0; seekCount = 0;
                        if (file is not null) { media = new Media(Engine.Value, file); decoder.Media = media; decoder.Mute = true; appliedMuted = true; decoder.Play(); }
                    }
                    if (file is not null && Volatile.Read(ref ready))
                    {
                        // Playing is raised before the renderer has a frame. Wait for
                        // decoded output before pausing the newly opened video.
                        if (!announced && decoder.Time <= 0 && media!.Statistics.DisplayedPictures == 0) { await Task.Delay(16, stop.Token); continue; }
                        if (appliedVolume != level) { decoder.Volume = (int)(level * 100); appliedVolume = level; }
                        if (appliedMuted != mute) { decoder.Mute = mute; appliedMuted = mute; }
                        if (Math.Abs(appliedRate - speed) > .015) { decoder.SetRate((float)speed); appliedRate = speed; }
                        if (appliedPlaying != play) { decoder.SetPause(!play); appliedPlaying = play; lastNative = -1; }
                        if (seek is { } target && serial != appliedSeek)
                        {
                            // One latest request replaces all intermediate pointer positions.
                            decoder.Time = (long)(target * 1000); seekTarget = target; seekStarted = Now; issuedSeek = serial; appliedSeek = serial; lastNative = -1;
                            seekCount++;
                            lock (gate) { if (seekSerial == serial) pendingSeek = null; }
                        }
                        double actual = Math.Max(0, decoder.Time / 1000d), now = Now;
                        lock (gate)
                        {
                            if (revision == version && pendingSeek is null)
                            {
                                if (seeking && (issuedSeek < 0 || Math.Abs(actual - seekTarget) < .12)) seeking = false;
                                // LibVLC reports coarse timestamps. Advance the displayed clock
                                // between reports without ever seeking the audible master.
                                if (!seeking && actual != lastNative) { position = actual; positionClock = clockBase = now; lastNative = actual; }
                                bool moving = play && !seeking && now - clockBase < .4;
                                if (advancing && !moving && !seeking) { position += Math.Min(.3, now - positionClock) * speed; positionClock = now; }
                                advancing = moving;
                            }
                        }
                        if (width == 0 || height == 0) { uint w = 0, h = 0; if (decoder.Size(0, ref w, ref h) && w > 0) { width = (int)w; height = (int)h; } }
                        if (!announced) { announced = true; int v = version; Dispatch(v, () => MediaOpened?.Invoke(this, new RoutedEventArgs())); }
                        if (now - lastStats > 1)
                        {
                            lastStats = now; var stats = media!.Statistics; int v = version, count = seekCount; string size = $"{width}x{height}";
                            Dispatch(v, () => { PresentationMetrics.Info(Name + "-frames", $"displayed={stats.DisplayedPictures}; lost={stats.LostPictures}; seeks={count}; decoded={size}"); });
                        }
                        if (seeking && issuedSeek >= 0 && now - seekStarted > 5) { int v = version; issuedSeek = -1; Dispatch(v, () => MediaFailed?.Invoke(this, new(new TimeoutException("El video tardó demasiado en buscar el fotograma.")))); }
                    }
                    await Task.Delay(16, stop.Token);
                }
            });
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { if (!disposed) MediaFailed?.Invoke(this, new(ex)); }
        finally { if (player is not null) await Task.Run(() => { player.Stop(); media?.Dispose(); player.Dispose(); }); }
    }
    public void Dispose()
    {
        if (disposed) return; disposed = true; stop.Cancel(); view.MediaPlayer = null; view.Dispose();
    }
}
