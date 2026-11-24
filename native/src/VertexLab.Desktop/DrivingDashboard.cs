using System.Diagnostics;
using System.Globalization;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using VertexLab.Core;
namespace VertexLab.Desktop;

// Mirrors public/app.js + style.css/racing.css. Numeric readouts always use the
// actual sample; only the presentation of a measured change is interpolated.
public sealed class DrivingDashboard : FrameworkElement
{
    public bool Large { get; set; }
    public bool AnimateReadings { get; set; } = true;
    TelemetryPacket? packet;
    int? gear;
    double shifted = -1, peak;
    bool blue;
    readonly VisualTween steer = new(.070), throttle = new(.070), brake = new(.070), gx = new(.070), gy = new(.070), gOpacity = new(.100);
    readonly VisualTween[] hue = Make(.150), slip = Make(.070), warning = Make(.100), hover = Make(.180);
    readonly VisualTween[] panelHover = Make(.180);
    readonly VisualTween[] leds = Enumerable.Range(0, 16).Select(_ => new VisualTween(.090)).ToArray();
    readonly Rect[] tireBounds = new Rect[4], panelBounds = new Rect[4];
    static VisualTween[] Make(double duration) => Enumerable.Range(0, 4).Select(_ => new VisualTween(duration)).ToArray();
    static double Now => Stopwatch.GetTimestamp() / (double)Stopwatch.Frequency;
    static readonly FontFamily Numbers = new(new Uri("pack://application:,,,/"), "./Assets/#Rajdhani"), Display = new(new Uri("pack://application:,,,/"), "./Assets/#Barlow Condensed");
    static readonly Brush White = B("#F4F1F3"), Muted = B("#A0A0AC"), Red = B("#FF4657"), Line = B("#2B2B32"), Panel = B("#101013");
    static readonly Geometry Wheel = G("M17 3.34a10 10 0 1 1 -15 8.66l.005 -.324a10 10 0 0 1 14.995 -8.336m-13 8.66a8 8 0 0 0 7 7.937v-5.107a3 3 0 0 1 -1.898 -2.05l-5.07 -1.504q -.031 .36 -.032 .725m15.967 -.725l-5.069 1.503a3 3 0 0 1 -1.897 2.051v5.108a8 8 0 0 0 6.985 -8.422zm-11.967 -6.204a8 8 0 0 0 -3.536 4.244l4.812 1.426a3 3 0 0 1 5.448 0l4.812 -1.426a8 8 0 0 0 -11.536 -4.244");
    static readonly Geometry Shoulder = G("M8 7v50M28 7v50"), Groove = G("M14 4v56M22 4v56"), Tread = G("m4 12 9-5m-9 17 9-5m-9 17 9-5m-9 17 9-5m10-36 9 5m-9 7 9 5m-9 7 9 5m-9 7 9 5"), Sipes = G("M16 12h4M16 22h4M16 32h4M16 42h4M16 52h4");
    static Geometry G(string value) { var g = Geometry.Parse(value); g.Freeze(); return g; }
    static Brush B(string value) { var b = new SolidColorBrush((Color)ColorConverter.ConvertFromString(value)); b.Freeze(); return b; }
    static Brush Mix(string a, string b, double fraction) => new SolidColorBrush(VisualTween.Blend((Color)ColorConverter.ConvertFromString(a), (Color)ColorConverter.ConvertFromString(b), fraction));
    public DrivingDashboard()
    {
        ClipToBounds = true;foreach(var tween in hover.Concat(panelHover))tween.Set(0,Now);
        Loaded += (_, _) => CompositionTarget.Rendering += Rendering; Unloaded += (_, _) => CompositionTarget.Rendering -= Rendering;
        MouseMove += (_, e) => SetHover(e.GetPosition(this));
        MouseLeave += (_, _) => SetHover(null);
    }
    void Rendering(object? sender, EventArgs e) => Animate();
    void SetHover(Point? point)
    {
        double now = Now;
        for (int i = 0; i < 4; i++) { hover[i].Set(point is { } p && tireBounds[i].Contains(p) ? 1 : 0, now); panelHover[i].Set(point is { } q && panelBounds[i].Contains(q) ? 1 : 0, now); }
        InvalidateVisual();
    }
    public void SetPacket(TelemetryPacket? value)
    {
        double now = Now;
        if (!AnimateReadings) shifted = -1;
        else if (value?.Gear is { } next && gear is { } old && next != old) shifted = now;
        gear = value?.Gear; packet = value; if (value is not null) peak = Math.Max(peak, value.Rpm);
        steer.Set((value?.Steer ?? 0) / 127d * 135, now);
        throttle.Set(Math.Clamp((value?.Throttle ?? 0) / 100, 0, 1), now); brake.Set(Math.Clamp((value?.Brake ?? 0) / 100, 0, 1), now);
        double x = (value?.AccelX ?? 0) / 9.80665, z = (value?.AccelZ ?? 0) / 9.80665, size = Math.Max(2, Math.Sqrt(x * x + z * z));
        gx.Set(x / size, now); gy.Set(-z / size, now); gOpacity.Set(value?.AccelX is not null && value.AccelZ is not null ? 1 : 0, now);
        for (int i = 0; i < 4; i++)
        {
            double temp = value?.TireTempsC.Length == 4 ? value.TireTempsC[i] : 40;
            hue[i].Set(Math.Clamp(210 - (temp - 40) / 100 * 210, 0, 210), now);
            double amount = value?.TireSlipCombined.Length == 4 ? Math.Abs(value.TireSlipCombined[i]) : 0;
            slip[i].Set(Math.Clamp(amount / 2, 0, 1), now); warning[i].Set(amount > 1 ? 1 : 0, now);
        }
        InvalidateVisual();
    }
    public void Reset()
    {
        peak = 0; gear = null; shifted = -1; blue = false; packet = null;
        foreach (var tween in AllTweens()) tween.Reset();foreach(var tween in hover.Concat(panelHover))tween.Set(0,Now); InvalidateVisual();
    }
    IEnumerable<VisualTween> AllTweens() => new[] { steer, throttle, brake, gx, gy, gOpacity }.Concat(hue).Concat(slip).Concat(warning).Concat(hover).Concat(panelHover).Concat(leds);
    public void Animate()
    {
        if (!IsVisible || !UiMotion.Enabled) return; double now = Now;
        if (AllTweens().Any(t => t.Active(now)) || (shifted >= 0 && now - shifted < .250) || blue) InvalidateVisual();
    }
    void Text(DrawingContext dc, string value, double x, double y, double size, Brush? brush = null, bool centered = false, bool heading = false)
    {
        var text = new FormattedText(value, CultureInfo.CurrentCulture, FlowDirection.LeftToRight, new Typeface(heading ? Display : Numbers, heading ? FontStyles.Italic : FontStyles.Normal, FontWeights.SemiBold, FontStretches.Normal), size, brush ?? White, VisualTreeHelper.GetDpi(this).PixelsPerDip);
        dc.DrawText(text, new Point(centered ? x - text.Width / 2 : x, y));
    }
    protected override void OnRender(DrawingContext dc)
    {
        double w = ActualWidth, h = ActualHeight; if (w <= 0 || h <= 0) return; double now = Now;
        dc.DrawRectangle(Large ? new RadialGradientBrush((Color)ColorConverter.ConvertFromString("#201116"), (Color)ColorConverter.ConvertFromString("#070708")) { Center = new Point(.5, .12), GradientOrigin = new Point(.5, .12) } : Panel, null, new Rect(0, 0, w, h));
        if (Large) { double pad = 24, top = Math.Max(220, h * .46); panelBounds[2] = new Rect(w * .16, pad, w * .68, Math.Max(180, top - pad)); double col = Math.Max(1, (w - pad * 4) / 3); panelBounds[0] = new Rect(pad, top + 16, col, Math.Max(1, h - top - 40)); panelBounds[1] = new Rect(pad * 2 + col, top + 16, col, Math.Max(1, h - top - 40)); panelBounds[3] = new Rect(pad * 3 + col * 2, top + 16, col, Math.Max(1, h - top - 40)); }
        else { double unit = w / 5.5; panelBounds[0] = new Rect(0, 0, unit, h); panelBounds[1] = new Rect(unit, 0, unit, h); panelBounds[2] = new Rect(unit * 2, 0, unit * 1.5, h); panelBounds[3] = new Rect(unit * 3.5, 0, unit * 2, h); }
        DrawPanel(dc, 0, "DIRECCIÓN", Steering, now); DrawPanel(dc, 1, "FUERZAS G", Forces, now); DrawPanel(dc, 2, "MOTOR", Motor, now); DrawPanel(dc, 3, "NEUMÁTICOS", Tires, now);
    }
    void DrawPanel(DrawingContext dc, int id, string title, Action<DrawingContext, double, double, double> content, double now)
    {
        var r = panelBounds[id]; double over = panelHover[id].Value(now);
        dc.PushClip(new RectangleGeometry(r)); dc.PushTransform(new TranslateTransform(r.X, r.Y));
        Brush background = id == 2 ? new LinearGradientBrush((Color)ColorConverter.ConvertFromString("#24171C"), (Color)ColorConverter.ConvertFromString("#0A0A0D"), 55) : Panel;
        dc.DrawRectangle(background, new Pen(id == 2 ? B("#66313E") : Mix("#2B2B32", "#68404E", over), 1), new Rect(0, 0, r.Width, r.Height));
        Text(dc, title, 12, 9, Large ? 14 : 11, Muted, heading: true);
        double header = Large ? 38 : 30;
        dc.PushTransform(new TranslateTransform(10, header)); content(dc, Math.Max(1, r.Width - 20), Math.Max(1, r.Height - header - 9), now); dc.Pop(); dc.Pop(); dc.Pop();
    }
    void Steering(DrawingContext dc, double w, double h, double now)
    {
        double size = Math.Min(Large ? 155 : 84, Math.Min(w - 10, Math.Max(40, h - 66))), cx = w / 2, cy = Math.Max(size / 2, (h - 63) / 2);
        double scale = size / 120; var center = new Point(cx, cy);
        dc.PushTransform(new TranslateTransform(cx - size / 2, cy - size / 2)); dc.PushTransform(new ScaleTransform(scale, scale));
        dc.DrawEllipse(null, new Pen(B("#3A2A32"), 1) { DashStyle = new DashStyle([2d, 4d], 0) }, new Point(60, 60), 55, 55);
        dc.DrawGeometry(null, new Pen(B("#8F3D4B"), 2), G("M60 1v7M1 60h7M112 60h7"));
        dc.PushTransform(new RotateTransform(steer.Value(now), 60, 60)); dc.PushTransform(new ScaleTransform(5, 5));
        dc.DrawGeometry(new LinearGradientBrush((Color)ColorConverter.ConvertFromString("#E1E4EB"), (Color)ColorConverter.ConvertFromString("#818895"), 45), null, Wheel); dc.Pop();
        dc.DrawLine(new Pen(Red, 5) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round }, new Point(55, 11), new Point(65, 11)); dc.DrawEllipse(B("#252832"), null, new Point(60, 60), 5, 5); dc.DrawEllipse(Red, null, new Point(60, 60), 2, 2); dc.Pop(); dc.Pop(); dc.Pop();
        string label = packet?.Steer is { } s ? Math.Abs(s) < 2 ? "Centrado · 0%" : $"{(s < 0 ? "Izq." : "Der.")} · {Math.Abs(s / 127d * 100):0}%" : "Sin datos";
        Text(dc, label, cx, h - 61, Large ? 18 : 14, B("#ECD7DF"), true);
        Pedal(dc, "ACEL", packet?.Throttle, throttle.Value(now), w, h - 33, B("#DEDEE6")); Pedal(dc, "FRENO", packet?.Brake, brake.Value(now), w, h - 11, Red);
    }
    void Pedal(DrawingContext dc, string label, double? actual, double visual, double w, double y, Brush color)
    {
        Text(dc, label, 0, y - 7, Large ? 13 : 10, Muted); double left = Large ? 46 : 35, right = Large ? 44 : 34, width = Math.Max(1, w - left - right);
        dc.DrawRoundedRectangle(B("#2B292F"), null, new Rect(left, y, width, 4), 2, 2); dc.DrawRoundedRectangle(color, null, new Rect(left, y, width * visual, 4), 2, 2);
        Text(dc, actual is { } v ? $"{v:0}%" : "—", w - right + 6, y - 9, Large ? 16 : 12);
    }
    void Forces(DrawingContext dc, double w, double h, double now)
    {
        double size = Math.Min(Large ? 170 : 92, Math.Min(w - 8, Math.Max(40, h - 65))), radius = size * 55 / 140, cx = w / 2, cy = Math.Max(size / 2, (h - 65) / 2);
        var center = new Point(cx, cy); foreach (double r in new[] { radius, radius / 2 }) dc.DrawEllipse(null, new Pen(B("#3C353F"), 1), center, r, r);
        dc.DrawLine(new Pen(B("#302A33"), 1), new Point(cx - radius, cy), new Point(cx + radius, cy)); dc.DrawLine(new Pen(B("#302A33"), 1), new Point(cx, cy - radius), new Point(cx, cy + radius));
        Text(dc, "2G", cx + 5, cy - radius, Large ? 11 : 8, B("#8D788C")); Text(dc, "1G", cx + 5, cy - radius / 2, Large ? 11 : 8, B("#8D788C"));
        dc.PushOpacity(gOpacity.Value(now)); var point = new Point(cx + gx.Value(now) * radius, cy + gy.Value(now) * radius); Glow(dc, point, 10, (Color)ColorConverter.ConvertFromString("#FF4657"), .35); dc.DrawEllipse(Red, null, point, Large ? 5 : 3.5, Large ? 5 : 3.5); dc.Pop();
        bool valid = packet?.AccelX is not null && packet.AccelZ is not null; double x = (packet?.AccelX ?? 0) / 9.80665, z = (packet?.AccelZ ?? 0) / 9.80665;
        Text(dc, valid ? $"{Math.Sqrt(x * x + z * z):0.00} G" : "Sin datos", cx, h - 62, Large ? 27 : 19, B("#F0B0B9"), true);
        Text(dc, "Lateral", w * .25, h - 36, Large ? 13 : 10, Muted, true); Text(dc, "Longitudinal", w * .75, h - 36, Large ? 13 : 10, Muted, true);
        Text(dc, valid ? $"{x:0.00} G" : "—", w * .25, h - 20, Large ? 18 : 13, B("#DED9E4"), true); Text(dc, valid ? $"{z:0.00} G" : "—", w * .75, h - 20, Large ? 18 : 13, B("#DED9E4"), true);
    }
    void Motor(DrawingContext dc, double w, double h, double now)
    {
        double max = packet?.EngineMaxRpm > 0 ? packet.EngineMaxRpm : peak, ratio = max > 0 ? (packet?.Rpm ?? 0) / max : 0;
        double elapsed = shifted < 0 || !UiMotion.Enabled ? 1 : Math.Clamp((now - shifted) / .220, 0, 1), shown = ratio * (1 - Math.Pow(1 - elapsed, 3));
        // Keep the web's 88% entry, 86% release and edges-to-center progression.
        blue = packet?.Gear > 0 && packet.Speed > 15 && shown >= (blue ? .86 : .88);
        double gap = 3, ledWidth = Math.Max(1, (w - gap * 15) / 16), ledHeight = Large ? 12 : 7;
        for (int i = 0; i < 16; i++)
        {
            int rank = Math.Min(i, 15 - i); double level = Math.Clamp(shown / .8 * 8 - rank, 0, 1); leds[i].Set(level, now); double strength = leds[i].Value(now);
            Color color = (Color)ColorConverter.ConvertFromString(rank < 4 ? "#59E2BA" : rank < 6 ? "#FFC66E" : "#F77D94");
            if (blue) { strength = !UiMotion.Enabled || ((int)(now * 8) % 2 == 0) ? 1 : .2; color = (Color)ColorConverter.ConvertFromString("#409FFF"); }
            var rect = new Rect(i * (ledWidth + gap), 3, ledWidth, ledHeight); if (strength > .03) Glow(dc, new Point(rect.X + rect.Width / 2, rect.Y + rect.Height / 2), Math.Max(8, ledWidth), color, strength * .23);
            dc.PushOpacity(.16 + .84 * strength); dc.DrawRoundedRectangle(new SolidColorBrush(color), null, rect, 2, 2); dc.Pop();
        }
        double block = Math.Min(w, Large ? 480 : 235), left = (w - block) / 2, bodyTop = Large ? Math.Max(28, h * .15) : 24;
        double gearSize = Large ? 132 : 64, rpmSize = Large ? 44 : 26, speedSize = Large ? 58 : 36, rpmLeft = left + block * .53;
        Text(dc, packet?.Gear is { } g ? (g == 0 ? "R" : g.ToString()) : "—", left + block * .24, bodyTop, gearSize, B("#F2FFF9"), true);
        Text(dc, "MARCHA", left + block * .24, bodyTop + gearSize * .97, Large ? 15 : 10, Muted, true);
        Text(dc, packet is { } p ? $"{p.Rpm:N0}" : "—", rpmLeft, bodyTop + 6, rpmSize, B("#B4F1DB")); Text(dc, "RPM", rpmLeft, bodyTop + rpmSize + 8, Large ? 14 : 10, Muted);
        double speedTop = bodyTop + rpmSize + (Large ? 33 : 26); string speed = packet is { } q ? $"{q.Speed:0}" : "—";
        Text(dc, speed, rpmLeft, speedTop, speedSize, White); double unitX = Math.Min(w - 30, rpmLeft + speed.Length * speedSize * .48 + 6); Text(dc, "km/h", unitX, speedTop + speedSize * .45, Large ? 18 : 12, Muted);
        dc.DrawRectangle(B("#2B292F"), null, new Rect(0, h - 19, w, 4)); dc.DrawRectangle(new LinearGradientBrush((Color)ColorConverter.ConvertFromString("#B4F1DB"), (Color)ColorConverter.ConvertFromString("#F77D94"), 0), null, new Rect(0, h - 19, w * Math.Clamp(ratio, 0, 1), 4));
        Text(dc, max > 0 ? $"{(packet?.EngineMaxRpm > 0 ? "Máximo del motor" : "Pico medido")} · {max:N0} RPM" : "Esperando datos del motor", 0, h - 11, Large ? 13 : 9, B("#7F8C88"));
    }
    void Tires(DrawingContext dc, double w, double h, double now)
    {
        double gap = 6, tileWidth = Math.Max(1, (w - gap) / 2), tileHeight = Math.Max(1, (h - 22 - gap) / 2); string[] names = ["DI", "DD", "TI", "TD"];
        for (int i = 0; i < 4; i++)
        {
            double x = i % 2 * (tileWidth + gap), y = i / 2 * (tileHeight + gap), over = hover[i].Value(now), warn = warning[i].Value(now); y -= over * 1.5;
            tireBounds[i] = new Rect(panelBounds[3].X + 10 + x, panelBounds[3].Y + (Large ? 38 : 30) + y, tileWidth, tileHeight);
            Brush border = Mix("#33333C", "#B54F3F", warn); if (over > 0) border = Mix(warn > .5 ? "#B54F3F" : "#33333C", "#F28DA0", over);
            dc.DrawRoundedRectangle(Mix("#151519", "#281816", warn), new Pen(border, 1), new Rect(x, y, tileWidth, tileHeight), 3, 3);
            bool hasTemp = packet?.TireTempsC.Length == 4, hasSlip = packet?.TireSlipCombined.Length == 4; Color color = hasTemp ? VisualTween.TemperatureColorFromHue(hue[i].Value(now)) : (Color)ColorConverter.ConvertFromString("#526174"); var tempBrush = new SolidColorBrush(color);
            double tyreHeight = Math.Min(Large ? 76 : 52, Math.Max(28, tileHeight - 11)), tyreScale = tyreHeight / 64, tyreWidth = 36 * tyreScale, tyreX = x + 7, tyreY = y + (tileHeight - tyreHeight) / 2 - 2;
            if (warn > .01) Glow(dc, new Point(tyreX + tyreWidth / 2, tyreY + tyreHeight / 2), tyreHeight * .55, (Color)ColorConverter.ConvertFromString("#FF976F"), warn * .18);
            dc.PushTransform(new TranslateTransform(tyreX, tyreY)); dc.PushTransform(new ScaleTransform(tyreScale, tyreScale));
            dc.DrawRoundedRectangle(B("#09090C"), new Pen(tempBrush, 1.5), new Rect(3, 2, 30, 60), 9, 9); dc.DrawGeometry(null, new Pen(B("#5A5A64"), 1.2), Shoulder); dc.DrawGeometry(null, new Pen(B("#41414C"), 1.5), Groove); dc.PushOpacity(.85); dc.DrawGeometry(null, new Pen(tempBrush, 1.4), Tread); dc.Pop(); dc.DrawGeometry(null, new Pen(B("#62626D"), 1.2), Sipes); dc.Pop(); dc.Pop();
            double textX = tyreX + tyreWidth + 7;
            Text(dc, names[i], textX, y + 3, Large ? 13 : 11, B("#AAA2AE")); Text(dc, hasTemp ? $"{packet!.TireTempsC[i]:0}°C" : "—", textX, y + tileHeight * .23, Large ? 32 : 24, tempBrush);
            double actualSlip = hasSlip ? Math.Abs(packet!.TireSlipCombined[i]) : 0;
            Text(dc, hasSlip ? $"Slip {actualSlip:0.00}" : "Sin datos", textX, y + tileHeight - 25, Large ? 16 : 13, Mix("#E0CED8", "#FF9B78", warn));
            double barWidth = Math.Max(1, tileWidth - 10), barY = y + tileHeight - 7; dc.DrawRectangle(B("#302B32"), null, new Rect(x + 5, barY, barWidth, 4)); dc.DrawRectangle(Mix("#C2BEC9", "#FF9D70", warn), null, new Rect(x + 5, barY, barWidth * slip[i].Value(now), 4)); dc.DrawLine(new Pen(B("#EAF8FF"), 1), new Point(x + 5 + barWidth / 2, barY), new Point(x + 5 + barWidth / 2, barY + 4));
        }
        dc.DrawEllipse(B("#FF9D70"), null, new Point(3, h - 6), 2, 2); Text(dc, "Slip > 1: exceso de deslizamiento", 10, h - 13, Large ? 13 : 10, B("#948C98"));
    }
    static void Glow(DrawingContext dc, Point center, double radius, Color color, double strength)
    {
        var brush = new RadialGradientBrush(Color.FromArgb((byte)(Math.Clamp(strength, 0, 1) * 255), color.R, color.G, color.B), Color.FromArgb(0, color.R, color.G, color.B)); dc.DrawEllipse(brush, null, center, radius, radius);
    }
}
