using System.Globalization;
using System.Windows;
using System.Windows.Media;
using VertexLab.Core;
namespace VertexLab.Desktop;

// Native retained drawing; no DOM, bitmap gauge or invented sensor values.
public sealed class DrivingDashboard : FrameworkElement
{
    public bool Large { get; set; }
    public bool AnimateReadings { get; set; } = true;
    TelemetryPacket? packet; int? gear; double shifted = -1, peak; bool blue;
    static double Now => System.Diagnostics.Stopwatch.GetTimestamp() / (double)System.Diagnostics.Stopwatch.Frequency;
    public void SetPacket(TelemetryPacket? value)
    {
        if (!AnimateReadings) shifted = -1; else if (value?.Gear is { } next && gear is { } old && next != old) shifted = Now;
        gear = value?.Gear; packet = value; if (value is not null) peak = Math.Max(peak, value.Rpm); InvalidateVisual();
    }
    public void Reset() { peak = 0; gear = null; shifted = -1; blue = false; packet = null; InvalidateVisual(); }
    public void Animate() { if (packet is not null) InvalidateVisual(); }
    static Brush B(string color) { var b = new SolidColorBrush((Color)ColorConverter.ConvertFromString(color)); b.Freeze(); return b; }
    static readonly Brush White = B("#F4F5F7"), Muted = B("#97A2B2"), Red = B("#FF3954"), Line = B("#292A30"), Panel = B("#101114"), Cyan = B("#73BEFF");
    void Text(DrawingContext dc, string text, double x, double y, double size, Brush? brush = null, bool bold = false)
    { dc.DrawText(new FormattedText(text, CultureInfo.CurrentCulture, FlowDirection.LeftToRight, new Typeface(new FontFamily(new Uri("pack://application:,,,/"), "./Assets/#Rajdhani"), FontStyles.Normal, bold ? FontWeights.Bold : FontWeights.Normal, FontStretches.Condensed), size, brush ?? White, VisualTreeHelper.GetDpi(this).PixelsPerDip), new Point(x, y)); }
    protected override void OnRender(DrawingContext dc)
    {
        double w = ActualWidth, h = ActualHeight; if (w < 1 || h < 1) return;
        dc.DrawRectangle(Panel, null, new Rect(0, 0, w, h));
        if (Large) { double pad = 28, top = Math.Max(210, h * .47); Section(dc, new Rect(w * .23, pad, w * .54, top - pad), "MOTOR", Motor); double col = (w - pad * 4) / 3; Section(dc, new Rect(pad, top + 18, col, h - top - 42), "DIRECCIÓN", Steering); Section(dc, new Rect(pad * 2 + col, top + 18, col, h - top - 42), "FUERZAS G", Forces); Section(dc, new Rect(pad * 3 + col * 2, top + 18, col, h - top - 42), "NEUMÁTICOS", Tires); }
        else { double a = w * .18, b = w * .17, c = w * .30; Section(dc, new Rect(0, 0, a, h), "DIRECCIÓN", Steering); Section(dc, new Rect(a, 0, b, h), "FUERZAS G", Forces); Section(dc, new Rect(a + b, 0, c, h), "MOTOR", Motor); Section(dc, new Rect(a + b + c, 0, w - a - b - c, h), "NEUMÁTICOS", Tires); }
    }
    void Section(DrawingContext dc, Rect r, string title, Action<DrawingContext> draw)
    {
        dc.PushClip(new RectangleGeometry(r)); dc.DrawRectangle(null, new Pen(Line, 1), r); dc.PushTransform(new TranslateTransform(r.X, r.Y));
        Text(dc, title, 12, 8, Large ? 16 : 12, Muted, true); double scale = Math.Min(Math.Max(1, r.Width - 20) / 240, Math.Max(1, r.Height - 42) / 200); dc.PushTransform(new TranslateTransform((r.Width - 240 * scale) / 2, 32 + Math.Max(0, (r.Height - 42 - 200 * scale) / 2))); dc.PushTransform(new ScaleTransform(scale, scale)); draw(dc); dc.Pop(); dc.Pop(); dc.Pop(); dc.Pop();
    }
    void Steering(DrawingContext dc)
    {
        double angle = (packet?.Steer ?? 0) / 127d * 135; dc.PushTransform(new RotateTransform(angle, 120, 65));
        dc.DrawEllipse(null, new Pen(B("#A9B2C0"), 10), new Point(120, 65), 48, 48);
        dc.DrawLine(new Pen(Red, 7), new Point(112, 17), new Point(128, 17));
        foreach (var p in new[] { new Point(76, 54), new Point(164, 54), new Point(120, 109) }) dc.DrawLine(new Pen(B("#8793A4"), 10), new Point(120, 65), p);
        dc.DrawEllipse(B("#272C35"), new Pen(B("#BEC7D3"), 2), new Point(120, 65), 15, 15); dc.DrawEllipse(Red, null, new Point(120, 65), 4, 4); dc.Pop();
        Text(dc, packet?.Steer is { } s ? $"{s / 127d * 100:+0;-0;0}%" : "SIN DATOS", 83, 123, 20);
        Pedal(dc, "ACEL", packet?.Throttle, 160, Cyan); Pedal(dc, "FRENO", packet?.Brake, 184, Red);
    }
    void Pedal(DrawingContext dc, string label, double? value, double y, Brush color)
    { Text(dc, label, 0, y - 4, 11, Muted); dc.DrawRectangle(Line, null, new Rect(47, y, 145, 6)); dc.DrawRectangle(color, null, new Rect(47, y, 145 * Math.Clamp((value ?? 0) / 100, 0, 1), 6)); Text(dc, value is { } v ? $"{v:0}%" : "—", 200, y - 6, 14); }
    void Forces(DrawingContext dc)
    {
        var center = new Point(120, 73); foreach (double radius in new[] { 23d, 46d, 68d }) dc.DrawEllipse(null, new Pen(Line, 1), center, radius, radius);
        dc.DrawLine(new Pen(Line, 1), new Point(47, 73), new Point(193, 73)); dc.DrawLine(new Pen(Line, 1), new Point(120, 0), new Point(120, 146));
        if (packet?.AccelX is { } ax && packet.AccelZ is { } az) { double x = ax / 9.80665, z = az / 9.80665; var point = new Point(120 + Math.Clamp(x / 2, -1, 1) * 68, 73 + Math.Clamp(z / 2, -1, 1) * 68); dc.DrawLine(new Pen(Red, 2), center, point); dc.DrawEllipse(Red, null, point, 5, 5); Text(dc, $"{Math.Sqrt(x * x + z * z):0.00} G", 70, 148, 26); Text(dc, $"LAT {x:+0.00;-0.00;0.00}    LONG {z:+0.00;-0.00;0.00}", 15, 183, 13, Muted); } else Text(dc, "SIN DATOS", 65, 158, 18, Muted);
    }
    void Motor(DrawingContext dc)
    {
        double max = packet?.EngineMaxRpm > 0 ? packet.EngineMaxRpm : peak;
        double ratio = max > 0 ? (packet?.Rpm ?? 0) / max : 0; blue = packet?.Gear > 0 && packet.Speed > 15 && ratio >= (blue ? .86 : .88);
        double elapsed = shifted < 0 ? 1 : Math.Clamp((Now - shifted) / .220, 0, 1); double shown = ratio * (1 - Math.Pow(1 - elapsed, 3));
        for (int i = 0; i < 16; i++) { int rank = Math.Min(i, 15 - i); double level = Math.Clamp(shown / .8 * 8 - rank, 0, 1); Brush lit = rank < 4 ? B("#55E1B8") : rank < 6 ? B("#FFD276") : B("#FF718B"); if (blue && elapsed >= 1) { level = (int)(Now * 8) % 2 == 0 ? 1 : .28; lit = B("#409FFF"); } dc.PushOpacity(.12 + .88 * level); dc.DrawRoundedRectangle(lit, null, new Rect(i * 15, 6, 12, 7), 2, 2); dc.Pop(); }
        Text(dc, packet?.Gear is { } g ? (g == 0 ? "R" : g.ToString()) : "—", 24, 35, 82, White, true); Text(dc, "MARCHA", 31, 122, 11, Muted);
        Text(dc, packet is { } p ? $"{p.Rpm:N0}" : "—", 112, 45, 31); Text(dc, "RPM", 115, 80, 12, Muted);
        Text(dc, packet is { } q ? $"{q.Speed:0}" : "—", 112, 105, 42, White, true); Text(dc, "km/h", 181, 125, 16, Muted);
        dc.DrawRectangle(Line, null, new Rect(5, 175, 230, 4)); dc.DrawRectangle(blue ? Cyan : Red, null, new Rect(5, 175, 230 * Math.Clamp(shown, 0, 1), 4));
        Text(dc, max > 0 ? $"{(packet?.EngineMaxRpm > 0 ? "MÁXIMO" : "PICO OBSERVADO")} · {max:N0} RPM" : "SIN DATOS", 5, 187, 11, Muted);
    }
    void Tires(DrawingContext dc)
    {
        string[] labels = ["DI", "DD", "TI", "TD"];
        for (int i = 0; i < 4; i++)
        {
            double x = i % 2 * 122, y = i / 2 * 98; dc.DrawRectangle(B("#161A20"), new Pen(Line, 1), new Rect(x, y, 115, 91));
            dc.DrawRoundedRectangle(null, new Pen(Cyan, 1.5), new Rect(x + 6, y + 9, 23, 47), 6, 6); dc.DrawLine(new Pen(Cyan, .8), new Point(x + 17, y + 10), new Point(x + 17, y + 55));
            for (int j = 0; j < 5; j++) { double yy = y + 13 + j * 8; dc.DrawLine(new Pen(Cyan, .8), new Point(x + 7, yy), new Point(x + 16, yy + 5)); dc.DrawLine(new Pen(Cyan, .8), new Point(x + 18, yy + 5), new Point(x + 28, yy)); }
            Text(dc, labels[i], x + 36, y + 5, 12, Muted); Text(dc, packet?.TireTempsC.Length == 4 ? $"{packet.TireTempsC[i]:0}°C" : "—", x + 35, y + 24, 24, Cyan);
            double? slip = packet?.TireSlipCombined.Length == 4 ? Math.Abs(packet.TireSlipCombined[i]) : null; Text(dc, slip is { } s ? $"SLIP {s:0.00}" : "SLIP —", x + 5, y + 61, 15, slip > 1 ? Red : White);
            dc.DrawRectangle(Line, null, new Rect(x + 5, y + 81, 105, 3)); dc.DrawRectangle(slip > 1 ? Red : Cyan, null, new Rect(x + 5, y + 81, 105 * Math.Clamp((slip ?? 0) / 2, 0, 1), 3));
        }
    }
}
