/* Validate portable view state against the actual imported session. */
(function(root){
  function normalize(view,laps,keys){
    view=view&&typeof view==='object'?view:{};
    const clamp=(v,a,b,f)=>Number.isFinite(v)?Math.max(a,Math.min(b,v)):f;
    const ids=laps.map(l=>l.id),wanted=Array.isArray(view.selected)?view.selected.filter(id=>ids.includes(id)):[];
    const allMode=view.allMode!==false||!wanted.length,selected=allMode?ids:[...new Set(wanted)];
    const reference=selected.includes(view.reference)?view.reference:selected[0]??null;
    const lap=laps.find(l=>l.id===reference),start=allMode?0:lap?.rows[0]?.t||0;
    const end=allMode?Math.max(0,...laps.map(l=>l.rows.at(-1)?.t||0)):lap?.rows.at(-1)?.t||0;
    const extent=allMode?Math.max(1,end):Math.max(1,...laps.filter(l=>selected.includes(l.id)).map(l=>l.rows.at(-1)?.d||0));
    const range=view.chartRange;
    const chartRange=range&&Number.isFinite(range.start)&&Number.isFinite(range.end)&&range.start>=0&&range.end<=extent&&range.end>range.start?{start:range.start,end:range.end}:null;
    const choices=Array.isArray(view.videoChoices)?[...new Set(view.videoChoices.filter(id=>selected.includes(id)))]:[];
    return {version:1,allMode,selected,reference,t:clamp(view.t,start,end,start),chartRange,
      videoChoices:allMode?[]:[...new Set([...choices,...selected])].slice(0,2),
      zoom:clamp(view.zoom,.2,256,1),panNormalized:[0,1].map(i=>clamp(view.panNormalized?.[i],-1e6,1e6,0)),
      rate:[.5,1,2].includes(view.rate)?view.rate:1,volume:clamp(view.volume,0,1,1),muted:view.muted===true,
      expandedMetric:keys.includes(view.expandedMetric)?view.expandedMetric:null,
      metricIndex:Math.round(clamp(view.metricIndex,0,Math.max(0,keys.length-2),0))};
  }
  root.VertexPortableView={normalize};if(typeof module!=='undefined')module.exports=root.VertexPortableView;
})(globalThis);
