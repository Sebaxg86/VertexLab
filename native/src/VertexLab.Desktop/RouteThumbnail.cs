using System.Collections.Concurrent;
using System.Windows;
using System.Windows.Media;
using VertexLab.Core;
namespace VertexLab.Desktop;
// Session-list thumbnails stream only the first two laps and never open the video.
public sealed class RouteThumbnail : FrameworkElement
{
    public static readonly DependencyProperty FileProperty = DependencyProperty.Register(nameof(File), typeof(string), typeof(RouteThumbnail), new PropertyMetadata(null, Changed));
    public string? File { get => (string?)GetValue(FileProperty); set => SetValue(FileProperty, value); }
    static readonly ConcurrentDictionary<string, Point[]> cache = new(); Point[] points = []; int request;
    static async void Changed(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var view = (RouteThumbnail)d; int version = ++view.request; if (e.NewValue is not string file) return;
        try { var result = await Task.Run(() => cache.GetOrAdd(file, Read)); if (version == view.request) { view.points = result; view.InvalidateVisual(); } } catch { view.points = []; view.InvalidateVisual(); }
    }
    static Point[] Read(string file)
    {
        var first = new List<Point>(); var second = new List<Point>(); int? initial = null, other = null; int i = 0;
        foreach (var p in Analysis.ReadRows(file)) { initial ??= p.Lap; if (p.Lap != initial) { other ??= p.Lap; if (p.Lap != other) break; } if (i++ % 8 != 0) continue; (other is null ? first : second).Add(new Point(p.X, p.Z)); }
        return (second.Count > 1 ? second : first).ToArray();
    }
    protected override void OnRender(DrawingContext dc)
    {
        if (points.Length < 2) return; double minX = points.Min(p => p.X), maxX = points.Max(p => p.X), minY = points.Min(p => p.Y), maxY = points.Max(p => p.Y), scale = Math.Min((ActualWidth - 8) / Math.Max(1, maxX - minX), (ActualHeight - 8) / Math.Max(1, maxY - minY));
        var geometry = new StreamGeometry(); using (var ctx = geometry.Open()) { bool start = true; foreach (var p in points) { var q = new Point(ActualWidth / 2 + (p.X - (minX + maxX) / 2) * scale, ActualHeight / 2 - (p.Y - (minY + maxY) / 2) * scale); if (start) { ctx.BeginFigure(q, false, false); start = false; } else ctx.LineTo(q, true, false); } }
        geometry.Freeze(); dc.DrawGeometry(null, new Pen(new SolidColorBrush(Color.FromRgb(219, 120, 145)), 1.4), geometry);
    }
}
