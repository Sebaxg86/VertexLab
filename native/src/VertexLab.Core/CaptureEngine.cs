namespace VertexLab.Core;
// All methods are called by one capture actor, never by the UI or UDP reader directly.
public sealed class CaptureEngine : IDisposable
{
    readonly AppPaths paths;readonly Library library;readonly IObsRecorder obs;readonly Func<int,string> carName;
    StreamWriter? writer;FileStream? stream;TelemetryPacket? lastRow;double? last,negativeSince;double elapsed,lastPersist,lastFlush;
    SyncSegment? segment;bool blocked;SessionMeta? lastSaved;
    public event Action<SessionEntry>? SessionSaved;
    public SessionMeta? Current {get;private set;}
    public string Mode {get;private set;}="idle";
    public string? Error {get;set;}
    public bool Automatic {get;set;}
    public CaptureEngine(AppPaths paths,Library library,IObsRecorder obs,Func<int,string>? carName=null){this.paths=paths;this.library=library;this.obs=obs;this.carName=carName??(id=>$"Vehículo #{id}");}
    void Persist(){if(Current is {} m){m.Duration=elapsed;library.Save(m,Mode);}}
    async Task<ObsAnchor?> Obs(Func<Task<ObsAnchor?>> request){try{return await request();}catch(Exception ex){Error=ex.Message;if(Current is {} m)m.SyncState="error";return null;}}
    void Anchor(ObsAnchor? anchor,double wall){segment=null;if(anchor is null||Current is null)return;double start=elapsed+Math.Max(0,anchor.Wall-wall);segment=new(){TStart=start,TEnd=start,VideoStart=anchor.Video,Uncertainty=anchor.Uncertainty};Current.SyncSegments.Add(segment);if(Current.SyncState!="error")Current.SyncState="estimated";}
    public async Task StartAsync(string? name,TelemetryPacket? row,double wall,bool automatic=false)
    {
        if(Current is not null||obs.Owned)throw new InvalidOperationException("Ya hay una sesión o grabación pendiente");
        if(string.IsNullOrWhiteSpace(name))name=automatic?carName(row?.CarOrdinal??0):$"Sesión libre {library.List().Count(s=>!s.Meta.Automatic)+1:000}";
        if(name.Length>100)name=name[..100];
        Current=new(){Name=name.Trim(),Automatic=automatic,CarOrdinal=row?.CarOrdinal??0,CarClass=row?.CarClass,CarPI=row?.CarPI};
        stream=new FileStream(paths.RowsPath(Current.Id),FileMode.CreateNew,FileAccess.Write,FileShare.Read);writer=new StreamWriter(stream,new System.Text.UTF8Encoding(false),65536,leaveOpen:true);
        elapsed=0;last=wall;lastRow=null;negativeSince=null;Error=null;Mode="recording";Persist();
        Anchor(await Obs(obs.StartAsync),wall);Persist();
    }
    public async Task PauseAsync()
    {
        if(Current is null||Mode!="recording")return;Mode="paused";Flush();await Obs(async()=>{await obs.PauseAsync();return null;});Persist();
    }
    public async Task TickAsync(double wall){if(Current is not null&&last is not null&&wall-last>=.6)await PauseAsync();}
    public async Task FinishAsync(string reason="manual")
    {
        if(Current is null){if(obs.Owned)await Obs(async()=>{var recovered=await obs.StopAsync();if(recovered is not null&&lastSaved is not null){lastSaved.VideoPath=recovered;library.Save(lastSaved,"Saved");Error=null;SessionSaved?.Invoke(new(Wire.Decode<SessionMeta>(Wire.Encode(lastSaved)),paths.RowsPath(lastSaved.Id),"Saved"));}return null;});return;}
        Flush();var path=await Obs(async()=>{var output=await obs.StopAsync();if(output is not null)Current.VideoPath=output;return null;});
        Current.Ended=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()/1000d;Mode="Saved";Persist();writer!.Dispose();stream!.Dispose();writer=null;stream=null;
        lastSaved=Current;Current=null;lastRow=null;segment=null;negativeSince=null;Mode=Automatic?"armed":"idle";if(reason=="manual")blocked=true;
        if(lastSaved.VideoPath is not null) SessionSaved?.Invoke(new(Wire.Decode<SessionMeta>(Wire.Encode(lastSaved)),paths.RowsPath(lastSaved.Id),"Saved"));
    }
    public async Task FeedAsync(TelemetryPacket row,double wall)
    {
        bool inEvent=row.Active&&(Current?.Automatic==false||row.RacePosition>0||row.LapTime>0);
        if(!inEvent){blocked=false;if(Current is not null){await PauseAsync();if(row.Active){negativeSince??=wall;if(wall-negativeSince>=1.5)await FinishAsync("free-roam");}else negativeSince=null;}return;}
        negativeSince=null;
        if(Current is not null&&lastRow is not null&&((row.RaceTime<2&&lastRow.RaceTime>5)||(row.CarOrdinal!=0&&Current.CarOrdinal!=0&&row.CarOrdinal!=Current.CarOrdinal)))await FinishAsync("new-event");
        if(Current is null){if(!Automatic||blocked)return;await StartAsync(null,row,wall,true);}
        bool resumed=Mode=="paused";if(last is not null&&!resumed)elapsed+=Math.Max(0,wall-last.Value);
        if(resumed){Mode="recording";Anchor(await Obs(obs.ResumeAsync),wall);}
        if(Current!.CarOrdinal==0&&row.CarOrdinal!=0){Current.CarOrdinal=row.CarOrdinal;Current.CarClass=row.CarClass;Current.CarPI=row.CarPI;if(Current.Automatic)Current.Name=carName(row.CarOrdinal);}
        var saved=row with{T=elapsed,Wall=wall,BreakBefore=resumed,VideoTime=segment is not null&&elapsed>=segment.TStart?segment.VideoStart+elapsed-segment.TStart:null};
        if(segment is not null)segment.TEnd=Math.Max(segment.TStart,elapsed);
        writer!.WriteLine(Wire.Encode(saved));last=wall;lastRow=row;
        if(wall-lastFlush>=.25){writer.Flush();lastFlush=wall;}
        if(wall-lastPersist>=1){Flush();Persist();lastPersist=wall;}
    }
    public void Flush(){writer?.Flush();stream?.Flush(true);}
    public void Dispose(){Flush();writer?.Dispose();stream?.Dispose();}
}
