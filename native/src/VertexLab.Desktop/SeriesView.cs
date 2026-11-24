using System.Globalization;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using VertexLab.Core;
namespace VertexLab.Desktop;
// Retained geometries: cursor updates never rebuild the traces.
public sealed class SeriesView : FrameworkElement
{
    public string Metric {get;set;}="speed";public bool IsMap {get;set;}
    SessionAnalysis? data;int? lapId;double start,end=1,time;double xmin,xmax,zmin,zmax;double zoom=1;Vector pan;Point? drag;bool dragged;
    readonly List<(Geometry Shape,Pen Pen)> traces=[];static readonly Color[] Colors=[Color.FromRgb(255,59,82),Color.FromRgb(102,189,255),Color.FromRgb(255,191,110),Color.FromRgb(169,132,245)];
    public event Action<double>? Seek;public event Action<double,double>? RangeChanged;
    public SeriesView(){ClipToBounds=true;Cursor=Cursors.Cross;SizeChanged+=(_,_)=>Rebuild();MouseWheel+=Wheel;MouseLeftButtonDown+=Down;MouseMove+=Move;MouseLeftButtonUp+=Up;}
    public void SetData(SessionAnalysis? value,int? lap=null){data=value;lapId=lap;start=lap is {} id?value?.Laps.FirstOrDefault(l=>l.Id==id)?.Start??0:0;end=lap is {} lid?value?.Laps.FirstOrDefault(l=>l.Id==lid)?.End??1:Math.Max(1,value?.Duration??1);zoom=1;pan=new();Rebuild();}
    public void SetTime(double value){time=value;InvalidateVisual();}
    public void SetRange(double a,double b){start=a;end=b;Rebuild();}
    public void Fit(){zoom=1;pan=new();SetData(data,lapId);}
    IEnumerable<AnalysisPoint> Rows=>data?.Points.Where(p=>lapId is null||p.LapId==lapId)??[];
    double Value(TelemetryPacket p)=>Metric switch{"rpm"=>p.Rpm,"throttle"=>p.Throttle,"brake"=>p.Brake,_=>p.Speed};
    Point Map(TelemetryPacket p){double scale=Math.Min(Math.Max(1,ActualWidth-28)/Math.Max(1,xmax-xmin),Math.Max(1,ActualHeight-28)/Math.Max(1,zmax-zmin))*zoom;return new(ActualWidth/2+(p.X-(xmin+xmax)/2)*scale+pan.X,ActualHeight/2-(p.Z-(zmin+zmax)/2)*scale+pan.Y);}
    void Rebuild()
    {
        traces.Clear();if(data is null||ActualWidth<1||ActualHeight<1){InvalidateVisual();return;}
        var rows=Rows.ToArray();if(rows.Length==0){InvalidateVisual();return;}
        xmin=rows.Min(r=>r.Packet.X);xmax=rows.Max(r=>r.Packet.X);zmin=rows.Min(r=>r.Packet.Z);zmax=rows.Max(r=>r.Packet.Z);
        double max=Metric is "throttle" or "brake"?100:Math.Max(1,rows.Max(r=>Value(r.Packet)));double span=Math.Max(.001,end-start);
        foreach(var group in rows.GroupBy(r=>r.LapId)){
            var geometry=new StreamGeometry();using(var context=geometry.Open()){
                bool begun=false;Point previous=new(double.NaN,double.NaN);
                var visible=IsMap?group:group.Where(r=>r.Packet.T>=start&&r.Packet.T<=end);
                // Plot buckets keep min/max and endpoints, preserving spikes at screen resolution.
                var reduced=IsMap?visible:Reduce(visible,span);
                foreach(var row in reduced){var point=IsMap?Map(row.Packet):new Point(12+(row.Packet.T-start)/span*Math.Max(1,ActualWidth-24),ActualHeight-18-Value(row.Packet)/max*Math.Max(1,ActualHeight-48));
                    if(row.Gap||row.Packet.BreakBefore)begun=false;
                    if(IsMap&&begun&&(point-previous).LengthSquared<.25)continue;
                    if(!begun){context.BeginFigure(point,false,false);begun=true;}else context.LineTo(point,true,false);previous=point;
                }
            }geometry.Freeze();var pen=new Pen(new SolidColorBrush(Colors[group.Key%Colors.Length]),1.5);pen.Freeze();traces.Add((geometry,pen));
        }InvalidateVisual();
    }
    IEnumerable<AnalysisPoint> Reduce(IEnumerable<AnalysisPoint> rows,double span)
    {
        var bucket=new List<AnalysisPoint>();int column=-1;
        List<AnalysisPoint> Flush()=>bucket.Count==0?[]:new[]{bucket[0],bucket.MinBy(r=>Value(r.Packet))!,bucket.MaxBy(r=>Value(r.Packet))!,bucket[^1]}.Distinct().OrderBy(r=>r.Packet.T).ToList();
        foreach(var row in rows){int next=(int)((row.Packet.T-start)/span*Math.Max(1,ActualWidth));if(next!=column||row.Gap||row.Packet.BreakBefore){foreach(var point in Flush())yield return point;bucket.Clear();column=next;}bucket.Add(row);}
        foreach(var point in Flush())yield return point;
    }
    protected override void OnRender(DrawingContext dc)
    {
        dc.DrawRectangle(new SolidColorBrush(Color.FromRgb(17,17,22)),null,new Rect(RenderSize));foreach(var trace in traces)dc.DrawGeometry(null,trace.Pen,trace.Shape);
        if(!IsMap){var label=Metric switch{"rpm"=>"REVOLUCIONES","throttle"=>"ACELERADOR","brake"=>"FRENO",_=>"VELOCIDAD"};dc.DrawText(new FormattedText(label,CultureInfo.CurrentCulture,FlowDirection.LeftToRight,new Typeface("Bahnschrift"),12,Brushes.LightGray,VisualTreeHelper.GetDpi(this).PixelsPerDip),new Point(12,8));if(data is not null){double x=12+(time-start)/Math.Max(.001,end-start)*Math.Max(1,ActualWidth-24);dc.DrawLine(new Pen(Brushes.White,.8),new Point(x,28),new Point(x,ActualHeight-15));}}
        else if(data?.At(time) is {} sample)dc.DrawEllipse(Brushes.White,new Pen(Brushes.Crimson,3),Map(sample.Packet),4,4);
    }
    void Wheel(object sender,MouseWheelEventArgs e)
    {
        if(data is null)return;var mouse=e.GetPosition(this);double factor=e.Delta>0?1.3:1/1.3;
        if(IsMap){double next=Math.Clamp(zoom*factor,1,100),ratio=next/zoom;var center=new Point(ActualWidth/2,ActualHeight/2);pan=(Vector)(mouse-center)-((Vector)(mouse-center)-pan)*ratio;zoom=next;Rebuild();}
        else{double width=Math.Max(.05,(end-start)/factor),fraction=Math.Clamp(mouse.X/Math.Max(1,ActualWidth),0,1),anchor=start+(end-start)*fraction;double max=data.Duration;start=Math.Clamp(anchor-width*fraction,0,Math.Max(0,max-width));end=Math.Min(max,start+width);Rebuild();RangeChanged?.Invoke(start,end);}e.Handled=true;
    }
    void Down(object sender,MouseButtonEventArgs e){drag=e.GetPosition(this);dragged=false;CaptureMouse();if(!IsMap)SeekAt(drag.Value);}
    void Move(object sender,MouseEventArgs e){if(drag is not {} last||e.LeftButton!=MouseButtonState.Pressed)return;var point=e.GetPosition(this);if(IsMap){if((point-last).Length>1)dragged=true;pan+=point-last;drag=point;Rebuild();}else SeekAt(point);}
    void Up(object sender,MouseButtonEventArgs e){if(IsMap&&!dragged&&data is not null){var pos=e.GetPosition(this);var nearest=Rows.MinBy(r=>(Map(r.Packet)-pos).LengthSquared);if(nearest is not null)Seek?.Invoke(nearest.Packet.T);}drag=null;ReleaseMouseCapture();}
    void SeekAt(Point point)=>Seek?.Invoke(Math.Clamp(start+(point.X-12)/Math.Max(1,ActualWidth-24)*(end-start),start,end));
}
