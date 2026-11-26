/* Analysis modes and video panes share the original session clock and OBS mapping. */
let allMode=true, allRows=[], videoChoices=[], videoTargets=new Map(), videoClockActive=false;
function lapLabel(lap){return lap?`Vuelta ${(Number.isFinite(lap.number)?lap.number:lap.id)+1}`:'Sin vuelta';}
function analysisExtent(){return allMode?Math.max(1,allRows.at(-1)?.t||0):Math.max(1,...visible().map(lap=>RaceAnalysis.bounds(lap).end-RaceAnalysis.lapStart(lap)));}
function analysisX(row){return allMode?row.t:row.elapsed??row.t-playbackBounds().start;}
function analysisSeries(){return allMode?RaceAnalysis.timeSeries(allRows):RaceAnalysis.comparisonSeries(visible());}
function playbackBounds(){return allMode?{start:0,end:allRows.at(-1)?.t||0}:{start:RaceAnalysis.lapStart(session?.laps.find(lap=>lap.id===reference)),end:RaceAnalysis.lapStart(session?.laps.find(lap=>lap.id===reference))+analysisExtent()};}
function observedSample(){
  if(!session)return null;
  const rows=allMode?allRows:session.laps.find(lap=>lap.id===reference)?.rows||[];
  return RaceAnalysis.instrumentSample(RaceAnalysis.sampleAtTime(rows,t));
}
function refreshTransport(){const b=playbackBounds();$('time').max=Math.max(0,b.end-b.start);$('time').value=Math.max(0,t-b.start);$('duration').textContent=RaceAnalysis.clock(b.end-b.start);renderLapTimeline();}
function renderCarBadges(){
  $('session-info').replaceChildren();
  if(!session){$('session-info').textContent='Abre una sesión desde el menú';return;}
  const meta=session.meta,badge=createPerformanceBadge(meta.carClass,meta.carPI,true);
  if(badge)$('session-info').append(badge);
  const year=/\b(19\d{2}|20\d{2})\b/.exec(meta.name)?.[0];
  if(year){const tag=document.createElement('span');tag.className='car-badge badge-year';tag.textContent=year;$('session-info').append(tag);}

}
function renderAnalysisMenu(){
  $('all-laps').setAttribute('aria-pressed',String(allMode));
  $('lap-tabs').replaceChildren();
  const fastest=new Set(RaceAnalysis.fastestLapIds(session?.laps||[]));
  for(const lap of session?.laps||[]){
    const b=document.createElement('button');b.className='lap-tab';b.dataset.lapId=lap.id;b.style.setProperty('--lap-color',colors[lap.id%colors.length]);
    b.setAttribute('aria-pressed',String(!allMode&&selected.has(lap.id)));
    const name=document.createElement('span'),time=document.createElement('small');name.textContent=lapLabel(lap);
    const measured=lap.rows.reduce((max,row)=>Math.max(max,row.lapTime||0),0);
    time.textContent=RaceAnalysis.clock(lap.partial?RaceAnalysis.bounds(lap).end-RaceAnalysis.bounds(lap).start:measured)+(lap.partial?' · parcial':'');
    b.append(name,time);b.onclick=()=>selectAnalysisLap(lap.id);$('lap-tabs').append(b);
    if(fastest.has(lap.id)){
      b.classList.add('fastest-lap');const badge=document.createElement('em');badge.className='fastest-badge';badge.innerHTML=RaceIcons.flag+'BEST';name.append(badge);
      b.title='Vuelta completa más rápida · '+RaceAnalysis.clock(measured);
      b.setAttribute('aria-label',lapLabel(lap)+' · '+RaceAnalysis.clock(measured)+' · Vuelta más rápida');
    }
  }
  $('analysis-nav').hidden=!session;
}
function applyAnalysisSelection(resetTime=true){
  setPlaying(false);clearAnalysisHover();preferredMapLap=null;
  if(!allMode&&!selected.size)allMode=true;
  if(allMode){selected=new Set(session.laps.map(lap=>lap.id));reference=session.laps[0]?.id??null;}
  else if(!selected.has(reference))reference=[...selected][0];
  videoChoices=allMode?[]:RaceAnalysis.videoChoices(selected,videoChoices);
  chartRange=null;scaleCache.clear();legendKey=null;zoom=1;pan=[0,0];
  renderAnalysisMenu();renderVideoControls();refreshTransport();
  const b=playbackBounds();seek(resetTime?b.start:Math.max(b.start,Math.min(b.end,t)));
}
function selectAnalysisLap(id){
  const elapsed=allMode?0:t-playbackBounds().start;
  if(allMode){allMode=false;selected=new Set([id]);reference=id;videoChoices=[];}
  else if(selected.has(id))selected.delete(id);else selected.add(id);
  applyAnalysisSelection(true);
  if(!allMode)seek(Math.min(playbackBounds().end,playbackBounds().start+elapsed));
}
function renderVideoControls(){
  const laps=visible();
  $('video-options-button').hidden=allMode||!session;
  if(allMode||!session){$('video-options').hidden=true;$('video-options-button').setAttribute('aria-expanded','false');}
  for(const [id,value] of [['video-choice-a',videoChoices[0]],['video-choice-b',videoChoices[1]],['reference',reference]]){
    const select=$(id);select.replaceChildren();
    if(id==='video-choice-b'){const option=document.createElement('option');option.value='';option.textContent='Sin segundo video';select.append(option);}
    for(const lap of laps){const option=document.createElement('option');option.value=lap.id;option.textContent=lapLabel(lap);select.append(option);}
    select.value=value===undefined?'':String(value);
  }
  const split=!allMode&&videoChoices.length>1&&!globalThis.VertexBrowser?.singleVideo?.();
  $('video-split').classList.toggle('two-videos',split);$('video-pane-b').hidden=!split;
  const src=hasVideo?$('video').getAttribute('src'):null;
  if(split&&src&&$('compare-video').getAttribute('src')!==src)$('compare-video').src=src;
  if(!split){$('compare-video').pause();if($('compare-video').hasAttribute('src')){$('compare-video').removeAttribute('src');$('compare-video').load();}}
  $('video-label-a').textContent=allMode?'Todo el recorrido':lapLabel(session.laps.find(lap=>lap.id===videoChoices[0]));
  $('video-label-b').textContent=split?lapLabel(session.laps.find(lap=>lap.id===videoChoices[1])):'';
  $('video-selection-note').textContent=selected.size>2?'Se comparan todas las vueltas marcadas. Elige aquí los dos videos.':'Videos alineados por tiempo desde el inicio de vuelta · audio del primero';
  videoTargets.clear();
}
function videoPlaybackClock(){
  if(!session||!hasVideo)return null;
  const video=$('video');
  return RaceAnalysis.videoClock({current:t,meta:currentMeta(),allMode,
    sourceLap:session.laps.find(lap=>lap.id===videoChoices[0]),referenceLap:session.laps.find(lap=>lap.id===reference),
    video:{error:video.error,ended:video.ended,duration:video.duration,seeking:video.seeking,readyState:video.readyState,currentTime:video.currentTime,presentedTime:VertexPlayback.presentationTime(video)}},RaceTimeline);
}
function syncVideoPanes(force=false,dt=0){
  if(!session||!hasVideo)return;
  const choices=allMode?[null]:globalThis.VertexBrowser?.singleVideo?.()?videoChoices.slice(0,1):videoChoices;
  choices.forEach((lapId,index)=>{
    const video=index?$('compare-video'):$('video'),warning=$(index?'video-warning-b':'video-warning-a');
    if(video.error){warning.hidden=false;warning.textContent=VertexPlayback.message(null,video);return;}
    const lap=lapId===null?null:session.laps.find(lap=>lap.id===lapId);
    let targetTime=allMode?t:RaceAnalysis.atElapsed(lap,t-playbackBounds().start);
    // Let the audible media clock advance naturally between explicit seeks.
    // Round-tripping its own clock still skips real gaps between OBS segments.
    if(index===0&&targetTime!==null&&playing&&videoClockActive&&!force)targetTime=RaceTimeline.fromVideo(currentMeta(),video.currentTime);
    const target=targetTime===null?null:RaceTimeline.toVideo(currentMeta(),targetTime);
    const available=target!==null&&target>=0&&Number.isFinite(video.duration)&&target<=video.duration;
    warning.hidden=available;
    warning.textContent=targetTime===null?'Fin del tramo grabado de esta vuelta':target===null?'Sin video sincronizado en este tramo':Number.isFinite(video.duration)?'Fuera del video grabado':'Cargando video…';
    if(!available){
      if(allMode&&target===null&&targetTime!==null){const next=RaceTimeline.nextPlayable(currentMeta(),targetTime,playbackBounds().end,video.duration);if(next!==null&&next>targetTime)warning.textContent=`Video disponible desde ${RaceAnalysis.clock(next)} · Reproducir avanzará al tramo sincronizado.`;}
      video.pause();videoTargets.delete(index);return;
    }
    if(force||(!video.seeking&&Math.abs(video.currentTime-target)>(globalThis.VertexBrowser?.mobileApple ? .35 : .12)))video.currentTime=Math.max(0,Math.min(video.duration,target));
    if(playing){
      let rate=Number($('rate').value);

      if(Math.abs(video.playbackRate-rate)>.01)video.playbackRate=rate;
      VertexPlayback.play(video,error=>{if(error.name==='NotAllowedError')setPlaying(false);warning.hidden=false;warning.textContent=VertexPlayback.message(error,video);$('message').textContent=warning.textContent;});
    }else video.pause();
    videoTargets.set(index,target);
  });
}
function setupAnalysisUI(){
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){$('video-options').hidden=true;$('video-options-button').setAttribute('aria-expanded','false');}});
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('#video-options,#video-options-button')){$('video-options').hidden=true;$('video-options-button').setAttribute('aria-expanded','false');}});
  $('all-laps').onclick=()=>{if(!session)return;allMode=true;applyAnalysisSelection(false);};
  $('lap-tabs').addEventListener('wheel',event=>{if(Math.abs(event.deltaY)>Math.abs(event.deltaX)&&$('lap-tabs').scrollWidth>$('lap-tabs').clientWidth){event.preventDefault();$('lap-tabs').scrollLeft+=event.deltaY;}},{passive:false});
  $('video-options-button').onclick=()=>{const open=$('video-options').hidden;$('video-options').hidden=!open;$('video-options-button').setAttribute('aria-expanded',String(open));};
  for(const [id,index] of [['video-choice-a',0],['video-choice-b',1]])$(id).onchange=()=>{
    setPlaying(false);const value=$(id).value;
    if(value==='')videoChoices=videoChoices.slice(0,1);
    else{const chosen=Number(value),other=videoChoices[1-index];videoChoices[index]=chosen;if(other===chosen)videoChoices[1-index]=visible().map(lap=>lap.id).find(id=>id!==chosen);videoChoices=videoChoices.filter(id=>id!==undefined);}
    renderVideoControls();syncVideoPanes(true);
  };
  $('reference').onchange=()=>{
    if(!session)return;
    const id=Number($('reference').value),lap=visible().find(lap=>lap.id===id);
    if(!lap)return;
    const elapsed=t-playbackBounds().start;setPlaying(false);clearAnalysisHover();reference=id;
    const target=allMode?RaceAnalysis.bounds(lap).start:RaceAnalysis.lapStart(lap)+elapsed;
    renderVideoControls();refreshTransport();seek(target??RaceAnalysis.bounds(lap).start);
  };
  $('compare-video').muted=true;
  $('compare-video').onloadedmetadata=()=>syncVideoPanes(true);
  $('compare-video').onerror=()=>{$('video-warning-b').hidden=false;$('video-warning-b').textContent=VertexPlayback.message(null,$('compare-video'));};
}

