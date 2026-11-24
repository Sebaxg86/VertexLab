using VertexLab.Core;
using Xunit;
namespace VertexLab.Tests;

public class ComparisonTests
{
    static SessionAnalysis Session() => new() { Points = [new(new() { T = 0 }, 0, 0, false), new(new() { T = 5 }, 0, 50, false), new(new() { T = 10 }, 0, 100, false), new(new() { T = 11 }, 1, 0, false), new(new() { T = 15 }, 1, 50, false), new(new() { T = 19 }, 1, 100, false)], Laps = [new(0, 0, 0, 10, 100, 10, true), new(1, 1, 11, 19, 100, 8, false)] };
    [Fact] public void ComparisonAlignsDistanceInsteadOfElapsedTime() { var s = Session(); Assert.Equal(15, LapComparison.MapTime(s, 5, 0, 1)); Assert.Equal(5, LapComparison.MapTime(s, 15, 1, 0)); }
    [Fact] public void MappingCannotFallIntoTheFollowingLap() { var s = Session(); Assert.Equal(19, LapComparison.MapTime(s, 12, 0, 1)); Assert.Equal(11, LapComparison.MapTime(s, -10, 0, 1)); Assert.Null(LapComparison.MapTime(s, 5, 0, 99)); }
    [Fact] public void FastestExcludesPartialLaps() { Assert.Equal(1, Session().Fastest?.Id); }
    [Fact] public void DistanceLookupStaysOnRequestedLap() { var s = Session(); Assert.Equal(0, s.AtDistance(0, 1000)?.LapId); Assert.Equal(19, s.AtDistance(1, 1000)?.Packet.T); Assert.Null(s.AtDistance(3, 10)); }
}
