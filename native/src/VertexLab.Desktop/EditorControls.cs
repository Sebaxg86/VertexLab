using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Automation;
using System.Windows.Automation.Peers;
using System.Windows.Automation.Provider;
using System.Windows.Input;
using System.Windows.Media;
using VertexLab.Core;
namespace VertexLab.Desktop;

/// <summary>A single colored track. Pointer capture starts anywhere on it, not only on the playhead.</summary>
public sealed class SessionTimeline : FrameworkElement
{
    public static readonly DependencyProperty MinimumProperty = DependencyProperty.Register(nameof(Minimum), typeof(double), typeof(SessionTimeline), new FrameworkPropertyMetadata(0d, FrameworkPropertyMetadataOptions.AffectsRender));
    public static readonly DependencyProperty MaximumProperty = DependencyProperty.Register(nameof(Maximum), typeof(double), typeof(SessionTimeline), new FrameworkPropertyMetadata(1d, FrameworkPropertyMetadataOptions.AffectsRender));
    public static readonly DependencyProperty ValueProperty = DependencyProperty.Register(nameof(Value), typeof(double), typeof(SessionTimeline), new FrameworkPropertyMetadata(0d, FrameworkPropertyMetadataOptions.AffectsRender, (d, e) => { var c = (SessionTimeline)d; c.ValueChanged?.Invoke(c, new((double)e.OldValue, (double)e.NewValue)); }));
    public double Minimum { get => (double)GetValue(MinimumProperty); set => SetValue(MinimumProperty, value); }
    public double Maximum { get => (double)GetValue(MaximumProperty); set => SetValue(MaximumProperty, value); }
    public double Value { get => (double)GetValue(ValueProperty); set => SetValue(ValueProperty, Math.Clamp(value, Minimum, Math.Max(Minimum, Maximum))); }
    public event RoutedPropertyChangedEventHandler<double>? ValueChanged;
    IReadOnlyList<LapInfo> laps = []; int? hovered;
    static readonly Brush Pink = new SolidColorBrush(Color.FromRgb(230, 71, 95)), Track = new SolidColorBrush(Color.FromRgb(52, 48, 57));
    public SessionTimeline() { Height = 26; Focusable = true; Cursor = Cursors.Hand; ToolTipService.SetInitialShowDelay(this, 0); AutomationProperties.SetName(this, "Reproducción de la sesión"); }
    public void SetSegments(IEnumerable<LapInfo> value) { laps = value.ToArray(); hovered = null; ToolTip = null; InvalidateVisual(); }
    double Fraction(double value) => Math.Clamp((value - Minimum) / Math.Max(.001, Maximum - Minimum), 0, 1);
    double At(Point point) => Minimum + Math.Clamp((point.X - 6) / Math.Max(1, ActualWidth - 12), 0, 1) * (Maximum - Minimum);
    protected override void OnRender(DrawingContext dc)
    {
        double width = Math.Max(1, ActualWidth - 12), y = ActualHeight / 2; dc.DrawRectangle(Brushes.Transparent, null, new Rect(RenderSize)); dc.DrawRoundedRectangle(Track, null, new Rect(6, y - 3, width, 6), 2, 2);
        foreach (var lap in laps)
        {
            double left = Fraction(lap.Start), right = Fraction(lap.End); if (right <= left) continue; double height = hovered == lap.Id ? 9 : 6;
            dc.DrawRectangle(SeriesView.LapBrush(lap.Id), null, new Rect(6 + left * width, y - height / 2, Math.Max(1, (right - left) * width), height)); dc.DrawLine(new Pen(new SolidColorBrush(Color.FromArgb(160, 10, 7, 11)), 1), new Point(6 + left * width, y - 3), new Point(6 + left * width, y + 3));
        }
        double x = 6 + Fraction(Value) * width; dc.DrawLine(new Pen(Brushes.White, 1), new Point(x, y - 9), new Point(x, y + 9)); dc.DrawRoundedRectangle(Pink, new Pen(Brushes.White, 1.5), new Rect(x - 4, y - 7, 8, 14), 2, 2);
    }
    protected override void OnMouseLeftButtonDown(MouseButtonEventArgs e) { base.OnMouseLeftButtonDown(e); Focus(); CaptureMouse(); Value = At(e.GetPosition(this)); e.Handled = true; }
    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e); double target = At(e.GetPosition(this)); if (IsMouseCaptured && e.LeftButton == MouseButtonState.Pressed) Value = target;
        var lap = laps.FirstOrDefault(l => target >= l.Start && target <= l.End); if (lap?.Id != hovered) { hovered = lap?.Id; ToolTip = lap is null ? null : $"Vuelta {lap.Number + 1} · {(int)(lap.Time / 60)}:{lap.Time % 60:00.000}"; InvalidateVisual(); }
    }
    protected override void OnMouseLeftButtonUp(MouseButtonEventArgs e) { if (IsMouseCaptured) { Value = At(e.GetPosition(this)); ReleaseMouseCapture(); e.Handled = true; } base.OnMouseLeftButtonUp(e); }
    protected override void OnMouseLeave(MouseEventArgs e) { hovered = null; ToolTip = null; InvalidateVisual(); base.OnMouseLeave(e); }
    protected override void OnKeyDown(KeyEventArgs e) { double step = Keyboard.Modifiers.HasFlag(ModifierKeys.Shift) ? 5 : 1; switch (e.Key) { case Key.Left: Value -= step; break; case Key.Right: Value += step; break; case Key.Home: Value = Minimum; break; case Key.End: Value = Maximum; break; default: base.OnKeyDown(e); return; } e.Handled = true; }
    protected override AutomationPeer OnCreateAutomationPeer() => new TimelinePeer(this);
    sealed class TimelinePeer(SessionTimeline owner) : FrameworkElementAutomationPeer(owner), IRangeValueProvider
    {
        protected override string GetClassNameCore() => nameof(SessionTimeline);
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Slider;
        public override object? GetPattern(PatternInterface pattern) => pattern == PatternInterface.RangeValue ? this : base.GetPattern(pattern);
        public bool IsReadOnly => false; public double LargeChange => 5; public double SmallChange => 1; public double Maximum => owner.Maximum; public double Minimum => owner.Minimum; public double Value => owner.Value;
        public void SetValue(double value) { if (!double.IsFinite(value) || value < Minimum || value > Maximum) throw new ArgumentOutOfRangeException(nameof(value)); owner.Value = value; }
    }
}

