(function(root){
  function clock(seconds){const ms=Math.max(0,Math.round(seconds*1000));return `${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;}
  function bounds(lap){return {start:lap?.rows[0]?.t||0,end:lap?.rows.at(-1)?.t||0};}
  function sessionRows(laps){let offset=0;return laps.flatMap(lap=>{const rows=lap.rows.map(row=>({source:row,t:row.t,speed:row.speed,rpm:row.rpm,throttle:row.throttle,brake:row.brake,lapTime:row.lapTime,raceTime:row.raceTime,gap:row.gap,breakBefore:row.breakBefore,lapId:lap.id,lapDistance:row.d,d:offset+row.d}));offset+=lap.rows.at(-1)?.d||0;return rows;});}
  function instrumentSample(sample){return sample?.source?{...sample.source,t:sample.t,d:sample.d,lapId:sample.lapId,lapDistance:sample.lapDistance}:sample;}
  function atDistance(lap,distance){
    const rows=lap?.rows||[];
    if(!rows.length||distance<rows[0].d||distance>rows.at(-1).d)return null;
    let lo=0,hi=rows.length-1;
    while(lo<hi){const m=(lo+hi)>>1;if(rows[m].d<distance)lo=m+1;else hi=m;}
    const b=rows[lo],a=rows[Math.max(0,lo-1)];
    if(b.d===distance)return b.t;
    if(b.gap||b.breakBefore)return null;
    return a.t+(b.t-a.t)*(distance-a.d)/(b.d-a.d||1);
  }
  function videoChoices(selected,previous){const ids=[...selected];const kept=previous.filter(id=>ids.includes(id));return [...new Set([...kept,...ids])].slice(0,2);}
  function sampleAtTime(rows,time){
    if(!rows.length||time<rows[0].t||time>rows.at(-1).t)return null;
    let lo=0,hi=rows.length;
    while(lo<hi){const m=(lo+hi)>>1;if(rows[m].t<=time)lo=m+1;else hi=m;}
    const a=rows[Math.max(0,lo-1)],b=rows[Math.min(lo,rows.length-1)];
    // Resume shares the last active timestamp: use the new segment's reading,
    // matching the OBS timeline's newest-anchor selection.
    if(a.t===time)return a;
    if(b.gap||b.breakBefore)return null;
    const sample=time-a.t<b.t-time?a:b;
    // Only distance is interpolated for smooth comparison clocks; readings stay measured.
    return {...sample,t:time,d:a.d+(b.d-a.d)*(time-a.t)/(b.t-a.t||1)};
  }
  // The audible video is the playback clock. Buffering freezes telemetry, never triggers catch-up seeks.
  function videoClock(state,timeline){
    const {current,meta,allMode,sourceLap,referenceLap,video}=state;
    if(video.error||video.ended||!Number.isFinite(video.duration))return null;
    let sourceTime=current;
    if(!allMode&&sourceLap?.id!==referenceLap?.id){const sample=sampleAtTime(referenceLap?.rows||[],current);sourceTime=sample?atDistance(sourceLap,sample.d):null;}
    const target=sourceTime===null?null:timeline.toVideo(meta,sourceTime);
    if(target===null||target<0||target>video.duration)return null;
    if(video.seeking||video.readyState<2)return current;
    const measured=timeline.fromVideo(meta,video.currentTime);
    if(!Number.isFinite(measured))return null;
    if(allMode||sourceLap?.id===referenceLap?.id)return measured;
    const sample=sampleAtTime(sourceLap?.rows||[],measured);
    return sample?atDistance(referenceLap,sample.d):null;
  }
  function fastestLapIds(laps){
    const complete=laps.filter(lap=>!lap.partial&&lap.rows.length>1).map(lap=>({id:lap.id,time:lap.rows.reduce((max,row)=>Math.max(max,Number.isFinite(row.lapTime)?row.lapTime:0),0)})).filter(lap=>lap.time>0);
    const best=Math.min(...complete.map(lap=>lap.time));
    return complete.filter(lap=>Math.abs(lap.time-best)<.0005).map(lap=>lap.id);
  }
  function lapSummary(laps){
    const rows=laps.filter(lap=>lap.rows.length).map(lap=>({id:lap.id,number:lap.number,partial:!!lap.partial,time:lap.partial?bounds(lap).end-bounds(lap).start:lap.rows.reduce((max,row)=>Math.max(max,Number.isFinite(row.lapTime)?row.lapTime:0),0)}));
    const best=Math.min(...rows.filter(row=>!row.partial&&row.time>0).map(row=>row.time));
    return rows.map(row=>({...row,best:!row.partial&&row.time>0&&Math.abs(row.time-best)<.0005,delta:!row.partial&&row.time>0&&Number.isFinite(best)?Math.max(0,row.time-best):null}));
  }
  const timeSeriesCache=new WeakMap();
  function timeSeries(rows){
    if(timeSeriesCache.has(rows))return timeSeriesCache.get(rows);
    const series=[];let previous=null;
    for(const row of rows){let item=series.at(-1);if(!item||item.id!==row.lapId){item={id:row.lapId,rows:previous&&!row.gap&&!row.breakBefore?[previous]:[]};series.push(item);}item.rows.push(row);previous=row;}
    timeSeriesCache.set(rows,series);return series;
  }
  function lapTimeline(laps,total){return laps.filter(lap=>lap.rows.length).map(lap=>{const b=bounds(lap);return {id:lap.id,number:lap.number,partial:!!lap.partial,start:Math.max(0,b.start),end:Math.min(total,b.end)};}).filter(lap=>lap.end>lap.start);}
  root.RaceAnalysis={clock,bounds,sessionRows,instrumentSample,atDistance,videoChoices,sampleAtTime,videoClock,fastestLapIds,lapSummary,timeSeries,lapTimeline};
  if(typeof module!=='undefined')module.exports=root.RaceAnalysis;
})(globalThis);
