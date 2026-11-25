using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Forms.Integration;
using System.Windows.Media;
using VertexLab.Playback;

namespace VertexLab.Desktop;

public sealed class VideoErrorEventArgs(Exception exception) : EventArgs
{
    public Exception ErrorException { get; } = exception;
}

/// <summary>Windows media clock for the audible video; a timestamp-driven GPU
/// frame queue for the silent comparison. No polling worker estimates time.</summary>
public sealed class NativeVideoSurface : UserControl, IDisposable
{
    readonly WindowsFormsHost host = new();
    readonly Popup overlay = new() { AllowsTransparency = true, StaysOpen = true, Placement = PlacementMode.Relative, Focusable = false };
    MediaEnginePane? player; ScheduledVideoPane? scheduled;
    Window? owner; Uri? source; double? pendingSeek; double target, rate = 1, volume = 1;
    bool muted, suppressed, opened, failed, disposed, ended, desiredPlaying, appliedPlaying;
    public event RoutedEventHandler? MediaOpened, MediaEnded;
    public event EventHandler<VideoErrorEventArgs>? MediaFailed;
    public bool FrameScheduled { get; set; }
    public static readonly DependencyProperty OverlayProperty = DependencyProperty.Register(nameof(Overlay), typeof(object), typeof(NativeVideoSurface), new PropertyMetadata(null, (d, e) => ((NativeVideoSurface)d).overlay.Child = e.NewValue as UIElement));
    public object Overlay { get => GetValue(OverlayProperty); set => SetValue(OverlayProperty, value); }
    public NativeVideoSurface()
    {
        Background = Brushes.Black; HorizontalContentAlignment = HorizontalAlignment.Stretch; VerticalContentAlignment = VerticalAlignment.Stretch;
        var grid = new Grid(); grid.Children.Add(host); grid.Children.Add(overlay); Content = grid; overlay.PlacementTarget = this;
        Loaded += (_, _) =>
        {
            CompositionTarget.Rendering -= Render; CompositionTarget.Rendering += Render;
            owner = Window.GetWindow(this);
            if (owner is not null) { owner.LocationChanged += Reposition; owner.SizeChanged += Reposition; owner.Deactivated += Reposition; owner.Activated += Reposition; owner.StateChanged += Reposition; }
            if (source is not null && player is null && scheduled is null) Open();
        };
        Unloaded += (_, _) => { CompositionTarget.Rendering -= Render; overlay.IsOpen = false; DetachOwner(); };
        SizeChanged += Reposition;
    }
    void DetachOwner()
    {
        if (owner is null) return;
        owner.LocationChanged -= Reposition; owner.SizeChanged -= Reposition; owner.Deactivated -= Reposition; owner.Activated -= Reposition; owner.StateChanged -= Reposition; owner = null;
    }
    void Reposition(object? sender, EventArgs e)
    {
        if (overlay.Child is FrameworkElement child) { child.Width = Math.Max(0, ActualWidth); child.Height = Math.Max(0, ActualHeight); }
        if (overlay.IsOpen) { overlay.HorizontalOffset = .01; overlay.HorizontalOffset = 0; }
        RefreshOverlay();
    }
    void RefreshOverlay() => overlay.IsOpen = !disposed && !suppressed && IsVisible && owner?.IsActive == true && Overlay is not null && ActualWidth > 0;
    public Uri? Source
    {
        get => source;
        set { if (source == value) return; Release(); source = value; pendingSeek = null; target = 0; desiredPlaying = appliedPlaying = opened = failed = ended = false; if (IsLoaded && value is not null) Open(); }
    }
    void Open()
    {
        try
        {
            if (FrameScheduled) { scheduled = new ScheduledVideoPane(); host.Child = scheduled; scheduled.Open(source!.LocalPath); }
            else { player = new MediaEnginePane(); host.Child = player; player.Open(source!.LocalPath, muted); player.Engine.Volume = volume; }
        }
        catch (Exception ex) { Fail(ex); }
    }
    public TimeSpan Position
    {
        get => TimeSpan.FromSeconds(Math.Max(0, player?.Ready == true ? player.Engine.CurrentTime : scheduled?.PresentedTime ?? target));
        set { target = Math.Max(0, value.TotalSeconds); pendingSeek = target; ended = false; }
    }
    public bool IsSeeking => source is not null && !failed && (!opened || pendingSeek is not null || player?.Seeking == true || (player?.Ready == true && player.Engine.IsSeeking) || scheduled?.Seeking == true);
    public double SpeedRatio { get => rate; set { rate = Math.Clamp(value, .25, 4); if (player?.Ready == true) player.SetRate(rate); } }
    public double Volume { get => volume; set { volume = Math.Clamp(value, 0, 1); if (player is not null) player.Engine.Volume = volume; } }
    public bool IsMuted { get => muted; set { muted = value; if (player is not null) player.Engine.Muted = value; } }
    public int NaturalVideoWidth => player?.Ready == true ? player.Engine.NativeVideoSize.Width : scheduled?.VideoWidth ?? 0;
    public int NaturalVideoHeight => player?.Ready == true ? player.Engine.NativeVideoSize.Height : scheduled?.VideoHeight ?? 0;
    public bool Suppressed { get => suppressed; set { suppressed = value; host.Visibility = value ? Visibility.Hidden : Visibility.Visible; RefreshOverlay(); } }
    public void Play() => desiredPlaying = true;
    public void Pause() { desiredPlaying = appliedPlaying = false; if (player?.Ready == true) player.Engine.Pause(); }
    public void Follow(double seconds)
    {
        target = seconds;
        if (scheduled?.Ready != true) return;
        if (failed) return;
        try
        {
            scheduled.PresentAt(seconds);
            if (!scheduled.Seeking && scheduled.PresentedTime is { } pts) PresentationMetrics.Record("comparison-frame-error-ms", Math.Abs(pts - seconds) * 1000);
        }
        catch (Exception ex) { Fail(ex); }
    }
    void Render(object? sender, EventArgs e)
    {
        if (disposed) return;
        RefreshOverlay(); if (source is null || failed) return;
        try
        {
            if ((player?.Failure ?? scheduled?.Failure) is { } error) { Fail(new InvalidOperationException(error)); return; }
            bool ready = player?.Ready == true || scheduled?.Ready == true;
            if (!ready) return;
            if (!opened) { opened = true; player?.SetRate(rate); MediaOpened?.Invoke(this, new RoutedEventArgs()); }
            if (pendingSeek is { } seek)
            {
                pendingSeek = null;
                if (scheduled is not null) scheduled.Request(seek, true); else player!.Seek(seek);
            }
            if (scheduled is not null) scheduled.PresentAt(target);
            else if (desiredPlaying != appliedPlaying && !player!.Seeking && !player.Engine.IsSeeking)
            {
                if (desiredPlaying) player.Engine.Play(); else player.Engine.Pause(); appliedPlaying = desiredPlaying;
            }
            if (player?.Ready == true && player.Engine.IsEnded && !ended) { ended = true; desiredPlaying = appliedPlaying = false; MediaEnded?.Invoke(this, new RoutedEventArgs()); }
        }
        catch (Exception ex) { Fail(ex); }
    }
    void Fail(Exception exception) { if (failed || disposed) return; failed = true; desiredPlaying = false; MediaFailed?.Invoke(this, new(exception)); }
    public void Close() => Source = null;
    public Task ReleaseAsync() { Close(); return Task.CompletedTask; }
    void Release()
    {
        if (scheduled is not null) PresentationMetrics.Info(Name + "-frames", $"submitted={scheduled.Presented}; decoded={scheduled.Decoded}; seeks={scheduled.Seeks}; late={scheduled.Late}; GPU={scheduled.VideoWidth}x{scheduled.VideoHeight}");
        host.Child = null; player?.Dispose(); scheduled?.Dispose(); player = null; scheduled = null;
    }
    public void Dispose()
    {
        if (disposed) return; disposed = true; CompositionTarget.Rendering -= Render; DetachOwner(); overlay.IsOpen = false; Release(); host.Dispose();
    }
}
