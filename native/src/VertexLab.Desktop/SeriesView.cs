using System.Diagnostics;
using System.Globalization;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using VertexLab.Core;
namespace VertexLab.Desktop;

/// <summary>Retained trace layer + lightweight cursor layer. Mouse input is coalesced once per presentation frame.</summary>
public sealed class SeriesView : FrameworkElement
{
    public string Metric { get; set; } = "speed";
    public bool IsMap { get; set; }
    public bool Active { get; set; } = true;
    public double Start => start; public double End => end; public double Extent => extent;
    public int LastHitCandidates => hitIndex?.LastCandidateCount ?? 0;
    public event Action<double>? Seek; public event Action<double, double>? RangeChanged; public event Action? Expand;
    readonly VisualCollection visuals;
    readonly ContainerVisual traceClip = new();
    readonly DrawingVisual traceLayer = new(), overlay = new();
    readonly MatrixTransform traceTransform = new();
    readonly VisualTween inspect = new(.140);
    static readonly FontFamily Numbers = new(new Uri("pack://application:,,,/"), "./Assets/#Rajdhani");
    static readonly Typeface Face = new(Numbers, FontStyles.Normal, FontWeights.SemiBold, FontStretches.Normal);
    static readonly Brush BackgroundBrush = Frozen("#101013"), GridBrush = Frozen("#25282F"), Muted = Frozen("#96909E"), TitleBrush = Frozen("#C9C9D1"), Pink = Frozen("#FF8999");
    public static readonly Color[] Colors = [Color.FromRgb(255, 59, 82), Color.FromRgb(102, 189, 255), Color.FromRgb(255, 191, 110), Color.FromRgb(169, 132, 245), Color.FromRgb(85, 225, 184), Color.FromRgb(243, 126, 208)];
    static readonly Brush[] BrushesByLap = Colors.Select(c => { var b = new SolidColorBrush(c); b.Freeze(); return (Brush)b; }).ToArray();
    public static Brush LapBrush(int id) => BrushesByLap[Math.Abs(id) % BrushesByLap.Length];
    static Brush Frozen(string color) { var b = new SolidColorBrush((Color)ColorConverter.ConvertFromString(color)); b.Freeze(); return b; }
    SessionAnalysis? data; bool comparing; int reference;
    AnalysisPoint[] rows = []; Dictionary<int, AnalysisPoint[]> groups = []; RouteHitIndex? hitIndex;
    readonly List<(int Id, Geometry Shape)> traces = [];
    double start, end = 1, extent = 1, time, maxValue = 1, xmid, zmid, baseMapScale = 1, zoom = 1, baseStart, baseSpan = 1, cacheStart, cacheEnd;
    Vector pan; Point? drag, mouse; bool dragged, dirty = true, cacheDirty = true, pointerDirty, traceStyleDirty;
    AnalysisPoint? current, hovered;
    readonly Dictionary<string, FormattedText> textCache = [];
    readonly Queue<string> textOrder = [];
    static double Now => Stopwatch.GetTimestamp() / (double)Stopwatch.Frequency;
    double PlotWidth => Math.Max(1, ActualWidth - 48); double PlotHeight => Math.Max(1, ActualHeight - 65);
    public SeriesView()
    {
        ClipToBounds = true; Cursor = Cursors.Cross; visuals = new VisualCollection(this) { traceClip, overlay }; traceClip.Children.Add(traceLayer); traceLayer.Transform = traceTransform; inspect.Set(0, Now);
        SizeChanged += (_, _) => { cacheDirty = true; dirty = true; InvalidateVisual(); }; Loaded += (_, _) => CompositionTarget.Rendering += Present; Unloaded += (_, _) => CompositionTarget.Rendering -= Present;
        MouseWheel += Wheel; MouseLeftButtonDown += Down; MouseLeftButtonUp += Up;
        MouseMove += (_, e) => { mouse = e.GetPosition(this); pointerDirty = true; dirty = true; };
        MouseLeave += (_, _) => { mouse = null; pointerDirty = false; inspect.Set(0, Now); dirty = true; };
    }
    protected override int VisualChildrenCount => visuals.Count;
    protected override Visual GetVisualChild(int index) => visuals[index];
    protected override void OnDpiChanged(DpiScale oldDpi, DpiScale newDpi) { base.OnDpiChanged(oldDpi, newDpi); textCache.Clear(); textOrder.Clear(); cacheDirty = dirty = true; }
    protected override void OnRender(DrawingContext dc)
    {
        dc.DrawRectangle(BackgroundBrush, null, new Rect(RenderSize));
        if (!IsMap) { var pen = new Pen(GridBrush, 1); for (int i = 0; i < 3; i++) { double y = 40 + i * PlotHeight / 2; dc.DrawLine(pen, new Point(30, y), new Point(ActualWidth - 18, y)); } }
        dirty = true;
    }
    public void SetData(SessionAnalysis? value, int? lap = null) => SetSelection(value, lap is { } id ? [id] : [], lap ?? 0);
    public void SetSelection(SessionAnalysis? value, IEnumerable<int> selected, int referenceId)
    {
        data = value; var chosen = selected.ToHashSet(); comparing = chosen.Count > 0; reference = referenceId;
        groups = (data?.Points ?? []).Where(p => chosen.Count == 0 || chosen.Contains(p.LapId)).GroupBy(p => p.LapId).ToDictionary(g => g.Key, g => g.ToArray()); rows = groups.Values.SelectMany(g => g).ToArray();
        extent = comparing ? Math.Max(1, rows.Select(p => p.Distance).DefaultIfEmpty(1).Max()) : Math.Max(1, data?.Duration ?? 1); start = 0; end = extent; zoom = 1; pan = new(); current = null; hovered = null; mouse = null; inspect.Reset(); inspect.Set(0, Now);
        if (rows.Length > 0) { xmid = (rows.Min(p => p.Packet.X) + rows.Max(p => p.Packet.X)) / 2; zmid = (rows.Min(p => p.Packet.Z) + rows.Max(p => p.Packet.Z)) / 2; maxValue = Metric is "throttle" or "brake" ? 100 : Math.Max(1, rows.Max(Value)); }
        hitIndex = IsMap ? new RouteHitIndex(rows) : null; cacheDirty = dirty = true;
    }
    public void SetReference(int id) { reference = id; dirty = true; }
    public void SetTime(double value, bool follow = false)
    {
        time = value; var row = data?.At(value); current = comparing && row is not null && row.LapId != reference ? data?.AtDistance(reference, row.Distance) : row;
        if (IsMap && follow && zoom > 1 && current is not null && drag is null) { var point = Map(current.Packet); pan += new Vector(ActualWidth / 2 - point.X, ActualHeight / 2 - point.Y); if (mouse is not null) pointerDirty = true; }
        dirty = true;
    }
    public void SetRange(double a, double b)
    {
        a = Math.Clamp(a, 0, extent); b = Math.Clamp(b, a + .001, Math.Max(a + .001, extent)); if (Math.Abs(start - a) < 1e-8 && Math.Abs(end - b) < 1e-8) return; start = a; end = b; if (mouse is not null && drag is null) pointerDirty = true; dirty = true;
    }
    public void ZoomAtCursor(double factor) { double span = Math.Clamp((end - start) / factor, .05, extent), anchor = CurrentAxis(), a = Math.Clamp(anchor - span * .5, 0, extent - span); SetRange(a, a + span); RangeChanged?.Invoke(start, end); }
    public void ZoomMap(double factor) => ZoomMapAt(new Point(ActualWidth / 2, ActualHeight / 2), factor);
    public void Fit() { zoom = 1; pan = new(); if (IsMap) { traceStyleDirty = dirty = true; } else { SetRange(0, extent); RangeChanged?.Invoke(start, end); } }
    double CurrentAxis() => comparing ? current?.Distance ?? 0 : time;
    double Axis(AnalysisPoint p) => comparing ? p.Distance : p.Packet.T;
    double Value(AnalysisPoint p) => Metric switch { "rpm" => p.Packet.Rpm, "throttle" => p.Packet.Throttle, "brake" => p.Packet.Brake, "lapTime" => p.Packet.LapTime, "raceTime" => p.Packet.RaceTime, "distance" => p.Distance, _ => p.Packet.Speed };
    public static string DurationText(double s) => s < 60 ? $"{s:0.000} s" : $"{s / 60:0.000} min";
    string Label => Metric switch { "rpm" => "Revoluciones", "throttle" => "Acelerador", "brake" => "Freno", "lapTime" => "Tiempo de vuelta", "raceTime" => "Tiempo de carrera", "distance" => "Distancia", _ => "Velocidad" };
    string Format(AnalysisPoint p) => Metric switch { "rpm" => $"{Value(p):N0} RPM", "throttle" or "brake" => $"{Value(p):0}%", "lapTime" or "raceTime" => DurationText(Value(p)), "distance" => $"{Value(p):N0} m", _ => $"{Value(p):0} km/h" };
    double Scale => baseMapScale * zoom;
    Point Map(TelemetryPacket p) => new(ActualWidth / 2 + (p.X - xmid) * Scale + pan.X, ActualHeight / 2 - (p.Z - zmid) * Scale + pan.Y);
    Point Plot(AnalysisPoint p) => new(30 + (Axis(p) - start) / Math.Max(.001, end - start) * PlotWidth, ActualHeight - 25 - Value(p) / maxValue * PlotHeight);
    Point Position(AnalysisPoint p) => IsMap ? Map(p.Packet) : Plot(p);
    int Lower(AnalysisPoint[] array, double target) { int lo = 0, hi = array.Length; while (lo < hi) { int m = (lo + hi) / 2; if (Axis(array[m]) < target) lo = m + 1; else hi = m; } return lo; }
    void BuildCache()
    {
        traces.Clear(); if (rows.Length == 0) { DrawTraces(); cacheDirty = false; return; }
        double span = Math.Max(.001, end - start); baseStart = start; baseSpan = span; cacheStart = Math.Max(0, start - span); cacheEnd = Math.Min(extent, end + span);
        if (IsMap) { double xextent = Math.Max(1, rows.Max(p => p.Packet.X) - rows.Min(p => p.Packet.X)), zextent = Math.Max(1, rows.Max(p => p.Packet.Z) - rows.Min(p => p.Packet.Z)); baseMapScale = Math.Min(Math.Max(1, ActualWidth - 40) / xextent, Math.Max(1, ActualHeight - 40) / zextent); }
        foreach (var (id, group) in groups)
        {
            var shape = new StreamGeometry(); using (var context = shape.Open())
            {
                bool begun = false;
                void Add(int index) { var row = group[index]; if (row.Gap || row.Packet.BreakBefore) begun = false; var point = IsMap ? new Point((row.Packet.X - xmid) * baseMapScale, -(row.Packet.Z - zmid) * baseMapScale) : new Point((Axis(row) - baseStart) / baseSpan * PlotWidth, ActualHeight - 25 - Value(row) / maxValue * PlotHeight); if (!begun) { context.BeginFigure(point, false, false); begun = true; } else context.LineTo(point, true, false); }
                if (IsMap) { for (int i = 0; i < group.Length; i++) Add(i); }
                else
                {
                    int first = -1, min = -1, max = -1, last = -1, column = int.MinValue;
                    void Flush() { if (first < 0) return; Span<int> indexes = stackalloc int[] { first, min, max, last }; indexes.Sort(); int previous = -1; foreach (int index in indexes) if (index != previous) { Add(index); previous = index; } }
                    int from = Math.Max(0, Lower(group, cacheStart) - 1), to = Math.Min(group.Length, Lower(group, cacheEnd) + 1);
                    for (int i = from; i < to; i++) { var row = group[i]; int next = (int)Math.Floor((Axis(row) - baseStart) / span * PlotWidth); if (next != column || row.Gap || row.Packet.BreakBefore) { Flush(); first = min = max = last = i; column = next; } else { last = i; if (Value(row) < Value(group[min])) min = i; if (Value(row) > Value(group[max])) max = i; } }
                    Flush();
                }
            }
            shape.Freeze(); traces.Add((id, shape));
        }
        cacheDirty = false; DrawTraces();
    }
    void DrawTraces() { using var dc = traceLayer.RenderOpen(); foreach (var (id, shape) in traces) dc.DrawGeometry(null, new Pen(LapBrush(id), IsMap ? 1.3 / zoom : 1.3), shape); traceStyleDirty = false; }
    void Present(object? sender, EventArgs e)
    {
        if (!IsVisible || !Active || ActualWidth < 1 || ActualHeight < 1) return;
        if (!dirty && !pointerDirty && !inspect.Active(Now)) return; long tick = Stopwatch.GetTimestamp();
        if (pointerDirty && mouse is { } point)
        {
            if (drag is { } last && Mouse.LeftButton == MouseButtonState.Pressed) { if (IsMap) { if ((point - last).Length > 1) dragged = true; pan += point - last; drag = point; } else SeekAt(point); }
            else { hovered = Nearest(point); inspect.Set(hovered is null ? 0 : 1, Now); Cursor = !IsMap && point.Y < 32 ? Cursors.Hand : Cursors.Cross; }
            pointerDirty = false;
        }
        bool expired = !IsMap && (Math.Abs((end - start) - baseSpan) > Math.Max(.00001, baseSpan * .001) || start < cacheStart || end > cacheEnd);
        if (cacheDirty || expired) BuildCache(); else if (traceStyleDirty) DrawTraces();
        traceClip.Clip = new RectangleGeometry(IsMap ? new Rect(RenderSize) : new Rect(30, 35, PlotWidth, Math.Max(1, ActualHeight - 59)));
        traceTransform.Matrix = IsMap ? new Matrix(zoom, 0, 0, zoom, ActualWidth / 2 + pan.X, ActualHeight / 2 + pan.Y) : new Matrix(1, 0, 0, 1, 30 + (baseStart - start) / Math.Max(.001, end - start) * PlotWidth, 0);
        DrawOverlay(); dirty = false; PresentationMetrics.Record(IsMap ? "map-present" : "chart-present", Stopwatch.GetElapsedTime(tick).TotalMilliseconds);
    }
    AnalysisPoint? Nearest(Point point)
    {
        if (IsMap) { double x = xmid + (point.X - ActualWidth / 2 - pan.X) / Math.Max(.0001, Scale), z = zmid - (point.Y - ActualHeight / 2 - pan.Y) / Math.Max(.0001, Scale); long hitTick = Stopwatch.GetTimestamp(); var hit = hitIndex?.Find(x, z, 12 / Math.Max(.0001, Scale)); PresentationMetrics.Record("map-hit", Stopwatch.GetElapsedTime(hitTick).TotalMilliseconds); return hit; }
        double target = Math.Clamp(start + (point.X - 30) / PlotWidth * (end - start), start, end), best = double.PositiveInfinity; AnalysisPoint? result = null;
        foreach (var (id, _) in groups) { var p = comparing ? data?.AtDistance(id, target) : data?.At(target); if (p is null || p.LapId != id) continue; double distance = Math.Abs(Plot(p).Y - point.Y); if (distance < best) { best = distance; result = p; } }
        return result;
    }
    void Text(DrawingContext dc, string text, Point at, double size, Brush? brush = null)
    {
        string key = $"{size}:{brush?.ToString()}:{text}"; if (!textCache.TryGetValue(key, out var formatted)) { formatted = new FormattedText(text, CultureInfo.CurrentCulture, FlowDirection.LeftToRight, Face, size, brush ?? TitleBrush, VisualTreeHelper.GetDpi(this).PixelsPerDip); textCache[key] = formatted; textOrder.Enqueue(key); if (textOrder.Count > 96) textCache.Remove(textOrder.Dequeue()); }
        dc.DrawText(formatted, at);
    }
    void DrawOverlay()
    {
        using var dc = overlay.RenderOpen(); if (!IsMap)
        {
            Text(dc, Label, new Point(12, 9), 14, mouse is { } title && title.Y < 32 ? Pink : TitleBrush); if (current is not null) Text(dc, Format(current), new Point(Math.Max(125, ActualWidth - 155), 5), 25, Brushes.White);
            double x = 30 + (CurrentAxis() - start) / Math.Max(.001, end - start) * PlotWidth; if (x >= 30 && x <= ActualWidth - 18) dc.DrawLine(new Pen(Brushes.White, .8), new Point(x, 35), new Point(x, ActualHeight - 24));
            Text(dc, comparing ? $"{start:0} m" : DurationText(start), new Point(30, ActualHeight - 19), 10, Muted); Text(dc, comparing ? $"{end:0} m" : DurationText(end), new Point(Math.Max(70, ActualWidth - 92), ActualHeight - 19), 10, Muted);
        }
        else if (current is { } sample) { foreach (int id in comparing ? groups.Keys : (IEnumerable<int>)[sample.LapId]) { var marker = comparing ? data?.AtDistance(id, sample.Distance) : sample; if (marker is not null) dc.DrawEllipse(LapBrush(id), new Pen(Brushes.White, id == reference ? 2 : 1), Map(marker.Packet), id == reference ? 4.5 : 3.5, id == reference ? 4.5 : 3.5); } }
        if (inspect.Value(Now) > .001 && hovered is { } nearest && (IsMap || mouse is null || mouse?.Y >= 32))
        {
            dc.PushOpacity(inspect.Value(Now)); var trace = traces.FirstOrDefault(t => t.Id == nearest.LapId); if (trace.Shape is not null) { dc.PushClip(new RectangleGeometry(IsMap ? new Rect(RenderSize) : new Rect(30, 35, PlotWidth, Math.Max(1, ActualHeight - 59)))); dc.PushTransform(traceTransform); dc.DrawGeometry(null, new Pen(LapBrush(nearest.LapId), IsMap ? 2.3 / zoom : 2.3), trace.Shape); dc.Pop(); dc.Pop(); }
            var point = Position(nearest); dc.DrawEllipse(LapBrush(nearest.LapId), new Pen(Brushes.White, 1.5), point, 4, 4); double x = Math.Clamp(point.X + 10, 8, Math.Max(8, ActualWidth - 190)), y = Math.Clamp(point.Y - 30, 34, Math.Max(34, ActualHeight - 48)); dc.DrawRoundedRectangle(Frozen("#1B1019"), new Pen(LapBrush(nearest.LapId), 1), new Rect(x, y, 180, 26), 2, 2); Text(dc, $"V{nearest.Packet.Lap + 1} · {Format(nearest)}", new Point(x + 6, y + 4), 14, Brushes.White); dc.Pop();
        }
    }
    void ZoomMapAt(Point mouse, double factor) { double next = Math.Clamp(zoom * factor, 1, 200), ratio = next / zoom; var from = new Vector(mouse.X - ActualWidth / 2, mouse.Y - ActualHeight / 2); pan = from - (from - pan) * ratio; zoom = next; traceStyleDirty = dirty = true; }
    void Wheel(object sender, MouseWheelEventArgs e) { if (data is null) return; if (IsMap) ZoomMapAt(e.GetPosition(this), e.Delta > 0 ? 1.3 : 1 / 1.3); else { double factor = e.Delta > 0 ? 1.3 : 1 / 1.3, span = Math.Clamp((end - start) / factor, .05, extent), part = Math.Clamp((e.GetPosition(this).X - 30) / PlotWidth, 0, 1), anchor = start + (end - start) * part, a = Math.Clamp(anchor - span * part, 0, extent - span); RangeChanged?.Invoke(a, a + span); } e.Handled = true; }
    void Down(object sender, MouseButtonEventArgs e) { if (!IsMap && e.GetPosition(this).Y < 32) { Expand?.Invoke(); e.Handled = true; return; } drag = e.GetPosition(this); dragged = false; CaptureMouse(); if (!IsMap) SeekAt(drag.Value); e.Handled = true; }
    void Up(object sender, MouseButtonEventArgs e) { if (drag is not null) { if (IsMap && !dragged) SeekAt(e.GetPosition(this)); else if (!IsMap) SeekAt(e.GetPosition(this)); drag = null; pointerDirty = false; ReleaseMouseCapture(); e.Handled = true; } }
    void SeekAt(Point point) { if (Nearest(point) is { } nearest) Seek?.Invoke(nearest.Packet.T); }
}
