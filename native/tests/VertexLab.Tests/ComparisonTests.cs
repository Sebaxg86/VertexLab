using VertexLab.Core;
using Xunit;
namespace VertexLab.Tests;

public class ComparisonTests
{
    static SessionAnalysis Session() => new() { Points = [new(new() { T = 0 }, 0, 0, false), new(new() { T = 5 }, 0, 50, false), new(new() { T = 10 }, 0, 100, false), new(new() { T = 11 }, 1, 0, false), new(new() { T = 15 }, 1, 50, false), new(new() { T = 19 }, 1, 100, false)], Laps = [new(0, 0, 0, 10, 100, 10, true), new(1, 1, 11, 19, 100, 8, false)] };
    [Fact] public void ComparisonAlignsDistanceInsteadOfElapsedTime() { var s = Session(); Assert.Equal(15, LapComparison.MapTime(s, 5, 0, 1)); Assert.Equal(5, LapComparison.MapTime(s, 15, 1, 0)); }
    [Fact] public void MappingCannotFallIntoTheFollowingLap() { var s = Session(); Assert.Equal(19, LapComparison.MapTime(s, 12, 0, 1)); Assert.Equal(11, LapComparison.MapTime(s, -10, 0, 1)); Assert.Null(LapComparison.MapTime(s, 5, 0, 99)); }
    [Fact] public void ElapsedComparisonStartsBothLapsTogetherRegardlessOfSpeed()
    {
        var s=Session(); Assert.Equal(11,LapComparison.MapElapsedTime(s,0,0,1));
        Assert.Equal(16,LapComparison.MapElapsedTime(s,5,0,1));
        Assert.Equal(5,LapComparison.MapElapsedTime(s,16,1,0));
    }
    [Fact] public void ElapsedComparisonNeverShowsTheFollowingLapAfterAnEarlierFinish()
    {
        var s=Session(); Assert.Null(LapComparison.MapElapsedTime(s,9,0,1));
        Assert.Equal(19,LapComparison.MapElapsedTime(s,8,0,1));
        Assert.Null(LapComparison.MapElapsedTime(s,1,0,99));
    }
    [Fact] public void LapClockAlignmentUsesForzaTimeEvenWhenPcClockDrifts()
    {
        var s=new SessionAnalysis{Points=[new(new(){T=0,LapTime=0},0,0,false),new(new(){T=5,LapTime=5.02},0,50,false),new(new(){T=10,LapTime=10.04},0,100,false),new(new(){T=11,LapTime=0},1,0,false),new(new(){T=16,LapTime=5},1,50,false),new(new(){T=21,LapTime=10},1,100,false)],Laps=[new(0,0,0,10,100,10.04,false),new(1,1,11,21,100,10,false)]};
        Assert.Equal(10.04,LapComparison.Duration(s,0),8);Assert.Equal(5.02,LapComparison.Elapsed(s,5,0),8);
        Assert.Equal(16.02,LapComparison.MapElapsedTime(s,5,0,1)!.Value,8);
        Assert.Equal(5,LapComparison.TimeAtElapsed(s,0,5.02)!.Value,8);
        Assert.Null(LapComparison.TimeAtElapsed(s,1,10.04));Assert.Equal(21,LapComparison.TimeAtElapsed(s,1,10.04,true));
    }
    [Fact] public void FastestExcludesPartialLaps() { Assert.Equal(1, Session().Fastest?.Id); }
    [Fact] public void DistanceLookupStaysOnRequestedLap() { var s = Session(); Assert.Equal(0, s.AtDistance(0, 1000)?.LapId); Assert.Equal(19, s.AtDistance(1, 1000)?.Packet.T); Assert.Null(s.AtDistance(3, 10)); }
    [Fact] public void ComparisonClockInterpolatesBetweenPackets()
    {
        Assert.Equal(13, LapComparison.MapTime(Session(), 2.5, 0, 1));
        Assert.Equal(7.5, LapComparison.MapTime(Session(), 17, 1, 0));
    }
    [Fact] public void MasterClockRetainsTimeDuringStationaryDistancePlateau()
    {
        var s = new SessionAnalysis { Points = [new(new() { T = 0 }, 0, 0, false), new(new() { T = 5 }, 0, 0, false), new(new() { T = 10 }, 0, 50, false)], Laps = [new(0, 0, 0, 10, 50, 10, false)] };
        Assert.Equal(2.345, LapComparison.MapTime(s, 2.345, 0, 0));
    }
    [Fact] public void ComparisonDoesNotInventAlignmentAcrossMissingData()
    {
        var s = Session(); var rows = s.Points.ToArray(); rows[1] = rows[1] with { Gap = true };
        s = new() { Points = rows, Laps = s.Laps };
        Assert.Null(LapComparison.MapTime(s, 2.5, 0, 1));
        Assert.Null(LapComparison.MapTime(s, 13, 1, 0));
    }
    [Fact] public void SmallDriftAdjustsSpeedWithoutRepeatedSeeks()
    {
        var clock = new ComparisonClock(); clock.Update(10, 10, 0, 1, true, false);
        for (int i = 1; i <= 20; i++) { var c = clock.Update(10 + i * .1, 9.85 + i * .1, i * .1, 1, false, false); Assert.False(c.Seek); Assert.InRange(c.Rate, 1, 1.12); }
    }
    [Fact] public void DiscontinuitiesSeekOnceAndRespectDecoderBackpressure()
    {
        var clock = new ComparisonClock(); Assert.True(clock.Update(50, 0, 0, 1, false, false).Seek);
        Assert.False(clock.Update(50.1, 0, .1, 1, false, false).Seek);
        Assert.False(clock.Update(52, 0, 2, 1, false, true).Seek);
        Assert.True(clock.Update(53, 0, 3, 1, false, false).Seek);
    }
    [Fact] public void StationaryComparisonPausesInsteadOfSeekingBackContinuously()
    {
        var clock = new ComparisonClock(); clock.Update(10, 10, 0, 1, true, false);
        var c = clock.Update(10, 10, .1, 1, false, false); Assert.True(c.Pause); Assert.False(c.Seek);
    }
}
