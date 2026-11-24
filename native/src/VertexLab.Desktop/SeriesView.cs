using System.Globalization;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using VertexLab.Core;
namespace VertexLab.Desktop;

// Static traces are cached; playback redraws only the cursor and current values.
public sealed class SeriesView : FrameworkElement
{
    public string Metric { get; set; } = "speed"; public bool IsMap { get; set; }
    SessionAnalysis? data; HashSet<int> laps = []; bool comparing; int reference;
    double start, end = 1, extent = 1, time, maxValue = 1, xmin, xmax, zmin, zmax, zoom = 1; Vector pan, builtPan; Point? drag, hover; bool dragged;
    AnalysisPoint[] rows = []; Dictionary<int, AnalysisPoint[]> groups = []; AnalysisPoint? hovered; readonly List<(int Id, Geometry Shape, Pen Pen)> traces = [];
    public static readonly Color[] Colors = [Color.FromRgb(255, 59, 82), Color.FromRgb(102, 189, 255), Color.FromRgb(255, 191, 110), Color.FromRgb(169, 132, 245), Color.FromRgb(85, 225, 184), Color.FromRgb(243, 126, 208)];
    public static Brush LapBrush(int id) => new SolidColorBrush(Colors[Math.Abs(id) % Colors.Length]);
    public event Action<double>? Seek; public event Action<double, double>? RangeChanged; public event Action? Expand;
    public double Start => start; public double End => end; public double Extent => extent;
    public SeriesView() { ClipToBounds = true; Cursor = Cursors.Cross; SizeChanged += (_, _) => Rebuild(); MouseWheel += Wheel; MouseLeftButtonDown += Down; MouseMove += Move; MouseLeftButtonUp += Up; MouseLeave += (_, _) => { hover = null; hovered = null; InvalidateVisual(); }; }
    public void SetData(SessionAnalysis? value, int? lap = null) => SetSelection(value, lap is { } id ? [id] : [], lap ?? 0);
    public void SetSelection(SessionAnalysis? value, IEnumerable<int> selected, int referenceId)
    {
        data = value; laps = selected.ToHashSet(); comparing = laps.Count > 0; reference = referenceId; rows = data?.Points.Where(p => laps.Count == 0 || laps.Contains(p.LapId)).ToArray() ?? []; groups = rows.GroupBy(p => p.LapId).ToDictionary(g => g.Key, g => g.ToArray()); hovered = null; extent = comparing ? Math.Max(1, rows.Select(r => r.Distance).DefaultIfEmpty(1).Max()) : Math.Max(1, data?.Duration ?? 1); start = 0; end = extent; zoom = 1; pan = new();
        if (rows.Length > 0) { xmin = rows.Min(r => r.Packet.X); xmax = rows.Max(r => r.Packet.X); zmin = rows.Min(r => r.Packet.Z); zmax = rows.Max(r => r.Packet.Z); maxValue = Metric is "throttle" or "brake" ? 100 : Math.Max(1, rows.Max(Value)); }
        Rebuild();
    }
    public void SetReference(int id) { reference = id; InvalidateVisual(); }
    public void SetTime(double value, bool follow = false)
    {
        time = value; if (follow)
        {
            if (IsMap && zoom > 1 && Current() is { } row) { var position = Map(row.Packet); pan += new Vector(ActualWidth / 2 - position.X, ActualHeight / 2 - position.Y); InvalidateVisual(); return; }
            double x = CurrentAxis(); if (!IsMap && end - start < extent - .001 && (x > end - (end - start) * .12 || x < start)) { double width = end - start; SetRange(Math.Clamp(x - width * .45, 0, extent - width), Math.Clamp(x - width * .45, 0, extent - width) + width); RangeChanged?.Invoke(start, end); return; }
        }
        InvalidateVisual();
    }
    AnalysisPoint? Current() { var p = data?.At(time); return comparing && p is not null && p.LapId != reference ? data?.AtDistance(reference, p.Distance) : p; }
    double CurrentAxis() => comparing ? Current()?.Distance ?? 0 : time;
    public void SetRange(double a, double b) { start = Math.Clamp(a, 0, extent); end = Math.Clamp(b, start + .001, Math.Max(start + .001, extent)); Rebuild(); }
    public void ZoomAtCursor(double factor) { double width = Math.Clamp((end - start) / factor, .05, extent), fraction = Math.Clamp((CurrentAxis() - start) / Math.Max(.001, end - start), 0, 1), a = Math.Clamp(CurrentAxis() - width * fraction, 0, extent - width); SetRange(a, a + width); RangeChanged?.Invoke(start, end); }
    public void ZoomMap(double factor) { ZoomMapAt(new Point(ActualWidth / 2, ActualHeight / 2), factor); }
    public void Fit() { zoom = 1; pan = new(); SetRange(0, extent); RangeChanged?.Invoke(start, end); }
    double Axis(AnalysisPoint p) => comparing ? p.Distance : p.Packet.T;
    double Value(AnalysisPoint p) => Metric switch { "rpm" => p.Packet.Rpm, "throttle" => p.Packet.Throttle, "brake" => p.Packet.Brake, "lapTime" => p.Packet.LapTime, "raceTime" => p.Packet.RaceTime, "distance" => p.Distance, _ => p.Packet.Speed };
    public static string DurationText(double s) => s < 60 ? $"{s:0.000} s" : $"{s / 60:0.000} min";
    string Label => Metric switch { "rpm" => "Revoluciones", "throttle" => "Acelerador", "brake" => "Freno", "lapTime" => "Tiempo de vuelta", "raceTime" => "Tiempo de carrera", "distance" => "Distancia", _ => "Velocidad" };
    string Format(AnalysisPoint p) => Metric switch { "rpm" => $"{Value(p):N0} RPM", "throttle" or "brake" => $"{Value(p):0}%", "lapTime" or "raceTime" => DurationText(Value(p)), "distance" => $"{Value(p):N0} m", _ => $"{Value(p):0} km/h" };
    double Scale => Math.Min(Math.Max(1, ActualWidth - 40) / Math.Max(1, xmax - xmin), Math.Max(1, ActualHeight - 40) / Math.Max(1, zmax - zmin)) * zoom;
    Point Map(TelemetryPacket p) => new(ActualWidth / 2 + (p.X - (xmin + xmax) / 2) * Scale + pan.X, ActualHeight / 2 - (p.Z - (zmin + zmax) / 2) * Scale + pan.Y);
    Point Plot(AnalysisPoint p) => new(30 + (Axis(p) - start) / Math.Max(.001, end - start) * Math.Max(1, ActualWidth - 48), ActualHeight - 25 - Value(p) / maxValue * Math.Max(1, ActualHeight - 65));
    Point Position(AnalysisPoint p) => IsMap ? Map(p.Packet) : Plot(p);
    void Rebuild()
    {
        builtPan = pan; traces.Clear(); if (data is null || ActualWidth < 1 || ActualHeight < 1) { InvalidateVisual(); return; }
        foreach (var group in groups)
        {
            var geometry = new StreamGeometry(); using (var context = geometry.Open())
            {
                bool begun = false; Point previous = new(double.NaN, double.NaN);
                var visible = IsMap ? group.Value : group.Value.Where(r => Axis(r) >= start && Axis(r) <= end);
                foreach (var row in IsMap ? visible : Reduce(visible))
                {
                    var point = Position(row); if (row.Gap || row.Packet.BreakBefore) begun = false; if (IsMap && begun && (point - previous).LengthSquared < .7) continue;
                    if (!begun) { context.BeginFigure(point, false, false); begun = true; } else context.LineTo(point, true, false); previous = point;
                }
            }
            geometry.Freeze(); var pen = new Pen(LapBrush(group.Key), 1.3); pen.Freeze(); traces.Add((group.Key, geometry, pen));
        }
        InvalidateVisual();
    }
    IEnumerable<AnalysisPoint> Reduce(IEnumerable<AnalysisPoint> source)
    {
        var bucket = new List<AnalysisPoint>(); int column = -1;
        IEnumerable<AnalysisPoint> Flush() => bucket.Count == 0 ? [] : new[] { bucket[0], bucket.MinBy(Value)!, bucket.MaxBy(Value)!, bucket[^1] }.Distinct().OrderBy(Axis);
        foreach (var row in source) { int next = (int)((Axis(row) - start) / Math.Max(.001, end - start) * Math.Max(1, ActualWidth)); if (next != column || row.Gap || row.Packet.BreakBefore) { foreach (var point in Flush()) yield return point; bucket.Clear(); column = next; } bucket.Add(row); }
        foreach (var point in Flush()) yield return point;
    }
    void Text(DrawingContext dc, string text, Point at, double size, Brush? brush = null) => dc.DrawText(new FormattedText(text, CultureInfo.CurrentCulture, FlowDirection.LeftToRight, new Typeface(new FontFamily(new Uri("pack://application:,,,/"), "./Assets/#Rajdhani"), FontStyles.Normal, FontWeights.SemiBold, FontStretches.Normal), size, brush ?? Brushes.LightGray, VisualTreeHelper.GetDpi(this).PixelsPerDip), at);
    AnalysisPoint? Nearest(Point point)
    {
        // Hit-testing uses the cached visible, reduced geometry instead of scanning the entire session.
        double best = double.PositiveInfinity; AnalysisPoint? result = null;
        foreach (var group in groups)
        {
            if (IsMap) { foreach (var p in group.Value.Where((_, i) => i % 4 == 0)) { double d = (Position(p) - point).LengthSquared; if (d < best) { best = d; result = p; } } }
            else { double axis = start + (point.X - 30) / Math.Max(1, ActualWidth - 48) * (end - start); var p = comparing ? data?.AtDistance(group.Key, axis) : data?.At(axis); if (p is null || p.LapId != group.Key) continue; double d = (Position(p) - point).LengthSquared; if (d < best) { best = d; result = p; } }
        }
        return result;
    }
    protected override void OnRender(DrawingContext dc)
    {
        dc.DrawRectangle(new SolidColorBrush(Color.FromRgb(16, 17, 20)), null, new Rect(RenderSize));
        if (!IsMap) { var gridPen = new Pen(new SolidColorBrush(Color.FromRgb(37, 40, 47)), 1); for (int i = 0; i < 3; i++) { double y = 40 + i * Math.Max(1, ActualHeight - 65) / 2; dc.DrawLine(gridPen, new Point(30, y), new Point(ActualWidth - 18, y)); } Text(dc, Label, new Point(12, 9), 14); if (Current() is { } current) Text(dc, Format(current), new Point(Math.Max(125, ActualWidth - 155), 7), 19, Brushes.White); }
        if (IsMap) dc.PushTransform(new TranslateTransform(pan.X - builtPan.X, pan.Y - builtPan.Y)); foreach (var trace in traces) dc.DrawGeometry(null, trace.Pen, trace.Shape); if (IsMap) dc.Pop();
        if (!IsMap) { double x = 30 + (CurrentAxis() - start) / Math.Max(.001, end - start) * Math.Max(1, ActualWidth - 48); dc.DrawLine(new Pen(Brushes.White, .8), new Point(x, 35), new Point(x, ActualHeight - 24)); Text(dc, comparing ? $"{start:0} m" : DurationText(start), new Point(30, ActualHeight - 19), 10); Text(dc, comparing ? $"{end:0} m" : DurationText(end), new Point(Math.Max(70, ActualWidth - 92), ActualHeight - 19), 10); }
        else if (Current() is { } sample) { foreach (int id in comparing ? groups.Keys : (IEnumerable<int>)[sample.LapId]) { var marker = comparing ? data?.AtDistance(id, sample.Distance) : sample; if (marker is null) continue; double radius = id == reference ? 4.5 : 3.5; dc.DrawEllipse(LapBrush(id), new Pen(Brushes.White, id == reference ? 2 : 1), Map(marker.Packet), radius, radius); } }
        if (hovered is { } nearest && (IsMap || hover?.Y >= 32)) { var p = Position(nearest); dc.DrawEllipse(LapBrush(nearest.LapId), new Pen(Brushes.White, 1.5), p, 4, 4); string info = $"V{nearest.Packet.Lap + 1} · {Format(nearest)}"; double x = Math.Clamp(p.X + 10, 8, Math.Max(8, ActualWidth - 190)), y = Math.Clamp(p.Y - 30, 34, Math.Max(34, ActualHeight - 48)); dc.DrawRoundedRectangle(new SolidColorBrush(Color.FromArgb(240, 30, 30, 36)), new Pen(LapBrush(nearest.LapId), 1), new Rect(x, y, 180, 25), 2, 2); Text(dc, info, new Point(x + 6, y + 5), 12, Brushes.White); }
    }
    void ZoomMapAt(Point mouse, double factor) { double next = Math.Clamp(zoom * factor, 1, 200), ratio = next / zoom; var center = new Point(ActualWidth / 2, ActualHeight / 2); pan = (Vector)(mouse - center) - ((Vector)(mouse - center) - pan) * ratio; zoom = next; Rebuild(); }
    void Wheel(object sender, MouseWheelEventArgs e) { if (data is null) return; if (IsMap) ZoomMapAt(e.GetPosition(this), e.Delta > 0 ? 1.3 : 1 / 1.3); else { var mouse = e.GetPosition(this); double width = Math.Clamp((end - start) / (e.Delta > 0 ? 1.3 : 1 / 1.3), .05, extent), fraction = Math.Clamp((mouse.X - 30) / Math.Max(1, ActualWidth - 48), 0, 1), anchor = start + (end - start) * fraction, a = Math.Clamp(anchor - width * fraction, 0, extent - width); SetRange(a, a + width); RangeChanged?.Invoke(start, end); } e.Handled = true; }
    void Down(object sender, MouseButtonEventArgs e) { if (!IsMap && e.GetPosition(this).Y < 32) { Expand?.Invoke(); e.Handled = true; return; } drag = e.GetPosition(this); dragged = false; CaptureMouse(); if (!IsMap) SeekAt(drag.Value); }
    void Move(object sender, MouseEventArgs e) { hover = e.GetPosition(this); hovered = Nearest(hover.Value); Cursor = !IsMap && hover.Value.Y < 32 ? Cursors.Hand : Cursors.Cross; if (drag is { } last && e.LeftButton == MouseButtonState.Pressed) { if (IsMap) { if ((hover.Value - last).Length > 1) dragged = true; pan += hover.Value - last; drag = hover; InvalidateVisual(); } else SeekAt(hover.Value); } else InvalidateVisual(); }
    void Up(object sender, MouseButtonEventArgs e) { if (IsMap && !dragged) SeekAt(e.GetPosition(this)); drag = null; ReleaseMouseCapture(); }
    void SeekAt(Point point) { if (Nearest(point) is { } nearest) Seek?.Invoke(nearest.Packet.T); }
}
