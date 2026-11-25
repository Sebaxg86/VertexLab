namespace VertexLab.Core;

public static class LapComparison
{
    public static double Duration(SessionAnalysis session,int id)
    {
        var rows=session.LapPoints(id);return rows.Count==0?0:session.HasLapClock(id)?rows[^1].Packet.LapTime-rows[0].Packet.LapTime:rows[^1].Packet.T-rows[0].Packet.T;
    }
    public static double Elapsed(SessionAnalysis session,double time,int id)
    {
        var rows=session.LapPoints(id);if(rows.Count==0)return 0;
        if(!session.HasLapClock(id))return Math.Clamp(time-rows[0].Packet.T,0,Duration(session,id));
        int lo=0,hi=rows.Count;while(lo<hi){int m=(lo+hi)/2;if(rows[m].Packet.T<=time)lo=m+1;else hi=m;}
        var a=rows[Math.Max(0,lo-1)];var b=rows[Math.Min(lo,rows.Count-1)];
        double fraction=b.Packet.T>a.Packet.T&&!b.Gap&&!b.Packet.BreakBefore?Math.Clamp((time-a.Packet.T)/(b.Packet.T-a.Packet.T),0,1):0;
        return a.Packet.LapTime+(b.Packet.LapTime-a.Packet.LapTime)*fraction-rows[0].Packet.LapTime;
    }
    public static double? TimeAtElapsed(SessionAnalysis session,int id,double elapsed,bool clamp=false)
    {
        var rows=session.LapPoints(id);if(rows.Count==0)return null;double duration=Duration(session,id);
        if(!clamp&&(elapsed<0||elapsed>duration+1e-6))return null;elapsed=Math.Clamp(elapsed,0,duration);
        if(!session.HasLapClock(id))return rows[0].Packet.T+elapsed;
        double target=rows[0].Packet.LapTime+elapsed;int lo=0,hi=rows.Count;
        while(lo<hi){int m=(lo+hi)/2;if(rows[m].Packet.LapTime<target)lo=m+1;else hi=m;}
        var b=rows[Math.Min(lo,rows.Count-1)];var a=rows[Math.Max(0,lo-1)];
        if(b.Packet.LapTime==target)return b.Packet.T;
        if(b.Gap||b.Packet.BreakBefore)return null;
        return a.Packet.T+(b.Packet.T-a.Packet.T)*(target-a.Packet.LapTime)/(b.Packet.LapTime-a.Packet.LapTime);
    }
    public static double? MapElapsedTime(SessionAnalysis session,double time,int sourceLap,int targetLap)
        {
        var source=session.Laps.FirstOrDefault(l=>l.Id==sourceLap);if(source is null)return null;
        if(sourceLap==targetLap)return Math.Clamp(time,source.Start,source.End);
        return TimeAtElapsed(session,targetLap,Elapsed(session,time,sourceLap));
    }
    // Each lap retains its own timestamp and video mapping; only distance is shared.
    public static double? MapTime(SessionAnalysis session, double time, int sourceLap, int targetLap)
    {
        var source = session.Laps.FirstOrDefault(l => l.Id == sourceLap); var target = session.Laps.FirstOrDefault(l => l.Id == targetLap);
        if (source is null || target is null) return null;
        time = Math.Clamp(time, source.Start, source.End);
        // Never round-trip the master clock through distance: a stopped car has many
        // timestamps at the same distance. Only comparison clocks interpolate.
        if (sourceLap == targetLap) return time;
        var rows = session.LapPoints(sourceLap);
        int lo = 0, hi = rows.Count;
        while (lo < hi) { int m = (lo + hi) / 2; if (rows[m].Packet.T <= time) lo = m + 1; else hi = m; }
        if (rows.Count == 0) return null;
        var a = rows[Math.Max(0, lo - 1)]; var b = rows[Math.Min(lo, rows.Count - 1)];
        if (time > a.Packet.T && b.Gap) return null;
        double d = a.Distance + (b.Distance - a.Distance) * (b.Packet.T > a.Packet.T ? (time - a.Packet.T) / (b.Packet.T - a.Packet.T) : 0);
        rows = session.LapPoints(targetLap); lo = 0; hi = rows.Count;
        if (rows.Count == 0 || d < rows[0].Distance || d > rows[^1].Distance) return null;
        while (lo < hi) { int m = (lo + hi) / 2; if (rows[m].Distance < d) lo = m + 1; else hi = m; }
        b = rows[Math.Min(lo, rows.Count - 1)]; a = rows[Math.Max(0, lo - 1)];
        if (b.Distance == d) return b.Packet.T;
        if (b.Gap) return null;
        return a.Packet.T + (b.Packet.T - a.Packet.T) * (d - a.Distance) / (b.Distance - a.Distance);
    }
}
