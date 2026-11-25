using System.Diagnostics;
using Color = System.Drawing.Color;
using System.Text.Json;
using VertexLab.Core;
using VertexLab.Playback;
using Vortice.MediaFoundation;
using Vortice.Mathematics;
using static Vortice.MediaFoundation.MediaFactory;

namespace VertexLab.PlaybackProbe;

internal static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        MFStartup().CheckError();
        try { Application.Run(new ProbeWindow(args)); }
        finally { MFShutdown(); }
    }
}

sealed class ProbeWindow : Form
{
    readonly MediaEnginePane master = new(), follower = new();
    readonly ScheduledVideoPane? scheduled;
    readonly Label status = new() { AutoSize = false, Dock = DockStyle.Bottom, Height = 110, ForeColor = Color.White };
    readonly TrackBar timeline = new() { Dock = DockStyle.Bottom, Height = 45, TickStyle = TickStyle.None, AccessibleName = "Tiempo de reproducción" };
    readonly System.Windows.Forms.Timer timer = new() { Interval = 15 };
    readonly List<double> drift = [], ticks = [];
    readonly List<object> samples = [];
    readonly Stopwatch wall = new(); readonly Process process = Process.GetCurrentProcess();
    readonly string? report; readonly double seconds; readonly bool automatic, distance, elapsed;
    readonly bool corrections; readonly double fixedRate;
    SessionMeta? meta; SessionAnalysis? analysis;
    int first, second; bool initialized, playing, dragging, resume, preparing, saving;
    double lastTick, lastSample, lastCorrection = double.NegativeInfinity, cpuStart;
    long renderedA, renderedB, droppedA, droppedB;
    double? seekTarget;
    readonly double createdAt = MediaEnginePane.Now;
    static readonly JsonSerializerOptions Json = new() { WriteIndented = true };
    public ProbeWindow(string[] args)
    {
        string? Arg(string key) { int i = Array.IndexOf(args, key); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
        report = Arg("--report"); seconds = double.TryParse(Arg("--seconds"), out var duration) ? duration : 60;
        automatic = args.Contains("--measure"); distance = args.Contains("--distance"); elapsed = !distance && !args.Contains("--clock-only");
        corrections = !args.Contains("--no-corrective-seeks"); fixedRate = double.TryParse(Arg("--fixed-rate"), out var fixedValue) ? fixedValue : 1;
        scheduled = (args.Contains("--scheduled-follower") || ((distance || elapsed) && !args.Contains("--native-follower"))) ? new ScheduledVideoPane() : null;
        Text = "VertexLab · Media Engine · prueba aislada"; Width = 1400; Height = 850; BackColor = Color.FromArgb(14, 14, 18);
        var split = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1 };
        split.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50)); split.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        split.Controls.Add(master, 0, 0); split.Controls.Add((Control?)scheduled ?? follower, 1, 0);
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 45 };
        void Button(string label, Action action) { var button = new Button { Text = label, AutoSize = true, Height = 35, ForeColor = Color.White, BackColor = Color.FromArgb(40, 40, 45) }; button.Click += (_, _) => action(); buttons.Controls.Add(button); }
        Button("Reproducir / pausa", Toggle); Button("−1 fotograma", () => SeekTo(CurrentSessionTime() - 1d / 60)); Button("+1 fotograma", () => SeekTo(CurrentSessionTime() + 1d / 60));
        Controls.Add(split); Controls.Add(timeline); Controls.Add(status); Controls.Add(buttons);
        timeline.MouseDown += (_, _) => { dragging = true; resume = playing; Pause(); };
        timeline.Scroll += (_, _) => { if (dragging) seekTarget = timeline.Value / 1000d; };
        timeline.MouseUp += (_, _) => { seekTarget = timeline.Value / 1000d; dragging = false; };
        timer.Tick += (_, _) => TickPlayback();
        Shown += (_, _) =>
        {
            try
            {
                string path = Arg("--session") ?? throw new ArgumentException("Usa --session con el JSON de una sesión finalizada.");
                meta = Wire.Decode<SessionMeta>(File.ReadAllText(path));
                if (meta.VideoPath is null) throw new InvalidDataException("La sesión no tiene video.");
                analysis = Analysis.Load(Path.ChangeExtension(path, ".jsonl"));
                first = analysis.Laps.ElementAtOrDefault(1)?.Id ?? analysis.Laps[0].Id;
                second = analysis.Laps.ElementAtOrDefault(2)?.Id ?? first;
                timeline.Minimum = (int)(analysis.Laps.First(l => l.Id == first).Start * 1000);
                timeline.Maximum = (int)(analysis.Laps.First(l => l.Id == first).End * 1000);
                string videoPath = Path.GetFullPath(meta.VideoPath, Path.GetDirectoryName(Path.GetFullPath(path))!);
                master.Open(videoPath, false); if (scheduled is not null) scheduled.Open(videoPath); else follower.Open(videoPath, true); timer.Start();
            }
            catch (Exception ex) { status.Text = ex.ToString(); Save("initialization-error", ex.Message); }
        };
        FormClosing += (_, _) => { timer.Stop(); if (!saving && initialized) Save("manual-close"); };
    }
    bool FollowerReady => scheduled?.Ready ?? follower.Ready;
    bool FollowerSeeking => scheduled?.Seeking ?? (follower.Seeking || follower.Engine.IsSeeking);
    double FollowerTime => scheduled?.PresentedTime ?? (scheduled is not null ? 0 : follower.Engine.CurrentTime);
    void FollowerSeek(double value) { if (scheduled is not null) scheduled.Request(value, true); else follower.Seek(value); }
    double CurrentSessionTime() => meta is null ? 0 : Analysis.FromVideo(meta, master.Engine.CurrentTime) ?? 0;
    double? Target(double sessionTime) => meta is null || analysis is null ? null : Analysis.ToVideo(meta, distance ? LapComparison.MapTime(analysis, sessionTime, first, second) ?? double.NaN : elapsed ? LapComparison.MapElapsedTime(analysis, sessionTime, first, second) ?? double.NaN : timeline.Minimum / 1000d + 60 + (sessionTime - timeline.Minimum / 1000d) * fixedRate);
    void Pause() { playing = false; if (!initialized) return; master.Engine.Pause(); if (scheduled is null) follower.Engine.Pause(); }
    void Toggle()
    {
        if (!initialized) return;
        if (playing) { Pause(); if (Target(CurrentSessionTime()) is { } target && double.IsFinite(target)) FollowerSeek(target); }
        else resume = true;
    }
    void SeekTo(double sessionTime)
    {
        if (!initialized || meta is null) return;
        Pause(); sessionTime = Math.Clamp(sessionTime, timeline.Minimum / 1000d, timeline.Maximum / 1000d);
        if (Analysis.ToVideo(meta, sessionTime) is { } target) master.Seek(target);
        if (Target(sessionTime) is { } other && double.IsFinite(other)) FollowerSeek(other);
    }
    void Start()
    {
        resume = false; playing = true; master.Engine.Play(); if (scheduled is null) follower.Engine.Play();
        if (!wall.IsRunning)
        {
            renderedA = master.Stat(MediaEngineStatistic.FramesRendered); renderedB = scheduled is null ? follower.Stat(MediaEngineStatistic.FramesRendered) : scheduled.Presented;
            droppedA = master.Stat(MediaEngineStatistic.FramesDropped); droppedB = scheduled is null ? follower.Stat(MediaEngineStatistic.FramesDropped) : 0;
            cpuStart = process.TotalProcessorTime.TotalSeconds; wall.Start();
        }
    }
    void TickPlayback()
    {
        try
        {
            if (!initialized && MediaEnginePane.Now - createdAt > 15) { status.Text = "El motor no terminó de preparar el video en 15 segundos."; Finish("initialization-timeout"); return; }
            if (master.Failure is not null || follower.Failure is not null || scheduled?.Failure is not null) { Pause(); status.Text = master.Failure ?? follower.Failure ?? scheduled?.Failure; if (automatic) Finish("decoder-error"); return; }
            if (!master.Ready || !FollowerReady || analysis is null || meta is null) return;
            if (!initialized) { initialized = true; preparing = true; SeekTo(timeline.Minimum / 1000d); resume = automatic; }
            if (seekTarget is { } target) { seekTarget = null; SeekTo(target); }
            if (scheduled is not null && Target(CurrentSessionTime()) is { } requested && double.IsFinite(requested)) scheduled.PresentAt(requested);
            if (preparing && !master.Seeking && !FollowerSeeking) preparing = false;
            if (resume && !dragging && !master.Seeking && !master.Engine.IsSeeking && !FollowerSeeking) Start();
            double current = CurrentSessionTime(), now = MediaEnginePane.Now;
            if (playing && !master.Seeking && !master.Engine.IsSeeking)
            {
                if (Target(current) is { } other && double.IsFinite(other) && !FollowerSeeking)
                {
                    double error = other - FollowerTime; drift.Add(Math.Abs(error) * 1000);
                    double ahead = .1;
                    var a = Target(current - ahead); var b = Target(current + ahead);
                    double rate = a is { } va && b is { } vb && double.IsFinite(va) && double.IsFinite(vb) ? (vb - va) / (2 * ahead) : 1;
                    if (scheduled is null) follower.SetRate(Math.Clamp(rate + Math.Clamp(error * .5, -.08, .08), .25, 4));
                    if (scheduled is null && corrections && Math.Abs(error) > .12 && now - lastCorrection > .75) { FollowerSeek(other); lastCorrection = now; }
                }
                if (lastTick > 0) ticks.Add((now - lastTick) * 1000); lastTick = now;
                if (!dragging) timeline.Value = Math.Clamp((int)(current * 1000), timeline.Minimum, timeline.Maximum);
            }
            var sample = analysis.At(current);
            if (wall.IsRunning && now - lastSample >= 1)
            {
                lastSample = now;
                samples.Add(new { elapsed = wall.Elapsed.TotalSeconds, master = master.Engine.CurrentTime, follower = FollowerTime, rate = scheduled is null ? follower.Engine.PlaybackRate : 0, paused = scheduled is null && (bool)follower.Engine.IsPaused, seeking = FollowerSeeking, ready = FollowerReady, rendered = scheduled is null ? follower.Stat(MediaEngineStatistic.FramesRendered) : scheduled.Presented, dropped = scheduled is null ? follower.Stat(MediaEngineStatistic.FramesDropped) : scheduled.Late });
            }
            status.Text = $"Media Engine Windows · {(distance ? "comparación por distancia · vueltas 2 / 3" : elapsed ? "tiempo de vuelta Forza · vueltas 2 / 3" : "relojes a velocidad constante")}\n" +
                $"Tiempo {current:F3} s · Telemetría {sample?.Packet.Speed:F0} km/h · {meta.SyncState} (sin recalibrar la grabación)\n" +
                $"A {master.Engine.CurrentTime:F3}s / B {FollowerTime:F3}s · búsquedas {master.Seeks}/{(scheduled?.Seeks ?? follower.Seeks)} · presentados B {(scheduled is null ? follower.Stat(MediaEngineStatistic.FramesRendered) : scheduled.Presented)}";
            if (automatic && wall.Elapsed.TotalSeconds >= seconds) Finish("completed");
            else if (current >= timeline.Maximum / 1000d - .02) { Pause(); if (automatic) Finish("lap-end"); }
        }
        catch (Exception ex) { timer.Stop(); status.Text = ex.ToString(); Save("runtime-error", ex.Message); }
    }
    static object Distribution(List<double> values)
    {
        double[] a = values.Order().ToArray();
        return new { count = a.Length, median = a.Length == 0 ? 0 : a[a.Length / 2], p95 = a.Length == 0 ? 0 : a[(int)((a.Length - 1) * .95)], max = a.LastOrDefault() };
    }
    void Save(string outcome, string? error = null)
    {
        if (report is null) return;
        var result = new { outcome, error, backend = scheduled is null ? "Windows Media Engine / HWND rendering" : "Media Engine master / SourceReader GPU scheduled follower", mode = distance ? "distance" : elapsed ? "elapsed-lap-clock" : "clock-only", elapsedSeconds = wall.Elapsed.TotalSeconds,
            cpuSeconds = process.TotalProcessorTime.TotalSeconds - cpuStart, workingSetBytes = process.WorkingSet64,
            driftMilliseconds = Distribution(drift), uiTickMilliseconds = Distribution(ticks), samples,
            master = new { rendered = initialized ? master.Stat(MediaEngineStatistic.FramesRendered) - renderedA : 0, dropped = initialized ? master.Stat(MediaEngineStatistic.FramesDropped) - droppedA : 0, master.Seeks, master.RateChanges, seeksMilliseconds = Distribution(master.SeekMilliseconds) },
            follower = scheduled is null ? (object)new { rendered = initialized ? follower.Stat(MediaEngineStatistic.FramesRendered) - renderedB : 0, dropped = initialized ? follower.Stat(MediaEngineStatistic.FramesDropped) - droppedB : 0, follower.Seeks, follower.RateChanges, follower.EventCounts, seeksMilliseconds = Distribution(follower.SeekMilliseconds) } : new { scheduled.Presented, scheduled.Decoded, scheduled.Seeks, scheduled.Late, frameErrorMilliseconds = Distribution(scheduled.FrameErrors), scheduled.Failure } };
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(report))!); File.WriteAllText(report, JsonSerializer.Serialize(result, Json));
    }
    void Finish(string outcome) { Pause(); wall.Stop(); saving = true; Save(outcome); if (automatic) Close(); }
}