public sealed class ViewportBar : FrameworkElement
{
    double extent = 1, start, span = 1, anchor; bool held;
    public double Value => start;
    public bool Interacting => held;
    public event RoutedPropertyChangedEventHandler<double>? ValueChanged;
    public event Action<bool>? InteractionChanged;
    public ViewportBar() { Height = 26; Cursor = Cursors.Hand; Focusable = true; ToolTip = "Arrastra la ventana visible · Zoom al cursor vuelve al cabezal"; }
    public void SetRange(double full, double left, double width) { extent = Math.Max(.001, full); span = Math.Clamp(width, .001, extent); if (!held) start = Math.Clamp(left, 0, extent - span); Cursor = span >= extent ? Cursors.Arrow : Cursors.SizeWE; Opacity = span >= extent ? .5 : 1; InvalidateVisual(); }
    double TrackWidth => Math.Max(1, ActualWidth - 4);
    double ThumbWidth => Math.Clamp(span / extent * TrackWidth, Math.Min(22, TrackWidth), TrackWidth);
    double ThumbLeft => extent <= span ? 2 : 2 + start / (extent - span) * (TrackWidth - ThumbWidth);
    protected override void OnRender(DrawingContext dc)
    {
        dc.DrawRectangle(Brushes.Transparent, null, new Rect(RenderSize)); dc.DrawRoundedRectangle(new SolidColorBrush(Color.FromRgb(42, 39, 45)), null, new Rect(2, 7, TrackWidth, 12), 2, 2);
        var rect = new Rect(ThumbLeft, 5, ThumbWidth, 16); dc.DrawRoundedRectangle(new LinearGradientBrush(Color.FromRgb(91, 35, 48), Color.FromRgb(49, 27, 36), 90), new Pen(new SolidColorBrush(Color.FromRgb((byte)(held ? 255 : 165), (byte)(held ? 106 : 63), (byte)(held ? 126 : 82))), 1), rect, 2, 2);
        if (ThumbWidth > 28) foreach (double x in new[] { rect.X + rect.Width / 2 - 3, rect.X + rect.Width / 2 + 3 }) dc.DrawLine(new Pen(new SolidColorBrush(Color.FromRgb(191, 119, 136)), 1), new Point(x, 10), new Point(x, 16));
    }
    void MoveTo(double x) { double old = start; start = Math.Clamp((x - anchor - 2) / Math.Max(1, TrackWidth - ThumbWidth) * (extent - span), 0, Math.Max(0, extent - span)); ValueChanged?.Invoke(this, new(old, start)); InvalidateVisual(); }
    protected override void OnMouseLeftButtonDown(MouseButtonEventArgs e) { if (span >= extent) return; Focus(); double x = e.GetPosition(this).X; anchor = x >= ThumbLeft && x <= ThumbLeft + ThumbWidth ? x - ThumbLeft : ThumbWidth / 2; held = true; InteractionChanged?.Invoke(true); CaptureMouse(); MoveTo(x); e.Handled = true; }
    protected override void OnMouseMove(MouseEventArgs e) { if (held && e.LeftButton == MouseButtonState.Pressed) MoveTo(e.GetPosition(this).X); }
    protected override void OnMouseLeftButtonUp(MouseButtonEventArgs e) { if (held) { MoveTo(e.GetPosition(this).X); held = false; ReleaseMouseCapture(); InteractionChanged?.Invoke(false); InvalidateVisual(); e.Handled = true; } }
    protected override void OnLostMouseCapture(MouseEventArgs e) { if (held) { held = false; InteractionChanged?.Invoke(false); } base.OnLostMouseCapture(e); }
    protected override void OnKeyDown(KeyEventArgs e) { double old = start; if (e.Key is Key.Left or Key.Right) { InteractionChanged?.Invoke(true); start = Math.Clamp(start + (e.Key == Key.Left ? -1 : 1) * span * .1, 0, Math.Max(0, extent - span)); ValueChanged?.Invoke(this, new(old, start)); InteractionChanged?.Invoke(false); InvalidateVisual(); e.Handled = true; } else base.OnKeyDown(e); }
}
