using System.Windows.Media;
namespace VertexLab.Desktop;
// CSS-like retargetable interpolation. The underlying sample is never smoothed.
internal sealed class VisualTween(double duration)
{
    double from, target, started; bool initialized;
    public void Set(double value, double now)
    {
        if (!initialized) { from = target = value; initialized = true; return; }
        if (Math.Abs(value - target) < .00001) return;
        from = Value(now); target = value; started = now;
    }
    public double Value(double now) => !UiMotion.Enabled ? target : from + (target - from) * Math.Clamp((now - started) / duration, 0, 1);
    public bool Active(double now) => initialized && Math.Abs(from - target) > .00001 && now - started < duration;
    public void Reset() { from = target = started = 0; initialized = false; }
    public static Color Blend(Color a, Color b, double t) { t = Math.Clamp(t, 0, 1); return Color.FromArgb((byte)(a.A + (b.A - a.A) * t), (byte)(a.R + (b.R - a.R) * t), (byte)(a.G + (b.G - a.G) * t), (byte)(a.B + (b.B - a.B) * t)); }
    // Same HSL(210 - (temp - 40) / 100 * 210, 75%, 65%) used by app.js.
    public static Color TemperatureColorFromHue(double hue)
    {
        double h = Math.Clamp(hue, 0, 210) / 60, c = (1 - Math.Abs(2 * .65 - 1)) * .75, x = c * (1 - Math.Abs(h % 2 - 1)), m = .65 - c / 2;
        (double r, double g, double b) = h switch { < 1 => (c, x, 0d), < 2 => (x, c, 0d), < 3 => (0d, c, x), < 4 => (0d, x, c), < 5 => (x, 0d, c), _ => (c, 0d, x) };
        return Color.FromRgb((byte)Math.Round((r + m) * 255), (byte)Math.Round((g + m) * 255), (byte)Math.Round((b + m) * 255));
    }
}
