namespace VertexLab.Core;
public sealed record AnalysisPoint(TelemetryPacket Packet,int LapId,double Distance,bool Gap);
public sealed record LapInfo(int Id,int Number,double Start,double End,double Distance,double Time,bool Partial);
public sealed class SessionAnalysis
{
    public required IReadOnlyList<AnalysisPoint> Points { get; init; }
    public required IReadOnlyList<LapInfo> Laps { get; init; }
    public double Duration => Points.Count>0?Points[^1].Packet.T:0;
    Dictionary<int,AnalysisPoint[]>? byLap; Dictionary<int,bool>? lapClocks;
    public bool HasLapClock(int id) => (lapClocks ??= Laps.ToDictionary(l=>l.Id,l=> { var a=LapPoints(l.Id);return a.Count>1&&a[^1].Packet.LapTime>a[0].Packet.LapTime+.001&&a.Zip(a.Skip(1)).All(p=>p.Second.Packet.LapTime>=p.First.Packet.LapTime); })).GetValueOrDefault(id);
    public IReadOnlyList<AnalysisPoint> LapPoints(int id) => (byLap??=Points.GroupBy(p=>p.LapId).ToDictionary(g=>g.Key,g=>g.ToArray())).GetValueOrDefault(id)??[];
    public AnalysisPoint? AtDistance(int id,double distance)
    {
        var rows=LapPoints(id);int lo=0,hi=rows.Count;
        while(lo<hi){int m=(lo+hi)/2;if(rows[m].Distance<=distance)lo=m+1;else hi=m;}
        return rows.Count==0?null:rows[Math.Max(0,lo-1)];
    }
    public LapInfo? Fastest => Laps.Where(l=>!l.Partial&&l.Time>0).MinBy(l=>l.Time);
    public AnalysisPoint? At(double time)
    {
        int lo=0,hi=Points.Count;while(lo<hi){int m=(lo+hi)/2;if(Points[m].Packet.T<=time)lo=m+1;else hi=m;}
        return Points.Count==0?null:Points[Math.Max(0,lo-1)];
    }
}
public static class Analysis
{
    public static IEnumerable<TelemetryPacket> ReadRows(string file)
    {
        if(!File.Exists(file))yield break;
        using var stream=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.ReadWrite);using var reader=new StreamReader(stream);
        while(reader.ReadLine() is {} line){TelemetryPacket? row=null;try{row=Wire.Decode<TelemetryPacket>(line);}catch(System.Text.Json.JsonException ex){if(!reader.EndOfStream)throw new InvalidDataException("La telemetría contiene una línea dañada antes del final del archivo",ex);}
            if(row is not null){
                var numbers=new[]{row.T,row.X,row.Y,row.Z,row.Speed,row.Distance,row.LapTime,row.RaceTime,row.Rpm,row.EngineMaxRpm,row.Throttle,row.Brake,row.AccelX??0,row.AccelY??0,row.AccelZ??0};
                if(numbers.Any(n=>!double.IsFinite(n)))throw new InvalidDataException("La telemetría contiene valores no finitos");
                row=row with{TireTempsC=row.TireTempsC??[],TireSlipCombined=row.TireSlipCombined??[],TireSlipRatio=row.TireSlipRatio??[],Suspension=row.Suspension??[]};
                if(row.TireTempsC.Concat(row.TireSlipCombined).Concat(row.TireSlipRatio).Concat(row.Suspension).Any(n=>!double.IsFinite(n)))throw new InvalidDataException("Neumáticos con valores no finitos");
                yield return row;
            }}
    }
    public static SessionAnalysis Load(string file)
    {
        var points=new List<AnalysisPoint>();var laps=new List<LapInfo>();TelemetryPacket? previous=null;int id=-1;double distance=0,start=0,bestTime=0;bool partial=false;
        foreach(var row in ReadRows(file)){
            bool newLap=previous is null||row.Lap!=previous.Lap||row.Timestamp<previous.Timestamp;
            if(newLap){if(previous is not null)laps.Add(new(id,previous.Lap,start,previous.T,distance,bestTime,partial||id==0));id++;start=row.T;distance=0;bestTime=0;partial=false;}
            double step=!newLap?Math.Sqrt(Math.Pow(row.X-previous!.X,2)+Math.Pow(row.Z-previous.Z,2)):0;
            bool gap=!newLap&&(row.BreakBefore||row.T-previous!.T>1||step>100);if(!gap)distance+=step;partial|=gap;bestTime=Math.Max(bestTime,row.LapTime);
            points.Add(new(row,id,distance,gap));previous=row;
        }
        if(previous is not null)laps.Add(new(id,previous.Lap,start,previous.T,distance,bestTime,true));
        return new(){Points=points,Laps=laps};
    }
    public static double? ToVideo(SessionMeta meta,double t)
    {
        if(meta.Version!=2)return t+meta.Offset;
        foreach(var s in meta.SyncSegments.AsEnumerable().Reverse())if(t>=s.TStart-1e-6&&t<=s.TEnd+1e-6)return s.VideoStart+t-s.TStart+meta.Offset;return null;
    }
    public static bool HasVideoCoverage(SessionMeta meta,double video)
    {
        if(meta.Version!=2)return true;double value=video-meta.Offset;
        return meta.SyncSegments.Any(s=>value>=s.VideoStart-1e-6&&value<=s.VideoStart+s.TEnd-s.TStart+1e-6);
    }
    public static double? FromVideo(SessionMeta meta,double video)
    {
        double value=video-meta.Offset;if(meta.Version!=2)return Math.Max(0,value);
        foreach(var s in meta.SyncSegments){if(value>=s.VideoStart&&value<=s.VideoStart+s.TEnd-s.TStart)return s.TStart+value-s.VideoStart;if(value<s.VideoStart)return s.TStart;}
        return meta.SyncSegments.LastOrDefault()?.TEnd;
    }
}
