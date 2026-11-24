using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
namespace VertexLab.Desktop;

internal static class UiMotion
{
    public static readonly DependencyProperty ScrollOffsetProperty = DependencyProperty.RegisterAttached("ScrollOffset", typeof(double), typeof(UiMotion), new PropertyMetadata(0d, (d, e) => { if (d is ScrollViewer viewer) viewer.ScrollToVerticalOffset((double)e.NewValue); }));
    public static void ScrollTo(ScrollViewer viewer, double offset)
    {
        if (!Enabled) { viewer.ScrollToVerticalOffset(offset); return; }
        double from = viewer.VerticalOffset; viewer.BeginAnimation(ScrollOffsetProperty, null); viewer.SetValue(ScrollOffsetProperty, from);
        viewer.BeginAnimation(ScrollOffsetProperty, new DoubleAnimation(from, offset, TimeSpan.FromMilliseconds(180)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } });
    }
    public static bool Enabled => SystemParameters.ClientAreaAnimation;
    public static void Enter(UIElement element, double offset = 7, double milliseconds = 200)
    {
        if (!Enabled) return;
        element.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(.15, 1, TimeSpan.FromMilliseconds(milliseconds)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } });
        var move = new TranslateTransform(0, offset); element.RenderTransform = move;
        move.BeginAnimation(TranslateTransform.YProperty, new DoubleAnimation(offset, 0, TimeSpan.FromMilliseconds(milliseconds)) { EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut } });
    }
    public static void Fade(UIElement element, double target, double milliseconds, Action? completed = null)
    {
        if (!Enabled) { element.Opacity = target; completed?.Invoke(); return; }
        var animation = new DoubleAnimation(target, TimeSpan.FromMilliseconds(milliseconds)); animation.Completed += (_, _) => completed?.Invoke(); element.BeginAnimation(UIElement.OpacityProperty, animation);
    }
}