let lapTimelineKey=null,lapTimelineSegments=[];
function renderLapTimeline(){
  const enabled=!!session&&allMode,total=enabled?playbackBounds().end:0;
  const segments=enabled?RaceAnalysis.lapTimeline(session.laps,total):[];
  const key=JSON.stringify([session?.meta.id,enabled,total,segments]);
  if(key===lapTimelineKey)return;
  lapTimelineKey=key;lapTimelineSegments=segments;
  const track=$('timeline-laps');track.replaceChildren();$('time').classList.toggle('lap-colored',enabled);
  $('timeline-lap-hover').hidden=true;
  const stops=['#343039 0%'];
  for(const segment of segments){const color=colors[segment.id%colors.length],start=segment.start/total*100,end=segment.end/total*100;stops.push(`#343039 ${start}%`,`${color} ${start}%`,`${color} ${end}%`,`#343039 ${end}%`);const span=document.createElement('span');span.style.left=start+'%';span.style.width=(end-start)+'%';span.style.setProperty('--lap-color',color);span.dataset.lapId=segment.id;track.append(span);}
  stops.push('#343039 100%');$('time').style.setProperty('--lap-track',`linear-gradient(to right,${stops.join(',')})`);
}
function setupLapTimeline(){
  const input=$('time'),tooltip=$('timeline-lap-hover');
  function hide(){tooltip.hidden=true;for(const span of $('timeline-laps').children)span.classList.remove('is-hovered');}
  input.addEventListener('pointermove',event=>{
    if(!session||!allMode){hide();return;}
    const rect=input.getBoundingClientRect(),fraction=Math.max(0,Math.min(1,(event.clientX-rect.left-6)/Math.max(1,rect.width-12))),time=fraction*playbackBounds().end;
    const lap=lapTimelineSegments.find(lap=>time>=lap.start&&time<=lap.end);
    if(!lap){hide();return;}
    tooltip.textContent=lapLabel(lap)+' · '+RaceAnalysis.clock(lap.end-lap.start)+(lap.partial?' · parcial':'')+' | '+RaceAnalysis.clock(time);
    tooltip.style.setProperty('--lap-color',colors[lap.id%colors.length]);tooltip.style.left=Math.max(0,Math.min(rect.width-220,event.clientX-rect.left-110))+'px';tooltip.hidden=false;
    for(const span of $('timeline-laps').children)span.classList.toggle('is-hovered',Number(span.dataset.lapId)===lap.id);
  });
  input.addEventListener('pointerleave',hide);input.addEventListener('blur',hide);
}

function updateLapScrollArrow(){const tabs=$('lap-tabs');$('lap-scroll-next').hidden=tabs.scrollWidth-tabs.clientWidth-tabs.scrollLeft<2;}
function setupLapScrollArrow(){
  const tabs=$('lap-tabs');tabs.addEventListener('scroll',updateLapScrollArrow,{passive:true});
  $('lap-scroll-next').onclick=()=>tabs.scrollBy({left:Math.max(115,tabs.clientWidth*.75),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  new ResizeObserver(updateLapScrollArrow).observe(tabs);
  new MutationObserver(()=>requestAnimationFrame(updateLapScrollArrow)).observe(tabs,{childList:true});
  updateLapScrollArrow();
}
