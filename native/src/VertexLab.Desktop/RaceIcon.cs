using System.Windows;
using System.Windows.Media;
namespace VertexLab.Desktop;

public sealed class RaceIcon : FrameworkElement
{
    public string Kind { get; set; } = "play";
    public Brush Ink { get; set; } = Brushes.White;
    public RaceIcon() { Width = 20; Height = 20; IsHitTestVisible = false; }
    protected override void OnRender(DrawingContext dc)
    {
        dc.PushTransform(new ScaleTransform(ActualWidth / 24, ActualHeight / 24));
        var pen = new Pen(Ink, 1.8) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round, LineJoin = PenLineJoin.Round };
        string path = Kind switch
        {
            "play" => "M7 4L20 12L7 20Z",
            "pause" => "M7 4V20M17 4V20",
            "back" => "M11 5L3 12L11 19ZM21 5L13 12L21 19Z",
            "forward" => "M3 5L11 12L3 19ZM13 5L21 12L13 19Z",
            "volume" => "M4 9H8L13 5V19L8 15H4ZM17 8Q21 12 17 16M20 5Q27 12 20 19",
            "muted" => "M4 9H8L13 5V19L8 15H4ZM17 9L23 15M23 9L17 15",
            "chevron" => "M9 5L16 12L9 19",
            "fit" => "M8 3H3V8M16 3H21V8M3 16V21H8M21 16V21H16M8 12H16M12 8V16",
            "stop" => "M5 5H19V19H5Z",
            _ => "M12 8A4 4 0 1 0 12 16A4 4 0 1 0 12 8M9 3H15L16 6L19 5L22 10L20 12L22 14L19 19L16 18L15 21H9L8 18L5 19L2 14L4 12L2 10L5 5L8 6Z"
        };
        dc.DrawGeometry(Kind is "play" or "stop" ? Ink : null, pen, Geometry.Parse(path)); dc.Pop();
    }
}
public sealed class LoadingWheel : FrameworkElement
{
    public LoadingWheel() { Width = 136; Height = 136; IsHitTestVisible = false; }
    protected override void OnRender(DrawingContext dc)
    {
        dc.PushTransform(new ScaleTransform(ActualWidth / 136, ActualHeight / 136)); var center = new Point(68, 68);
        dc.DrawEllipse(null, new Pen(new SolidColorBrush(Color.FromRgb(73, 48, 58)), 3), center, 51, 51);
        dc.DrawEllipse(null, new Pen(new SolidColorBrush(Color.FromRgb(255, 75, 99)), 4) { DashStyle = new DashStyle([27.5, 52.75], 0), StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round }, center, 51, 51);
        dc.DrawEllipse(null, new Pen(new SolidColorBrush(Color.FromArgb(166, 198, 164, 180)), 3) { DashStyle = new DashStyle([11.67, 15], 0) }, center, 34, 34);
        var pen = new Pen(new SolidColorBrush(Color.FromRgb(240, 220, 230)), 6) { StartLineCap = PenLineCap.Round, EndLineCap = PenLineCap.Round };
        dc.DrawLine(pen, new Point(68, 68), new Point(68, 42)); dc.DrawLine(pen, new Point(68, 68), new Point(44, 82)); dc.DrawLine(pen, new Point(68, 68), new Point(92, 82));
        dc.DrawEllipse(new SolidColorBrush(Color.FromRgb(42, 17, 27)), new Pen(new SolidColorBrush(Color.FromRgb(255, 99, 120)), 3), center, 10, 10); dc.Pop();
    }
}
