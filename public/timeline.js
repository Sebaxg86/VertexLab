/* Mapping shared by browser and Node tests. Null means no recorded footage. */
(function(root) {
  function toVideo(meta, t) {
    const correction = Number(meta.offset) || 0;
    if (meta.version !== 2) return t + correction;
    for (let i = (meta.syncSegments || []).length - 1; i >= 0; i--) {
      const s = meta.syncSegments[i];
      if (t >= s.tStart - 1e-6 && t <= s.tEnd + 1e-6) return s.videoStart + t - s.tStart + correction;
    }
    return null;
  }
  function fromVideo(meta, video) {
    const value = video - (Number(meta.offset) || 0);
    if (meta.version !== 2) return Math.max(0, value);
    for (const s of meta.syncSegments || []) {
      const end = s.videoStart + s.tEnd - s.tStart;
      if (value >= s.videoStart && value <= end) return s.tStart + value - s.videoStart;
      // Skip the short recording tail before OBS confirmed a pause.
      if (value < s.videoStart) return s.tStart;
    }
    return (meta.syncSegments || []).at(-1)?.tEnd ?? null;
  }
  // Find real coverage, including a negative correction or a video shorter than telemetry.
  function nextPlayable(meta, time, end=Infinity, duration=Infinity) {
    const offset=Number(meta.offset)||0;
    const segments=meta.version===2?(meta.syncSegments||[]):[{tStart:0,tEnd:end,videoStart:0}];
    let result=null;
    for(const s of segments){
      const start=Math.max(time,s.tStart,s.tStart-s.videoStart-offset);
      const limit=Math.min(end,s.tEnd,s.tStart+duration-s.videoStart-offset);
      if(start<=limit&&(result===null||start<result))result=start;
    }
    return result;
  }
  const api = {toVideo, fromVideo, nextPlayable};
  root.RaceTimeline = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
