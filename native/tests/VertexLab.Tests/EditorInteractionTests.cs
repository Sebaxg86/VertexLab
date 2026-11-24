using VertexLab.Core;
using Xunit;
namespace VertexLab.Tests;

public sealed class EditorInteractionTests
{
    [Fact] public void ToolbarZoomCentersOnCursorEvenOutsideOldWindow() { var v = new PlaybackViewport(); v.Reset(1000); v.Zoom(2, 800); Assert.Equal(500, v.Span); Assert.Equal(500, v.Start); v.Pan(0); v.Zoom(2, 700); Assert.Equal(575, v.Start); Assert.Equal(250, v.Span); }
    [Fact] public void ManualPanCannotBeOverwrittenByPlayback() { var v = new PlaybackViewport(); v.Reset(1000); v.Zoom(4, 500); v.BeginPan(); v.Pan(700); Assert.False(v.Follow(100)); Assert.Equal(700, v.Start); v.EndPan(); Assert.False(v.Follow(100)); v.ResumeFollow(); Assert.True(v.Follow(500)); Assert.Equal(375, v.Start); }
    [Fact] public void FollowIsContinuousAndClampsAtEnds() { var v = new PlaybackViewport(); v.Reset(100); v.Zoom(5, 50); v.Follow(51); Assert.Equal(41, v.Start); v.Follow(52); Assert.Equal(42, v.Start); v.Follow(100); Assert.Equal(80, v.Start); v.Follow(0); Assert.Equal(0, v.Start); }
    [Fact] public void PointerZoomPreservesItsAnchor() { var v = new PlaybackViewport(); v.Reset(100); v.Zoom(2, 25, .25); Assert.Equal(12.5, v.Start); Assert.Equal(25, v.Start + v.Span * .25); }
    [Fact] public void RouteHoverFindsBetweenSamplesAndKeepsTheLap() { AnalysisPoint[] rows = [P(0, 0, 0, 2), P(10, 0, .1, 2), P(20, 0, .2, 2)]; var index = new RouteHitIndex(rows); var hit = index.Find(14, 1, 2); Assert.NotNull(hit); Assert.Equal(2, hit.LapId); Assert.Equal(.1, hit.Packet.T); Assert.Null(index.Find(14, 50, 2)); }
    [Fact] public void RouteHoverDoesNotBridgePacketGaps() { AnalysisPoint[] rows = [P(0, 0, 0, 0), P(100, 0, .1, 0, true)]; var index = new RouteHitIndex(rows); Assert.Null(index.Find(50, 0, 2)); }
    [Fact] public void RouteHoverWorkIsLocalInALargeRecording() { var rows = Enumerable.Range(0, 100000).Select(i => P(i % 1000, i / 1000, i * .01, 0, i % 1000 == 0)).ToArray(); var index = new RouteHitIndex(rows); for (int i = 0; i < 100; i++) { Assert.NotNull(index.Find(400.2, 45.3, 1)); Assert.InRange(index.LastCandidateCount, 1, 1000); } }
    static AnalysisPoint P(double x, double z, double t, int lap, bool gap = false) => new(new() { X = x, Z = z, T = t }, lap, x, gap);
}
