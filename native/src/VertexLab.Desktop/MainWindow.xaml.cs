using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Text.Json;
using Microsoft.Win32;
using VertexLab.Core;
namespace VertexLab.Desktop;

public partial class MainWindow : Window
{
    readonly AppPaths paths = new(); readonly Library library;
    readonly DispatcherTimer statusTimer = new(DispatcherPriority.Background) { Interval = TimeSpan.FromMilliseconds(150) }, frameTimer = new(DispatcherPriority.Render) { Interval = TimeSpan.FromSeconds(1d / 60) };
    readonly PlaybackViewport viewport = new(); double lastFrameClock;double? pendingTimelineSeek;
    readonly CancellationTokenSource lifetime = new(); readonly ScrubController scrub = new();
    bool videoReady, chartSeeking; bool liveConnected; bool polling, playing, internalTime, loading, videoFailed, selectionUpdating; SessionEntry? selected; SessionAnalysis? analysis; EngineStatus? engine;
    double time, playRate = 1; int generation, reference, firstVideo, secondVideo; DateTime lastRefresh = DateTime.MinValue; string librarySignature = ""; readonly HashSet<int> chosen = []; SeriesView? expanded;
    static double SeekClock => Stopwatch.GetTimestamp() / (double)Stopwatch.Frequency;
    SeriesView[] Plots => [SpeedPlot, RpmPlot, ThrottlePlot, BrakePlot, LapTimePlot, RaceTimePlot, DistancePlot];
    static readonly Dictionary<string, string> Cars = ReadCars();
    static Dictionary<string, string> ReadCars() { try { return JsonSerializer.Deserialize<Dictionary<string, string>>(System.IO.File.ReadAllText(System.IO.Path.Combine(AppContext.BaseDirectory, "cars.json"))) ?? []; } catch { return []; } }
    static readonly Dictionary<int, string> Logos = ReadLogos();
    (int, int?, int?, bool)? lastCar;
    static Dictionary<int, string> ReadLogos()
    {
        var result = new Dictionary<int, string>(); try { using var doc = JsonDocument.Parse(System.IO.File.ReadAllText(System.IO.Path.Combine(AppContext.BaseDirectory, "car-brands.json"))); foreach (var item in doc.RootElement.EnumerateObject()) { string slug = (item.Value.GetProperty("name").GetString() ?? "").ToLowerInvariant().Replace(" ", "-"); string path = System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", item.Value.GetProperty("logo").GetString() ?? ""); if (!System.IO.File.Exists(path)) path = System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "brand-" + slug + ".png"); if (int.TryParse(item.Name, out int id) && System.IO.File.Exists(path)) result[id] = path; } } catch { }
        return result;
    }
    static string? LogoPath(int ordinal) => Logos.GetValueOrDefault(ordinal);
    public record LibraryItem(SessionEntry Entry)
    {
        public SessionMeta Meta => Entry.Meta; public string Title => (Meta.Featured ? "★ " : "") + Meta.Name; public ImageSource? Logo => BrandImages.Load(LogoPath(Meta.CarOrdinal));
        public string Caption => DateTimeOffset.FromUnixTimeMilliseconds((long)(Meta.Created * 1000)).LocalDateTime.ToString("dd MMM yyyy · HH:mm") + " · " + (Entry.State == "Interrupted" ? "Recuperada" : ClockText(Meta.Duration));
    }
    record LapItem(int? Id, string Label) { public override string ToString() => Label; }
    public MainWindow()
    {
        InitializeComponent(); library = new(paths);
        foreach (var plot in Plots) { plot.Seek += target => { chartSeeking = true; try { Seek(target); } finally { chartSeeking = false; } }; plot.RangeChanged += (a, b) => { viewport.SetRange(a, b); viewport.ResumeFollow(); ApplyViewport(); }; plot.Expand += () => ExpandPlot(plot); }
        Route.Seek += Seek;
        ChartPan.InteractionChanged += active => { if (active) viewport.BeginPan(); else viewport.EndPan(); };
        ChartScroll.ScrollChanged += (_, _) => RefreshActivePlots();
        LapScroll.ScrollChanged += (_, _) => UpdateLapOverflow(); LapScroll.SizeChanged += (_, _) => UpdateLapOverflow();
        SizeChanged += (_, _) => UpdateSessionWidth();
        NextLapsButton.MouseEnter += (_, _) => AnimateNextArrow(3); NextLapsButton.MouseLeave += (_, _) => AnimateNextArrow(0);
        foreach (var control in Plots.Cast<UIElement>().Append(Timeline)) control.AddHandler(Mouse.PreviewMouseDownEvent, new MouseButtonEventHandler(ScrubDown), true);
        AddHandler(Mouse.PreviewMouseUpEvent, new MouseButtonEventHandler(ScrubUp), true); AddHandler(Mouse.LostMouseCaptureEvent, new MouseEventHandler(ScrubCaptureLost), true); Deactivated += (_, _) => FinishDrag(); PreviewKeyDown += (_, e) => { if (e.Key == Key.Escape) { LibraryPopup.IsOpen = false; OptionsPopup.IsOpen = false; } };
        SettingsButton.MouseEnter += (_, _) => RotateGear(OptionsPopup.IsOpen ? 90 : 60); SettingsButton.MouseLeave += (_, _) => RotateGear(OptionsPopup.IsOpen ? 90 : 0); OptionsPopup.Closed += (_, _) => { RotateGear(SettingsButton.IsMouseOver ? 60 : 0); SettingsButton.ClearValue(BackgroundProperty); SettingsButton.ClearValue(BorderBrushProperty); SettingsButton.ClearValue(ForegroundProperty); };
        LibraryPopup.Opened += (_, _) => { if (LibraryPopup.Child is UIElement child) UiMotion.Enter(child, -10, 200); };
        OptionsPopup.Opened += (_, _) => { RotateGear(90); SettingsButton.Background = new SolidColorBrush(Color.FromRgb(70, 25, 35)); SettingsButton.BorderBrush = new SolidColorBrush(Color.FromRgb(255, 70, 87)); SettingsButton.Foreground = new SolidColorBrush(Color.FromRgb(255, 141, 152)); if (OptionsPopup.Child is UIElement child) UiMotion.Enter(child, -10, 200); };
        statusTimer.Tick += async (_, _) => await Poll(); frameTimer.Tick += (_, _) => Frame();
    }
    async void WindowLoaded(object sender, RoutedEventArgs e)
    {
        RefreshLibrary(); lastFrameClock = SeekClock; frameTimer.Start(); statusTimer.Start();
        try { using var probe = new CancellationTokenSource(600); await CaptureClient.SendAsync(paths, new("status"), probe.Token); }
        catch { var exe = System.IO.Path.Combine(AppContext.BaseDirectory, "VertexLab.Capture.exe"); if (!System.IO.File.Exists(exe)) { Message.Text = "Falta el motor de captura."; return; } var info = new ProcessStartInfo(exe) { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden }; info.Environment["VERTEXLAB_DATA"] = paths.Root; Process.Start(info); }
        await Poll(); var file = Environment.GetCommandLineArgs().Skip(1).FirstOrDefault(); if (file is not null && System.IO.File.Exists(file)) await ImportPath(file);
    }
    void WindowClosed(object? sender, EventArgs e) { scrub.Cancel(); lifetime.Cancel(); statusTimer.Stop(); frameTimer.Stop(); Video.Dispose(); CompareVideo.Dispose(); PresentationMetrics.Save(); }
    async Task Poll()
    {
        if (polling) return; polling = true;
        try
        {
            var reply = await CaptureClient.SendAsync(paths, new("status"), lifetime.Token); if (!reply.Ok || reply.Status is null) return; engine = reply.Status;
            if (engine.Packet is not null && engine.PacketAge < 1.5) liveConnected = true; else if (engine.PacketAge >= 3) liveConnected = false; bool connected = liveConnected; EngineBadge.Text = connected ? "● LIVE" : "○ OFF LIVE";
            CaptureInfo.Text = $"Motor: {engine.Mode}\nUDP {engine.UdpPort} · {engine.Packets:N0} paquetes\n{engine.Rejected:N0} rechazados · {engine.Dropped:N0} perdidos\nOBS {(engine.ObsConnected ? "conectado" : "desconectado")}";
            if (engine.Error is not null) Message.Text = engine.Error;
            if (selected is null) { RenderInstruments(connected ? engine.Packet : null); if (connected && engine.Packet is { } live) UpdateCar(live.CarOrdinal, live.CarClass, live.CarPI); }
            if (DateTime.UtcNow - lastRefresh > TimeSpan.FromSeconds(3)) { RefreshLibrary(); lastRefresh = DateTime.UtcNow; }
        }
        catch (OperationCanceledException) { if (!lifetime.IsCancellationRequested) EngineBadge.Text = "MOTOR SIN RESPUESTA"; }
        catch (Exception ex) { EngineBadge.Text = "MOTOR DESCONECTADO"; Message.Text = ex.Message; }
        finally { polling = false; }
    }
    void RefreshLibrary()
    {
        var id = (SessionList.SelectedItem as LibraryItem)?.Meta.Id; var entries = library.List(); var signature = string.Join(";", entries.Select(s => $"{s.Meta.Id}:{s.Meta.Duration:R}:{s.Meta.Ended}:{s.Meta.Name}:{s.State}:{s.Meta.Featured}")); if (signature == librarySignature) return; librarySignature = signature;
        SessionList.ItemsSource = entries.Select(e => new LibraryItem(e)).ToList(); LibraryInfo.Text = $"{entries.Count} sesiones · este equipo"; if (id is not null) SessionList.SelectedItem = SessionList.Items.Cast<LibraryItem>().FirstOrDefault(x => x.Meta.Id == id);
    }
    async Task<bool> Command(Command command) { try { var reply = await CaptureClient.SendAsync(paths, command, lifetime.Token); Message.Text = reply.Ok ? "Orden confirmada. El motor continúa al cerrar la ventana." : reply.Error; await Poll(); return reply.Ok; } catch (Exception ex) { Message.Text = ex.Message; return false; } }
    async void RecordClicked(object sender, RoutedEventArgs e) => await Command(new("start", Name: SessionName.Text));
    async void StopClicked(object sender, RoutedEventArgs e) { await Command(new("stop")); RefreshLibrary(); }
    void LibraryClicked(object sender, RoutedEventArgs e) { OptionsPopup.IsOpen = false; LibraryPopup.IsOpen = !LibraryPopup.IsOpen; }
    void RotateGear(double degrees)
    {
        ((RotateTransform)GearIcon.RenderTransform).BeginAnimation(RotateTransform.AngleProperty, new System.Windows.Media.Animation.DoubleAnimation(degrees, TimeSpan.FromMilliseconds(UiMotion.Enabled ? 450 : 0)) { EasingFunction = new System.Windows.Media.Animation.CubicEase { EasingMode = System.Windows.Media.Animation.EasingMode.EaseOut } });
    }
    void OptionsClicked(object sender, RoutedEventArgs e)
    {
        AnalysisOptions.Visibility = selected is null ? Visibility.Collapsed : Visibility.Visible;
        CaptureSettingsHost.Visibility = selected is null ? Visibility.Visible : Visibility.Collapsed;
        if (selected is null) { var settings = new SettingsWindow(paths, engine); var content = (UIElement)settings.Content; settings.Content = null; CaptureSettingsHost.Child = new ScrollViewer { Content = content, MaxHeight = 620, VerticalScrollBarVisibility = ScrollBarVisibility.Auto }; OptionsBorder.Width = 430; }
        else OptionsBorder.Width = 350;
        LibraryPopup.IsOpen = false; OptionsPopup.HorizontalOffset = SettingsButton.ActualWidth - OptionsBorder.Width; OptionsPopup.IsOpen = !OptionsPopup.IsOpen;
    }
    void LiveClicked(object sender, RoutedEventArgs e)
    {
        pendingTimelineSeek=null;scrub.Cancel(); generation++; selected = null; analysis = null; playing = false; Video.Close(); Video.Source = null; CompareVideo.Close(); CompareVideo.Source = null; SessionTitle.Text = "LIVE"; ModeLabel.Text = "TELEMETRÍA EN DIRECTO"; SessionList.SelectedItem = null; LibraryPopup.IsOpen = false;
        AnalysisLayout.Visibility = LapNavigation.Visibility = Transport.Visibility = Visibility.Collapsed; LiveDashboard.Visibility = CaptureControls.Visibility = Visibility.Visible; foreach (var plot in Plots) plot.SetData(null); Route.SetData(null); Dashboard.Reset(); LiveDashboard.Reset(); UpdateSessionWidth(); UiMotion.Enter(LiveDashboard, 10, 220);
    }
    async void SessionSelected(object sender, SelectionChangedEventArgs e)
    {
        if (SessionList.SelectedItem is not LibraryItem item || item.Meta.Id == selected?.Meta.Id) return;
        if (item.Meta.Ended is null) { Message.Text = "Finaliza y guarda la captura para analizarla."; return; }
        LibraryPopup.IsOpen = false; ShowLoading(); ChartStack.Effect = new System.Windows.Media.Effects.BlurEffect { Radius = 9 };
        pendingTimelineSeek=null;scrub.Cancel(); int request = ++generation; videoReady = false; videoFailed = false; loading = true; playing = false; UpdatePlayIcon(); Video.Close(); Video.Source = null; CompareVideo.Close(); CompareVideo.Source = null; VideoHint.Visibility = Visibility.Visible; VideoHint.Text = "Cargando telemetría…";
        try
        {
            var loaded = await Task.Run(() => Analysis.Load(item.Entry.TelemetryPath), lifetime.Token); if (request != generation) return; selected = item.Entry; analysis = loaded; time = 0; reference = loaded.Laps.FirstOrDefault()?.Id ?? 0;
            SessionTitle.Text = item.Meta.Name; UpdateSessionWidth(); UpdateCar(item.Meta.CarOrdinal, item.Meta.CarClass, item.Meta.CarPI); ModeLabel.Text = "ANÁLISIS DE SESIÓN"; LiveDashboard.Visibility = CaptureControls.Visibility = Visibility.Collapsed; AnalysisLayout.Visibility = LapNavigation.Visibility = Transport.Visibility = Visibility.Visible; Dashboard.Reset(); LiveDashboard.Reset();
            chosen.Clear(); BuildLapNavigation(); BuildLapSummary(); ApplySelection(false);
            if (item.Meta.VideoPath is { } path && System.IO.File.Exists(path)) { var uri = new Uri(System.IO.Path.GetFullPath(path)); Video.Source = uri; Video.Volume = Volume.Value; Video.Play(); Video.Pause(); VideoHint.Text = "Preparando video…"; } else VideoHint.Text = "Esta sesión no tiene un video disponible.";
            Message.Text = item.Entry.State == "Interrupted" ? "Sesión recuperada tras una interrupción." : ""; UpdateCursor();
        }
        catch (Exception ex) { Message.Text = "No se pudo abrir la sesión: " + ex.Message; VideoHint.Text = Message.Text; }
        finally { if (request == generation) { loading = false; HideLoading(request); UiMotion.Enter(Dashboard, 6, 220); UiMotion.Enter(ChartStack, 6, 220); } }
    }
    void UpdateCar(int ordinal, int? carClass, int? pi)
    {
        var key = (ordinal, carClass, pi, selected is null); if (lastCar == key) return; lastCar = key; string name = Cars.GetValueOrDefault(ordinal.ToString()) ?? "Vehículo " + ordinal; SessionSelector.ToolTip = name;
        if (selected is null) SessionTitle.Text = "LIVE · " + name;
        ClassBadge.Text = carClass is { } c ? new[] { "D", "C", "B", "A", "S1", "S2", "X" }[Math.Clamp(c, 0, 6)] : "—"; PiBadge.Text = pi is { } p ? $"PI {p}" : "PI —"; YearBadge.Text = name.Length >= 4 && int.TryParse(name[..4], out _) ? name[..4] : "—";
        var logo = LogoPath(ordinal); BrandLogo.Source = BrandImages.Load(logo); UpdateSessionWidth();
    }
    void UpdatePlayIcon() { string kind = playing ? "pause" : "play"; if (PlayButton.Content is RaceIcon icon && icon.Kind == kind) return; PlayButton.Content = new RaceIcon { Kind = kind }; }
    void ShowLoading()
    {
        Video.Suppressed = CompareVideo.Suppressed = true; LoadingOverlay.BeginAnimation(OpacityProperty, null); LoadingOverlay.Opacity = 0; LoadingOverlay.Visibility = Visibility.Visible;
        UiMotion.Fade(LoadingOverlay, 1, 200); UiMotion.Enter(LoadingCard, 16, 240);
    }
    void HideLoading(int request)
    {
        UiMotion.Fade(LoadingOverlay, 0, 180, () => { if (request == generation) { LoadingOverlay.Visibility = Visibility.Collapsed; ChartStack.Effect = null; Video.Suppressed = CompareVideo.Suppressed = false; } });
    }
    void VideoOpened(object sender, RoutedEventArgs e) { videoReady = true; VideoHint.Visibility = Visibility.Collapsed; PresentationMetrics.Info("decoded-video", $"{Video.NaturalVideoWidth}x{Video.NaturalVideoHeight}"); PresentationMetrics.Info("render-tier", (RenderCapability.Tier >> 16).ToString()); Seek(time); }
    void CompareOpened(object sender, RoutedEventArgs e) { CompareVideo.Pause(); SyncCompare(true); if (playing) CompareVideo.Play(); }
    void CompareFailed(object sender, VideoErrorEventArgs e) { Message.Text = "No se pudo preparar el segundo video: " + e.ErrorException.Message; }
    void VideoFailed(object sender, VideoErrorEventArgs e) { videoReady = false; videoFailed = true; VideoHint.Visibility = Visibility.Visible; VideoHint.Text = "No se pudo abrir el video. La telemetría sigue disponible."; Message.Text = e.ErrorException.Message; }
    void VideoEnded(object sender, RoutedEventArgs e) { playing = false; CompareVideo.Pause(); UpdatePlayIcon(); }
    void PlayClicked(object sender, RoutedEventArgs e)
    {
        if (analysis is null) return;FlushTimelineSeek();
        if (!playing && time >= Timeline.Maximum - .025) { time = Timeline.Minimum; if (VideoTarget(time, firstVideo) is { } restart) Video.Position = TimeSpan.FromSeconds(Math.Max(0, restart)); SyncCompare(true); UpdateCursor(); }
        bool next = !playing; if (scrub.Active) { scrub.End(SeekClock); ApplyScrub(); scrub.Cancel(); }
        playing = next; if (playing) viewport.ResumeFollow(); UpdatePlayIcon();
        if (Video.Source is not null) { if (playing) { Video.Play(); if (SecondVideoColumn.Width.Value > 0) CompareVideo.Play(); } else { Video.Pause(); CompareVideo.Pause(); if (selected is not null && Analysis.FromVideo(selected.Meta, Video.Position.TotalSeconds) is { } stopped) time = ReferenceTime(stopped, firstVideo); SyncCompare(true); UpdateCursor(); } }
    }
    void BackClicked(object sender, RoutedEventArgs e) => Seek(time - 5);
    void ForwardClicked(object sender, RoutedEventArgs e) => Seek(time + 5);
    void TimeChanged(object sender, RoutedPropertyChangedEventArgs<double> e) { if (!internalTime && !loading && analysis is not null) pendingTimelineSeek=e.NewValue; }
    void ScrubDown(object sender, MouseButtonEventArgs e) { if (e.ChangedButton != MouseButton.Left || analysis is null || loading || sender is SeriesView graph && e.GetPosition(graph).Y < 32) return; scrub.Begin(playing, SeekClock); playing = false; Video.Pause(); CompareVideo.Pause(); UpdatePlayIcon(); }
    void ScrubUp(object sender, MouseButtonEventArgs e) { if (e.ChangedButton == MouseButton.Left) Dispatcher.BeginInvoke(FinishDrag, DispatcherPriority.Input); }
    void ScrubCaptureLost(object sender, MouseEventArgs e) { if (Mouse.LeftButton == MouseButtonState.Released) FinishDrag(); }
    void FlushTimelineSeek(){if(pendingTimelineSeek is {} target){pendingTimelineSeek=null;Seek(target);}}
    void FinishDrag() {FlushTimelineSeek(); if (!scrub.Active) return; scrub.End(SeekClock); ApplyScrub(); }
    void Seek(double value)
    {
        if (analysis is null || selected is null) return; time = Math.Clamp(value, 0, analysis.Duration);
        if (chosen.Count > 0 && analysis.At(time) is { } hit) { if (hit.LapId != reference) time = analysis.AtDistance(reference, hit.Distance)?.Packet.T ?? time; var lap = analysis.Laps.First(l => l.Id == reference); time = Math.Clamp(time, lap.Start, lap.End); }
        bool entering = !scrub.Active; scrub.Request(time, playing, SeekClock); playing = false; if (entering) { Video.Pause(); CompareVideo.Pause(); }
        viewport.ResumeFollow(); if (!chartSeeking && viewport.Follow(AnalysisAxis())) ApplyViewport(); UpdatePlayIcon(); UpdateCursor();
    }
    void ApplyScrub()
    {
        var target = scrub.TakeSeek(SeekClock); if (target is { } t && selected is not null && !videoFailed && Video.Source is not null && VideoTarget(t, firstVideo) is { } v) { Video.Position = TimeSpan.FromSeconds(Math.Max(0, v)); SyncCompare(true); }
        if (!Video.IsSeeking && (SecondVideoColumn.Width.Value <= 0 || !CompareVideo.IsSeeking) && scrub.TryFinish(SeekClock, out bool resume)) { playing = resume; UpdatePlayIcon(); if (playing && !videoFailed && Video.Source is not null) { Video.Play(); if (SecondVideoColumn.Width.Value > 0) CompareVideo.Play(); } }
    }
    double ReferenceTime(double source, int sourceLap)
    {
        if (analysis is null || chosen.Count == 0) return source; return LapComparison.MapTime(analysis, source, sourceLap, reference) ?? time;
    }
    double? VideoTarget(double t, int videoLap)
    {
        if (selected is null || analysis is null) return null; if (chosen.Count == 0) return Analysis.ToVideo(selected.Meta, t);
        var mapped = LapComparison.MapTime(analysis, t, reference, videoLap); return mapped is { } position ? Analysis.ToVideo(selected.Meta, position) : null;
    }
    void SyncCompare(bool force)
    {
        if (SecondVideoColumn.Width.Value <= 0 || CompareVideo.Source is null) return;
        if (VideoTarget(time, secondVideo) is not { } target) { CompareVideo.Pause(); return; }
        if (force) CompareVideo.Position = TimeSpan.FromSeconds(Math.Max(0, target));
        else CompareVideo.Follow(Math.Max(0, target));
    }
    void Frame()
    {
        long frameTick = Stopwatch.GetTimestamp(); double clock = SeekClock, delta = lastFrameClock > 0 ? clock - lastFrameClock : 1d / 60; lastFrameClock = clock;FlushTimelineSeek(); ApplyScrub(); if (selected is null || analysis is null || loading || !playing) return;
        if (!videoFailed && Video.Source is not null && videoReady && VideoTarget(time, firstVideo) is not null) { double seconds = Video.Position.TotalSeconds; var mapped = Analysis.FromVideo(selected.Meta, seconds); if (mapped is not null)
            {
                double sourceTime = mapped.Value;
                // Stop a shorter master at its lap boundary instead of playing the next lap.
                var masterLap = chosen.Count > 0 ? analysis.Laps.FirstOrDefault(l => l.Id == firstVideo) : null;
                if (masterLap is not null && sourceTime >= masterLap.End - .025)
                {
                    sourceTime = masterLap.End; playing = false; Video.Pause(); CompareVideo.Pause(); UpdatePlayIcon();
                }
                time = ReferenceTime(sourceTime, firstVideo);
            } }
        else time += Math.Min(.25, delta) * playRate;
        var end = chosen.Count > 0 ? analysis.Laps.First(l => l.Id == reference).End : analysis.Duration; if (time >= end - .025) { time = end; playing = false; Video.Pause(); CompareVideo.Pause(); UpdatePlayIcon(); }
        SyncCompare(false); if (viewport.Follow(AnalysisAxis())) ApplyViewport(); UpdateCursor(); PresentationMetrics.Record("playback-update", Stopwatch.GetElapsedTime(frameTick).TotalMilliseconds);
    }
    void UpdateCursor()
    {
        internalTime = true; Timeline.Value = time; internalTime = false; Clock.Text = ClockText(time); foreach (var plot in Plots) plot.SetTime(time); Route.SetTime(time, playing);
        var p = analysis?.At(time); if (chosen.Count == 0 && p is not null) { selectionUpdating = true; LapPicker.SelectedItem = LapPicker.Items.Cast<LapItem>().FirstOrDefault(l => l.Id == p.LapId); selectionUpdating = false; }
        RenderInstruments(p?.Packet); ObservedTime.Text = $"{(chosen.Count > 0 ? $"VUELTA {p?.Packet.Lap + 1}" : "SESIÓN")} · {SeriesView.DurationText(p?.Packet.T ?? time)}"; MapSpeed.Text = $"{p?.Packet.Speed:0} km/h"; MapDistance.Text = $"{p?.Distance:0} m";
    }
    static string ClockText(double seconds) => $"{(int)(seconds / 60)}:{seconds % 60:00.000}";
    void RenderInstruments(TelemetryPacket? p) { if (selected is null) LiveDashboard.SetPacket(p); else { Dashboard.AnimateReadings = playing; Dashboard.SetPacket(p); } }
    void BuildLapNavigation()
    {
        LapTabs.Children.Clear(); if (analysis is null) return; foreach (var lap in analysis.Laps) { var panel = new StackPanel(); panel.Children.Add(new TextBlock { Text = $"Vuelta {lap.Number + 1}" + (analysis.Fastest?.Id == lap.Id ? "  ⚑" : ""), FontSize = 15, Foreground = analysis.Fastest?.Id == lap.Id ? Brushes.LightGreen : Brushes.White }); panel.Children.Add(new TextBlock { Text = ClockText(lap.Time) + (lap.Partial ? " · parcial" : ""), FontSize = 11, Foreground = Brushes.LightGray, Margin = new Thickness(0, 5, 0, 0) }); var button = new Button { Style = (Style)FindResource("LapTab"), Content = panel, Tag = lap.Id, MinWidth = 110, Foreground = SeriesView.LapBrush(lap.Id) }; button.Click += (_, _) => { if (!chosen.Add(lap.Id)) chosen.Remove(lap.Id); ApplySelection(true); }; LapTabs.Children.Add(button); }
    }
    void BuildLapSummary()
    {
        LapSummary.Children.Clear(); if (analysis is null) return; double best = analysis.Fastest?.Time ?? 0;
        foreach (var lap in analysis.Laps)
        {
            bool fastest = analysis.Fastest?.Id == lap.Id;
            var panel = new StackPanel { Margin = new Thickness(7, 6, 7, 6) };
            panel.Children.Add(new TextBlock { Text = $"Vuelta {lap.Number + 1}" + (fastest ? "  ★" : ""), Foreground = fastest ? Brushes.LightGreen : SeriesView.LapBrush(lap.Id), FontSize = 14 });
            panel.Children.Add(new TextBlock { Text = ClockText(lap.Time), FontFamily = (FontFamily)FindResource("NumberFont"), FontSize = 25, FontWeight = FontWeights.SemiBold, Foreground = fastest ? new SolidColorBrush(Color.FromRgb(115, 241, 171)) : Brushes.White });
            panel.Children.Add(new TextBlock { Text = lap.Partial ? "Parcial" : best > 0 ? $"{lap.Time - best:+0.000;-0.000;0.000} s" : "—", FontSize = 13, Foreground = fastest ? Brushes.LightGreen : new SolidColorBrush(Color.FromRgb(219, 166, 183)) });
            var background = new SolidColorBrush((Color)ColorConverter.ConvertFromString(fastest ? "#11251C" : "#171318"));
            var border = new SolidColorBrush((Color)ColorConverter.ConvertFromString(fastest ? "#61E49A" : "#393039"));
            var shift = new TranslateTransform(); var card = new Border { Child = panel, Background = background, BorderBrush = border, BorderThickness = new Thickness(2, 0, 0, 1), Margin = new Thickness(0, 0, 0, 3), RenderTransform = shift };
            void Hover(bool active) { var duration = TimeSpan.FromMilliseconds(UiMotion.Enabled ? 180 : 0); background.BeginAnimation(SolidColorBrush.ColorProperty, new System.Windows.Media.Animation.ColorAnimation((Color)ColorConverter.ConvertFromString(active ? (fastest ? "#193C2B" : "#30212A") : (fastest ? "#11251C" : "#171318")), duration)); border.BeginAnimation(SolidColorBrush.ColorProperty, new System.Windows.Media.Animation.ColorAnimation((Color)ColorConverter.ConvertFromString(active ? (fastest ? "#A5FFD0" : "#FF6478") : (fastest ? "#61E49A" : "#393039")), duration)); shift.BeginAnimation(TranslateTransform.XProperty, new System.Windows.Media.Animation.DoubleAnimation(active ? 2 : 0, duration)); }
            card.MouseEnter += (_, _) => Hover(true); card.MouseLeave += (_, _) => Hover(false); LapSummary.Children.Add(card);
        }
    }
    void AllClicked(object sender, RoutedEventArgs e) { chosen.Clear(); ApplySelection(true); }
    void ApplySelection(bool seek)
    {
        if (analysis is null) return; selectionUpdating = true;
        var available = analysis.Laps.Where(l => chosen.Count == 0 || chosen.Contains(l.Id)).ToArray(); if (!available.Any(l => l.Id == reference)) reference = available.FirstOrDefault()?.Id ?? 0;
        LapPicker.ItemsSource = available.Select(l => new LapItem(l.Id, $"Vuelta {l.Number + 1}")).ToList(); LapPicker.SelectedItem = LapPicker.Items.Cast<LapItem>().FirstOrDefault(l => l.Id == reference);
        foreach (Button tab in LapTabs.Children) { bool active = chosen.Contains((int)tab.Tag); tab.Background = active ? new SolidColorBrush(Color.FromRgb(44, 21, 29)) : Brushes.Transparent; tab.BorderBrush = active ? SeriesView.LapBrush((int)tab.Tag) : Brushes.Transparent; }
        AllTab.Foreground = chosen.Count == 0 ? Brushes.White : Brushes.Gray; AllTab.BorderBrush = chosen.Count == 0 ? Brushes.Crimson : Brushes.Transparent;
        foreach (var plot in Plots) plot.SetSelection(analysis, chosen, reference); Route.SetSelection(analysis, chosen, reference); viewport.Reset(SpeedPlot.Extent); ApplyViewport(); RefreshActivePlots();
        var choices = available.Select(l => new LapItem(l.Id, $"Vuelta {l.Number + 1}")).ToArray(); FirstVideoPicker.ItemsSource = choices; SecondVideoPicker.ItemsSource = choices;
        firstVideo = available.FirstOrDefault()?.Id ?? 0; secondVideo = available.Skip(1).FirstOrDefault()?.Id ?? firstVideo; FirstVideoPicker.SelectedIndex = 0; SecondVideoPicker.SelectedIndex = Math.Min(1, choices.Length - 1);
        VideoChoices.Visibility = chosen.Count > 1 ? Visibility.Visible : Visibility.Collapsed; SecondVideoColumn.Width = chosen.Count > 1 ? new GridLength(1, GridUnitType.Star) : new GridLength(0); CompareVideo.Pause();
        if (chosen.Count > 1 && Video.Source is not null && CompareVideo.Source is null) { CompareVideo.Source = Video.Source; CompareVideo.Play(); CompareVideo.Pause(); }
        else if (chosen.Count < 2) { CompareVideo.Close(); CompareVideo.Source = null; }
        var first = available.FirstOrDefault(); internalTime = true; Timeline.Minimum = chosen.Count > 0 ? analysis.Laps.First(l => l.Id == reference).Start : 0; Timeline.Maximum = Math.Max(Timeline.Minimum + .001, chosen.Count > 0 ? analysis.Laps.First(l => l.Id == reference).End : analysis.Duration); DurationLabel.Text = ClockText(Timeline.Maximum); internalTime = false; BuildTimeline(); selectionUpdating = false; UpdatePan();
        if (seek) Seek(chosen.Count > 0 ? analysis.Laps.First(l => l.Id == reference).Start : 0);
    }
    void LapSelected(object sender, SelectionChangedEventArgs e)
    {
        if (selectionUpdating || analysis is null || LapPicker.SelectedItem is not LapItem { Id: { } id }) return; double distance = analysis.At(time)?.Distance ?? 0; reference = id; foreach (var plot in Plots) plot.SetReference(id); Route.SetReference(id);
        if (chosen.Count > 0) { internalTime = true; Timeline.Minimum = analysis.Laps.First(l => l.Id == id).Start; Timeline.Maximum = analysis.Laps.First(l => l.Id == id).End; internalTime = false; DurationLabel.Text = ClockText(Timeline.Maximum); BuildTimeline(); Seek(analysis.AtDistance(id, distance)?.Packet.T ?? Timeline.Minimum); } else Seek(analysis.Laps.First(l => l.Id == id).Start);
    }
    void VideoSelectionChanged(object sender, SelectionChangedEventArgs e) { if (selectionUpdating || analysis is null) return; if (FirstVideoPicker.SelectedItem is LapItem { Id: { } a }) firstVideo = a; if (SecondVideoPicker.SelectedItem is LapItem { Id: { } b }) secondVideo = b; Seek(time); }
    void BuildTimeline() { Timeline.SetSegments(analysis?.Laps.Where(l => chosen.Count == 0 || l.Id == reference) ?? []); }
    double AnalysisAxis() => chosen.Count > 0 ? analysis?.At(time)?.Distance ?? 0 : time;
    void ApplyViewport() { foreach (var plot in Plots) plot.SetRange(viewport.Start, viewport.End); UpdatePan(); }
    void RefreshActivePlots()
    {
        if (ChartScroll is null || SpeedPlot is null) return; double top = -ChartScroll.VerticalOffset, height = Math.Max(1, ChartScroll.ViewportHeight);
        foreach (var plot in Plots) { plot.Active = plot.Visibility == Visibility.Visible && top < height && top + plot.Height > 0; if (plot.Visibility == Visibility.Visible) top += plot.Height; }
    }
    void UpdateSessionWidth()
    {
        if (SessionTitle is null || SessionColumn is null) return;
        var text = new FormattedText(SessionTitle.Text, System.Globalization.CultureInfo.CurrentCulture, FlowDirection.LeftToRight, new Typeface((FontFamily)FindResource("DisplayFont"), FontStyles.Italic, FontWeights.Bold, FontStretches.Normal), 21, Brushes.White, VisualTreeHelper.GetDpi(this).PixelsPerDip);
        double limit = Math.Max(360, Math.Min(650, ActualWidth * .45)); SessionColumn.Width = new GridLength(Math.Clamp(text.WidthIncludingTrailingWhitespace + 115, 360, limit));
    }
    void UpdateLapOverflow()
    {
        if (LapNavigation is null || NextLapsButton is null) return; double available = Math.Max(0, LapNavigation.ActualWidth - AllTab.ActualWidth);
        bool more = LapTabs.DesiredSize.Width > available + 1 && LapScroll.HorizontalOffset < LapScroll.ScrollableWidth - .5;
        NextLapsButton.Visibility = more ? Visibility.Visible : Visibility.Collapsed;
    }
    void AnimateNextArrow(double x) => ((TranslateTransform)NextLapsIcon.RenderTransform).BeginAnimation(TranslateTransform.XProperty, new System.Windows.Media.Animation.DoubleAnimation(x, TimeSpan.FromMilliseconds(UiMotion.Enabled ? 180 : 0)));
    void LapWheel(object sender, MouseWheelEventArgs e) { LapScroll.ScrollToHorizontalOffset(LapScroll.HorizontalOffset - e.Delta); e.Handled = true; }
    void MoreLaps(object sender, RoutedEventArgs e) => LapScroll.ScrollToHorizontalOffset(LapScroll.HorizontalOffset + 300);
    void ExpandPlot(SeriesView plot) { expanded = expanded == plot ? null : plot; ResizeCharts(); UiMotion.Enter(ChartStack, 6, 220); chartScrollTarget = 0; Dispatcher.BeginInvoke(() => { ChartScroll.ScrollToVerticalOffset(0); RefreshActivePlots(); }, DispatcherPriority.Loaded); }
    void ResizeCharts() { if (ChartScroll is null || SpeedPlot is null) return; double height = Math.Max(100, ChartScroll.ActualHeight / (expanded is null ? 2 : 1)); foreach (var plot in Plots) { plot.Height = height; plot.Visibility = expanded is null || plot == expanded ? Visibility.Visible : Visibility.Collapsed; } RefreshActivePlots(); }
    void ChartSizeChanged(object sender, SizeChangedEventArgs e) => ResizeCharts();
    double chartScrollTarget;
    void ChartWheel(object sender, MouseWheelEventArgs e)
    {
        if (Keyboard.Modifiers == ModifierKeys.Control) return;
        if (expanded is null) { double step = SpeedPlot.ActualHeight; chartScrollTarget = Math.Clamp(Math.Round(chartScrollTarget / Math.Max(1, step)) * step + (e.Delta > 0 ? -step : step), 0, ChartScroll.ScrollableHeight); UiMotion.ScrollTo(ChartScroll, chartScrollTarget); }
        e.Handled = true;
    }
    void UpdatePan() { ChartPan.SetRange(viewport.Extent, viewport.Start, viewport.Span); }
    void PanChanged(object sender, RoutedPropertyChangedEventArgs<double> e) { if (analysis is null) return; viewport.Pan(e.NewValue); ApplyViewport(); }
    void ZoomIn(object sender, RoutedEventArgs e) { viewport.Zoom(2, AnalysisAxis()); ApplyViewport(); }
    void ZoomOut(object sender, RoutedEventArgs e) { viewport.Zoom(.5, AnalysisAxis()); ApplyViewport(); }
    void ResetPlots(object sender, RoutedEventArgs e) { viewport.Reset(SpeedPlot.Extent); ApplyViewport(); }
    void MapIn(object sender, RoutedEventArgs e) => Route.ZoomMap(1.5);
    void MapOut(object sender, RoutedEventArgs e) => Route.ZoomMap(1 / 1.5);
    void FitRoute(object sender, RoutedEventArgs e) => Route.Fit();
    void RateChanged(object sender, SelectionChangedEventArgs e) { if (RatePicker.SelectedItem is ComboBoxItem item && double.TryParse(item.Tag?.ToString(), System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var rate)) { playRate = rate; if (Video is not null) Video.SpeedRatio = rate; } }
    void VolumeChanged(object sender, RoutedPropertyChangedEventArgs<double> e) { if (Video is not null) Video.Volume = e.NewValue; }
    void MuteClicked(object sender, RoutedEventArgs e) { Video.IsMuted = !Video.IsMuted; MuteButton.Content = new RaceIcon { Kind = Video.IsMuted ? "muted" : "volume" }; }
    async void ImportClicked(object sender, RoutedEventArgs e) { LibraryPopup.IsOpen = false; var dialog = new OpenFileDialog { Title = "Importar sesión", Filter = "Sesión VertexLab|*.vrtx;*.json" }; if (dialog.ShowDialog() == true) await ImportPath(dialog.FileName); }
    async Task ImportPath(string file)
    {
        try { Message.Text = "Importando sesión…"; var progress = new Progress<string>(text => Message.Text = text); var entry = System.IO.Path.GetExtension(file).Equals(".vrtx", StringComparison.OrdinalIgnoreCase) ? await Task.Run(() => PortableSession.ImportAsync(file, paths, library, progress, lifetime.Token)) : await library.ImportLegacyAsync(file, lifetime.Token); RefreshLibrary(); SessionList.SelectedItem = SessionList.Items.Cast<LibraryItem>().First(i => i.Meta.Id == entry.Meta.Id); } catch (Exception ex) { Message.Text = "Importación cancelada: " + ex.Message; }
    }
    async void ExportClicked(object sender, RoutedEventArgs e)
    {
        OptionsPopup.IsOpen = false; if (selected is null) { Message.Text = "Selecciona una sesión finalizada."; return; }
        var dialog = new SaveFileDialog { Filter = "Sesión portable|*.vrtx", FileName = "VertexLab-session.vrtx" }; if (dialog.ShowDialog() != true) return;
        try { await Task.Run(() => PortableSession.ExportAsync(selected, dialog.FileName, new Progress<string>(text => Dispatcher.Invoke(() => Message.Text = text)), lifetime.Token)); Message.Text = "Archivo .vrtx exportado."; } catch (Exception ex) { Message.Text = ex.Message; }
    }
    void FeatureClicked(object sender, RoutedEventArgs e) { if (selected is null) return; selected.Meta.Featured = !selected.Meta.Featured; library.Save(selected.Meta, selected.State); RefreshLibrary(); OptionsPopup.IsOpen = false; }
    async void DeleteClicked(object sender, RoutedEventArgs e)
    {
        OptionsPopup.IsOpen = false; if (selected is null) return; if (MessageBox.Show(this, $"¿Eliminar «{selected.Meta.Name}» y su video? Esta acción los enviará a la papelera de Windows.", "Eliminar sesión", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes) return;
        try
        {
            var entry = selected; LiveClicked(sender, e); await Task.WhenAll(Video.ReleaseAsync(), CompareVideo.ReleaseAsync()); var files = new List<string> { entry.TelemetryPath, paths.MetaPath(entry.Meta.Id) };
            if (entry.Meta.VideoPath is { } video && !library.List().Any(s => s.Meta.Id != entry.Meta.Id && string.Equals(s.Meta.VideoPath, video, StringComparison.OrdinalIgnoreCase))) files.Add(video);
            foreach (var file in files.Distinct(StringComparer.OrdinalIgnoreCase)) if (System.IO.File.Exists(file)) Microsoft.VisualBasic.FileIO.FileSystem.DeleteFile(file, Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs, Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);
            library.Remove(entry.Meta.Id); RefreshLibrary(); Message.Text = "Sesión enviada a la papelera.";
        }
        catch (Exception ex) { Message.Text = "No se pudo eliminar: " + ex.Message; }
    }
    void SettingsClicked(object sender, RoutedEventArgs e) { OptionsPopup.IsOpen = false; new SettingsWindow(paths, engine) { Owner = this }.ShowDialog(); }
}
