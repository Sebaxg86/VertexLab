using VertexLab.Core;
namespace VertexLab.Tests;
public sealed class ScrubTests
{
    [Fact] public void ContinuousDraggingPreviewsLatestFramesWithoutQueuingEveryMouseMove()
    {
        var scrub = new ScrubController(); scrub.Begin(true, 0); int previews = 0;
        for (int i = 0; i < 100; i++)
        {
            scrub.Request(i, false, i * .01);
            var target = scrub.TakeSeek(i * .01);
            if (target is not null) { Assert.Equal(i, target); previews++; }
            Assert.False(scrub.TryFinish(i * .01, out _));
        }
        Assert.InRange(previews, 10, 14);
        scrub.End(1); Assert.Equal(99, scrub.TakeSeek(1)); Assert.Null(scrub.TakeSeek(1.01));
        Assert.False(scrub.TryFinish(1.1, out _)); Assert.True(scrub.TryFinish(1.2, out bool resume)); Assert.True(resume);
    }
    [Fact] public void ReleasingBetweenPreviewsImmediatelyCommitsTheFinalPreciseTarget()
    {
        var scrub = new ScrubController(); scrub.Begin(false, 0); scrub.Request(10, false, 0);
        Assert.Equal(10, scrub.TakeSeek(0)); scrub.Request(10.016, false, .01);
        Assert.Null(scrub.TakeSeek(.02)); scrub.End(.02); Assert.Equal(10.016, scrub.TakeSeek(.02));
        Assert.True(scrub.TryFinish(.3, out bool resume)); Assert.False(resume);
    }
    [Fact] public void StationaryPreviewDoesNotResumeUntilThePointerIsReleased()
    {
        var scrub = new ScrubController(); scrub.Begin(true, 0); scrub.Request(12, false, .01);
        Assert.Equal(12, scrub.TakeSeek(.2)); Assert.False(scrub.TryFinish(1, out _));
        scrub.End(1); Assert.Null(scrub.TakeSeek(1)); Assert.True(scrub.TryFinish(1, out bool resume)); Assert.True(resume);
    }
    [Fact] public void PausedSessionsStayPausedAndCancellationDiscardsStaleSeeks()
    {
        var scrub = new ScrubController(); scrub.Request(7, false, 0); Assert.Equal(7, scrub.TakeSeek(.2));
        Assert.True(scrub.TryFinish(.4, out bool resume)); Assert.False(resume);
        scrub.Begin(true, 1); scrub.Request(100, false, 1); scrub.Cancel();
        Assert.Null(scrub.TakeSeek(2)); Assert.False(scrub.TryFinish(2, out _));
    }
    [Fact] public void RapidClicksAlsoCoalesceWithoutLosingTheOriginalPlaybackIntent()
    {
        var scrub = new ScrubController(); scrub.Request(10, true, 0); scrub.Request(20, false, .05);
        Assert.Null(scrub.TakeSeek(.13)); Assert.Equal(20, scrub.TakeSeek(.2));
        Assert.True(scrub.TryFinish(.4, out bool resume)); Assert.True(resume);
    }
}
