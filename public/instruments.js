/* Instantaneous values only: no inferred grip percentages or historical backfill. */
(function(root) {
  const finite = Number.isFinite;
  function values(sample) {
    const steer = finite(sample?.steer) ? Math.max(-1, Math.min(1, sample.steer/127)) : null;
    const lateral = finite(sample?.accelX) ? sample.accelX/9.80665 : null;
    const longitudinal = finite(sample?.accelZ) ? sample.accelZ/9.80665 : null;
    return {steer, lateral, longitudinal,
      total: lateral !== null && longitudinal !== null ? Math.hypot(lateral,longitudinal) : null,
      tires: [0,1,2,3].map(i => ({
        temp: finite(sample?.tireTempsC?.[i]) ? sample.tireTempsC[i] : null,
        slip: finite(sample?.tireSlipCombined?.[i]) ? Math.abs(sample.tireSlipCombined[i]) : null
      }))};
  }
  function duration(seconds) {
    if (!finite(seconds)) return {text:'—',unit:'s'};
    return seconds<60 ? {text:seconds.toFixed(3),unit:'s'} : {text:(seconds/60).toFixed(3),unit:'min'};
  }
  function rpmReference(sample, observedPeak) {
    const engine = finite(sample?.engineMaxRpm) && sample.engineMaxRpm>0;
    const maximum = engine ? sample.engineMaxRpm : finite(observedPeak) && observedPeak>0 ? observedPeak : null;
    return {maximum,engine,ratio:maximum && finite(sample?.rpm) ? Math.max(0,Math.min(1,sample.rpm/maximum)) : null};
  }
  root.RaceInstruments = {values,duration,rpmReference};
  if (typeof module !== 'undefined') module.exports = root.RaceInstruments;
})(globalThis);
