using VertexLab.Core;
namespace VertexLab.Tests;

public class FrameTimePolicyTests
{
    [Fact] public void KeyframePrerollMayStartSecondsBeforeTargetWithoutSeekingAgain()
    {
        Assert.True(FrameTimePolicy.NeedsSeek(1, 0, false, 103, 0));
        Assert.False(FrameTimePolicy.NeedsSeek(1, 1, true, 103, 100));
        Assert.False(FrameTimePolicy.NeedsSeek(1, 1, true, 103, 102));
        Assert.False(FrameTimePolicy.NeedsSeek(1, 1, false, 103, 103.05));
    }
    [Fact] public void PointerReleaseCanReplacePrerollEvenWithSixQueuedOldFrames()
    {
        Assert.True(FrameTimePolicy.QueueFull(6, 1, 1));
        Assert.False(FrameTimePolicy.QueueFull(6, 2, 1));
        Assert.True(FrameTimePolicy.NeedsSeek(2, 1, true, 20, 100));
    }
    [Fact] public void OrdinaryForwardPlaybackDecodesWithoutCorrectiveSeeks()
    {
        for (int i = 0; i < 1000; i++) Assert.False(FrameTimePolicy.NeedsSeek(2, 2, false, i / 60d, i / 60d + .1));
        Assert.True(FrameTimePolicy.NeedsSeek(2, 2, false, 200, 100));
    }
    [Theory]
    [InlineData(60, 1, .016666666666666666)]
    [InlineData(30, 1, .03333333333333333)]
    [InlineData(60000, 1001, .016683333333333333)]
    public void FrameSelectionUsesSourceFrameRate(uint numerator, uint denominator, double expected) => Assert.Equal(expected, FrameTimePolicy.FrameInterval(((ulong)numerator << 32) | denominator), 12);
}
