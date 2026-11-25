using VertexLab.Core;
namespace VertexLab.Tests;
public class VideoSyncTests
{
    static TelemetryPacket[] Rows()=>Enumerable.Range(0,1001).Select(i=>new TelemetryPacket{T=i*.01,RaceTime=i*.01,Timestamp=(uint)(i*10),RacePosition=1}).ToArray();
    static readonly SyncSegment Segment=new(){TStart=0,TEnd=10,VideoStart=0};
    static List<VideoClockObservation> Readings(double correction)=>Enumerable.Range(1,8).Select(i=>new VideoClockObservation(i+correction,i)).ToList();
    [Fact] public void CorrectsMeasuredImageOffsetRatherThanAConfiguredGuess()
    {
        var check=VideoSyncVerifier.Evaluate(new(),Segment,Rows(),Readings(.095),1d/60);
        Assert.Equal("verified",check.State);Assert.Equal(.095,check.CorrectionSeconds,8);Assert.InRange(check.ResidualSeconds,0,1e-10);
    }
    [Fact] public void HiddenOrAbsentClockCannotClaimVerifiedSynchronization()
    { Assert.Equal("unavailable",VideoSyncVerifier.Evaluate(new(),Segment,Rows(),[],1d/60).State); }
    [Fact] public void InconsistentOcrNeverChangesTheMapping()
    {
        var readings=Readings(.1);for(int i=0;i<readings.Count;i++)readings[i]=readings[i] with{VideoTime=readings[i].VideoTime+(i%2)*.2};
        var check=VideoSyncVerifier.Evaluate(new(),Segment,Rows(),readings,1d/60);Assert.Equal("inconsistent",check.State);Assert.Equal(0,check.CorrectionSeconds);
    }
    [Fact] public void DoesNotInterpolateThroughPauseOrMissingTelemetry()
    {
        var rows=Rows().Select(x=>x with{BreakBefore=true}).ToArray();
        Assert.Equal("unavailable",VideoSyncVerifier.Evaluate(new(),Segment,rows,Readings(.1),1d/60).State);
    }
    [Fact] public void ExistingOffsetIsIncludedAndRepeatedVerificationDoesNotDoubleCorrect()
    {
        var check=VideoSyncVerifier.Evaluate(new(){Offset=.095},Segment,Rows(),Readings(.095),1d/60);
        Assert.Equal("verified",check.State);Assert.Equal(0,check.CorrectionSeconds,8);
    }
    [Fact] public void ResumeSegmentsAreCheckedIndependently()
    {
        var segment=new SyncSegment{TStart=4,TEnd=10,VideoStart=20};
        var readings=Enumerable.Range(0,8).Select(i=>new VideoClockObservation(20.1+i*.6,4+i*.6)).ToArray();
        var check=VideoSyncVerifier.Evaluate(new(),segment,Rows(),readings,1d/60);Assert.Equal("verified",check.State);Assert.Equal(.1,check.CorrectionSeconds,8);
    }
}
