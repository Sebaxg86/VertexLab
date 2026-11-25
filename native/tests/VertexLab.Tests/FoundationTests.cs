using System.Buffers.Binary;
using System.IO.Compression;
using Microsoft.Data.Sqlite;
using VertexLab.Core;
namespace VertexLab.Tests;
public sealed class FoundationTests : IDisposable
{
    readonly AppPaths paths=new(Path.Combine(Path.GetTempPath(),"VertexLab-tests-"+Guid.NewGuid().ToString("N")));
    sealed class FakeObs : IObsRecorder
    {
        public bool Connected=>true;public bool Owned{get;private set;} public List<string> Calls=[];public int StopFailures;public string? StopPath;
        public Task<ObsAnchor?> StartAsync(){Owned=true;Calls.Add("start");return Task.FromResult<ObsAnchor?>(new(100,0,.001));}
        public Task<ObsAnchor?> ResumeAsync(){Calls.Add("resume");return Task.FromResult<ObsAnchor?>(new(200,.8,.001));}
        public Task PauseAsync(){Calls.Add("pause");return Task.CompletedTask;}
        public Task<string?> StopAsync(){Calls.Add("stop");if(StopFailures>0){StopFailures--;throw new IOException("OBS stop test failure");}Owned=false;return Task.FromResult(StopPath);}
    }
    static TelemetryPacket Row(double race=10,int lap=0,bool active=true,int position=1)=>new(){Active=active,RacePosition=position,LapTime=1,RaceTime=race,Lap=lap,CarOrdinal=42,CarClass=3,CarPI=800,Rpm=6000,EngineMaxRpm=8000,Speed=120,Steer=-127,TireTempsC=[80,81,82,83],TireSlipCombined=[.1,.2,.3,.4]};
    [Fact] public void DecoderMatchesTheExisting324ByteProtocol()
    {
        var raw=new byte[324];void I(int offset,int value)=>BinaryPrimitives.WriteInt32LittleEndian(raw.AsSpan(offset),value);void F(int offset,float value)=>BinaryPrimitives.WriteSingleLittleEndian(raw.AsSpan(offset),value);
        I(0,1);I(212,42);I(216,3);I(220,800);F(256,30);F(8,8000);F(16,6000);F(20,9.80665f);F(268,212);raw[320]=129;raw[315]=255;raw[319]=4;
        var row=TelemetryDecoder.Decode(raw);Assert.Equal(108,row.Speed,6);Assert.Equal(-127,row.Steer);Assert.Equal(100,row.TireTempsC[0],6);Assert.Equal(100,row.Throttle);Assert.Equal(42,row.CarOrdinal);
        F(244,float.NaN);Assert.Throws<InvalidDataException>(()=>TelemetryDecoder.Decode(raw));Assert.Throws<InvalidDataException>(()=>TelemetryDecoder.Decode(new byte[323]));
    }
    [Fact] public async Task PauseResumePersistsExactInstrumentsAndExcludesThePause()
    {
        var library=new Library(paths);var obs=new FakeObs();using var engine=new CaptureEngine(paths,library,obs){Automatic=true};
        await engine.FeedAsync(Row(),100);await engine.FeedAsync(Row(),100.1);await engine.TickAsync(105);Assert.Equal("paused",engine.Mode);
        await engine.FeedAsync(Row(),200);await engine.FeedAsync(Row(),200.1);await engine.FinishAsync();
        var entry=Assert.Single(library.List());var rows=Analysis.ReadRows(entry.TelemetryPath).ToArray();Assert.Equal(4,rows.Length);Assert.Equal(.2,rows[^1].T,8);Assert.True(rows[2].BreakBefore);Assert.Equal(-127,rows[2].Steer);Assert.Equal(83,rows[2].TireTempsC[3]);Assert.Equal(.8,rows[2].VideoTime!.Value,6);
        Assert.Equal(new[]{"start","pause","resume","stop"},obs.Calls);Assert.Equal(2,entry.Meta.SyncSegments.Count);
        Assert.Equal(.85,Analysis.ToVideo(entry.Meta,.15)!.Value,6);Assert.Equal(.15,Analysis.FromVideo(entry.Meta,.85)!.Value,6);
    }
    [Fact] public async Task InactiveDoesNotEndButConfirmedFreeRoamDoes()
    {
        var library=new Library(paths);using var engine=new CaptureEngine(paths,library,new FakeObs()){Automatic=true};await engine.FeedAsync(Row(),100);
        await engine.FeedAsync(Row(active:false),101);await engine.TickAsync(1000);Assert.NotNull(engine.Current);
        var free=Row() with{LapTime=0,RacePosition=0};await engine.FeedAsync(free,1001);await engine.FeedAsync(free,1002.6);Assert.Null(engine.Current);Assert.Single(library.List());
    }
    [Fact] public async Task ManualStopBlocksImmediateAutomaticRestart()
    {
        using var engine=new CaptureEngine(paths,new Library(paths),new FakeObs()){Automatic=true};await engine.FeedAsync(Row(),100);await engine.FinishAsync();await engine.FeedAsync(Row(),101);Assert.Null(engine.Current);
        await engine.FeedAsync(Row(active:false),102);await engine.FeedAsync(Row(),103);Assert.NotNull(engine.Current);
    }
    [Fact] public async Task InterruptedRecordingIsRecoveredWithoutLosingReadableSamples()
    {
        var library=new Library(paths);using(var engine=new CaptureEngine(paths,library,new FakeObs())){await engine.StartAsync("TEST ONLY",null,100);await engine.FeedAsync(Row(),100);await engine.FeedAsync(Row(),100.2);}
        var entry=Assert.Single(library.List());await File.AppendAllTextAsync(entry.TelemetryPath,"{truncated");library.RecoverInterrupted();entry=Assert.Single(library.List());Assert.Equal("Interrupted",entry.State);Assert.Equal(.2,entry.Meta.Duration,8);Assert.Equal(2,Analysis.ReadRows(entry.TelemetryPath).Count());
    }
    [Fact] public void AnalysisBreaksTeleportsAndFindsTheCorrectCursor()
    {
        var file=paths.RowsPath("test");var rows=new[]{Row() with{T=0,X=0,Timestamp=1},Row() with{T=.1,X=10,Timestamp=2},Row() with{T=.2,X=1000,Timestamp=3},Row(lap:1) with{T=.3,X=1001,Timestamp=4}};File.WriteAllLines(file,rows.Select(Wire.Encode));
        var data=Analysis.Load(file);Assert.Equal(2,data.Laps.Count);Assert.Equal(10,data.Points[2].Distance);Assert.True(data.Points[2].Gap);Assert.Equal(.1,data.At(.15)!.Packet.T);Assert.True(data.Laps.All(l=>l.Partial));
    }
    [Fact] public async Task PortableRoundTripStreamsVideoAndRejectsExtraPaths()
    {
        var library=new Library(paths);var meta=new SessionMeta{Name="TEST ONLY",Ended=20,SyncState="video-verified",SyncSegments=[new(){TStart=0,TEnd=1,VideoStart=.095,Verification=new("verified","recorded-race-clock",.095,.01,[],"TEST ONLY") }],VideoPath=Path.Combine(paths.Sessions,"original.mp4")};await File.WriteAllBytesAsync(meta.VideoPath,[1,2,3,4]);await File.WriteAllTextAsync(paths.RowsPath(meta.Id),Wire.Encode(Row())+"\n");library.Save(meta,"Saved");
        var package=Path.Combine(paths.Root,"test.vrtx");await PortableSession.ExportAsync(Assert.Single(library.List()),package);
        var root=new DirectoryInfo(AppContext.BaseDirectory);while(root is not null&&!File.Exists(Path.Combine(root.FullName,"portable.py")))root=root.Parent;Assert.NotNull(root);
        var process=new System.Diagnostics.ProcessStartInfo("node"){WorkingDirectory=root!.FullName,UseShellExecute=false,RedirectStandardError=true,RedirectStandardOutput=true,CreateNoWindow=true};
        process.ArgumentList.Add("-e");process.ArgumentList.Add("const fs=require('node:fs'),assert=require('node:assert/strict');require('./public/vrtx-reader.js').read(new Blob([fs.readFileSync(process.argv[1])]),{zip:require('./public/vendor-zip-2.25.0.js'),hash:require('./public/vendor-sha256-4.13.0.js'),core:require('./public/browser-core.js')}).then(r=>{assert.equal(r.video.size,4);assert.equal(r.laps[0].rows[0].steer,-127);}).catch(e=>{console.error(e);process.exitCode=1;});");process.ArgumentList.Add(package);
        using var check=System.Diagnostics.Process.Start(process)!;string error=await check.StandardError.ReadToEndAsync();await check.WaitForExitAsync();Assert.True(check.ExitCode==0,error);
        var imported=await PortableSession.ImportAsync(package,paths,library);Assert.NotEqual(meta.Id,imported.Meta.Id);Assert.Equal("video-verified",imported.Meta.SyncState);Assert.Equal(.095,imported.Meta.SyncSegments[0].Verification!.CorrectionSeconds);Assert.Equal(.595,Analysis.ToVideo(imported.Meta,.5)!.Value,8);Assert.Equal(new byte[]{1,2,3,4},await File.ReadAllBytesAsync(imported.Meta.VideoPath!));
        using(var zip=ZipFile.Open(package,ZipArchiveMode.Update)){var extra=zip.CreateEntry("../escape");using var w=new StreamWriter(extra.Open());w.Write("bad");}
        await Assert.ThrowsAsync<InvalidDataException>(()=>PortableSession.ImportAsync(package,paths,library));Assert.Equal(2,library.List().Count);
    }
    [Fact] public async Task AVideoFreePackageHasAnExplicitNullManifestMember()
    {
        var library=new Library(paths);var meta=new SessionMeta{Ended=10};await File.WriteAllTextAsync(paths.RowsPath(meta.Id),Wire.Encode(Row())+"\n");library.Save(meta,"Saved");string package=Path.Combine(paths.Root,"no-video.vrtx");await PortableSession.ExportAsync(Assert.Single(library.List()),package);var imported=await PortableSession.ImportAsync(package,paths,library);Assert.Null(imported.Meta.VideoPath);
    }
    [Fact] public async Task TamperedPortableVideoIsRejectedWithoutPublishingPartialSession()
    {
        var library=new Library(paths);var meta=new SessionMeta{Ended=10,VideoPath=Path.Combine(paths.Root,"test.mp4")};await File.WriteAllBytesAsync(meta.VideoPath,[1,2,3,4]);await File.WriteAllTextAsync(paths.RowsPath(meta.Id),Wire.Encode(Row())+"\n");library.Save(meta,"Saved");
        string package=Path.Combine(paths.Root,"tampered.vrtx");await PortableSession.ExportAsync(Assert.Single(library.List()),package);
        using(var zip=ZipFile.Open(package,ZipArchiveMode.Update)){zip.GetEntry("video.mp4")!.Delete();var changed=zip.CreateEntry("video.mp4",CompressionLevel.NoCompression);await using var stream=changed.Open();await stream.WriteAsync(new byte[]{9,2,3,4});}
        await Assert.ThrowsAsync<InvalidDataException>(()=>PortableSession.ImportAsync(package,paths,library));Assert.Single(library.List());Assert.Single(Directory.GetFiles(paths.Sessions,"*.jsonl"));
    }
    [Fact] public void CorruptMiddleRowsAreNotSilentlySkipped()
    {
        string file=paths.RowsPath("bad");File.WriteAllText(file,Wire.Encode(Row())+"\n{damaged\n"+Wire.Encode(Row())+"\n");Assert.Throws<InvalidDataException>(()=>Analysis.Load(file));
    }
    [Fact] public async Task AFailedObsStopCanBeRetriedAndAssociatesTheRecoveredVideo()
    {
        var library=new Library(paths);var obs=new FakeObs{StopFailures=1,StopPath="C:\\Tests\\Recovered.mp4"};using var engine=new CaptureEngine(paths,library,obs);
        await engine.StartAsync("TEST ONLY",Row(),100);await engine.FeedAsync(Row(),100.1);await engine.FinishAsync();Assert.True(obs.Owned);Assert.Null(Assert.Single(library.List()).Meta.VideoPath);
        await Assert.ThrowsAsync<InvalidOperationException>(()=>engine.StartAsync("blocked",Row(),101));
        await engine.FinishAsync();Assert.False(obs.Owned);Assert.Equal(obs.StopPath,Assert.Single(library.List()).Meta.VideoPath);Assert.Null(engine.Error);
    }
    [Theory][InlineData(true)][InlineData(false)] public async Task FinalizedVideoQueuesVerificationForAutomaticAndManualSessions(bool automatic)
    {
        var library=new Library(paths);using var engine=new CaptureEngine(paths,library,new FakeObs{StopPath="C:/Tests/Synthetic.mp4"}){Automatic=automatic};SessionEntry? saved=null;
        engine.SessionSaved+=entry=>{saved=entry;Assert.NotNull(entry.Meta.Ended);Assert.True(File.Exists(entry.TelemetryPath));};
        if(automatic)await engine.FeedAsync(Row(),100);else await engine.StartAsync("TEST ONLY",Row(),100);
        await engine.FeedAsync(Row(),100.2);await engine.FinishAsync();
        Assert.NotNull(saved);Assert.Equal(automatic,saved.Meta.Automatic);Assert.Null(engine.Current);Assert.Equal("C:/Tests/Synthetic.mp4",saved.Meta.VideoPath);
    }
    [Fact] public void OldSessionsDoNotInventMissingInstrumentsOrObsSegments()
    {
        var row=Wire.Decode<TelemetryPacket>("{\"t\":0,\"x\":0,\"z\":0}");Assert.Null(row.Steer);Assert.Null(row.AccelX);Assert.Null(row.Gear);Assert.Empty(row.TireTempsC);
        var meta=Wire.Decode<SessionMeta>("{\"name\":\"Legacy\",\"offset\":2}");Assert.Equal(1,meta.Version);Assert.Equal(5,Analysis.ToVideo(meta,3));
    }
    public void Dispose(){SqliteConnection.ClearAllPools();if(!paths.Root.StartsWith(Path.GetFullPath(Path.GetTempPath()),StringComparison.OrdinalIgnoreCase)||!Path.GetFileName(paths.Root).StartsWith("VertexLab-tests-"))throw new InvalidOperationException("Unsafe test cleanup path");Directory.Delete(paths.Root,true);}
}
