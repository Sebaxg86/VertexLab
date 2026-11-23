(function(root){
  function clock(seconds){const ms=Math.max(0,Math.round(seconds*1000));return `${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;}
  function bounds(lap){return {start:lap?.rows[0]?.t||0,end:lap?.rows.at(-1)?.t||0};}
  function sessionRows(laps){let offset=0;return laps.flatMap(lap=>{const rows=lap.rows.map(row=>({...row,lapId:lap.id,lapDistance:row.d,d:offset+row.d}));offset+=lap.rows.at(-1)?.d||0;return rows;});}
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
    let lo=0,hi=rows.length-1;
    while(lo<hi){const m=(lo+hi)>>1;if(rows[m].t<time)lo=m+1;else hi=m;}
    const b=rows[lo],a=rows[Math.max(0,lo-1)];
    if(b.t===time)return b;
    if(b.gap||b.breakBefore)return null;
    const sample=time-a.t<b.t-time?a:b;
    // Only distance is interpolated for smooth comparison clocks; readings stay measured.
    return {...sample,t:time,d:a.d+(b.d-a.d)*(time-a.t)/(b.t-a.t||1)};
  }
  root.RaceAnalysis={clock,bounds,sessionRows,atDistance,videoChoices,sampleAtTime};
  if(typeof module!=='undefined')module.exports=root.RaceAnalysis;
})(globalThis);
