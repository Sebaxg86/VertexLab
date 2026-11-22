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
  const api = {toVideo, fromVideo};
  root.RaceTimeline = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
