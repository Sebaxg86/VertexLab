/* Analysis modes and video panes share the original session clock and OBS mapping. */
let allMode=true, allRows=[], videoChoices=[], videoTargets=new Map();
function lapLabel(lap){return lap?`Vuelta ${(Number.isFinite(lap.number)?lap.number:lap.id)+1}`:'Sin vuelta';}
function analysisExtent(){return allMode?Math.max(1,allRows.at(-1)?.t||0):Math.max(1,...visible().map(lap=>lap.rows.at(-1)?.d||0));}
function analysisX(row){return allMode?row.t:row.d;}
function analysisSeries(){return allMode?[{id:0,rows:allRows}]:visible();}
function playbackBounds(){return allMode?{start:0,end:allRows.at(-1)?.t||0}:RaceAnalysis.bounds(session?.laps.find(lap=>lap.id===reference));}
function observedSample(){
  if(!session)return null;
  const rows=allMode?allRows:session.laps.find(lap=>lap.id===reference)?.rows||[];
  return RaceAnalysis.sampleAtTime(rows,t);
}
function refreshTransport(){const b=playbackBounds();$('time').max=Math.max(0,b.end-b.start);$('time').value=Math.max(0,t-b.start);$('duration').textContent=RaceAnalysis.clock(b.end-b.start);}
function renderCarBadges(){
  $('session-info').replaceChildren();
  if(!session){$('session-info').textContent='Abre una sesión desde el menú';return;}
  const meta=session.meta, classes=['D','C','B','A','S1','S2','X'];
  const year=/\b(19\d{2}|20\d{2})\b/.exec(meta.name)?.[0];
  for(const [kind,value] of [['class',classes[meta.carClass]??'Clase —'],['pi',`PI ${meta.carPI??'—'}`],['year',year]]){
    if(!value)continue;
    const tag=document.createElement('span');tag.className='car-badge badge-'+kind;tag.textContent=value;
    if(kind==='class')tag.dataset.class=classes[meta.carClass]||'';
    $('session-info').append(tag);
  }
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
  setPlaying(false);
  if(!allMode&&!selected.size)allMode=true;
  if(allMode){selected=new Set(session.laps.map(lap=>lap.id));reference=session.laps[0]?.id??null;}
  else if(!selected.has(reference))reference=[...selected][0];
  videoChoices=allMode?[]:RaceAnalysis.videoChoices(selected,videoChoices);
  chartRange=null;scaleCache.clear();legendKey=null;zoom=1;pan=[0,0];
  renderAnalysisMenu();renderVideoControls();refreshTransport();
  const b=playbackBounds();seek(resetTime?b.start:Math.max(b.start,Math.min(b.end,t)));
}
function selectAnalysisLap(id){
  if(allMode){allMode=false;selected=new Set([id]);reference=id;videoChoices=[];}
  else if(selected.has(id))selected.delete(id);else selected.add(id);
  applyAnalysisSelection(false);
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
  const split=!allMode&&videoChoices.length>1;
  $('video-split').classList.toggle('two-videos',split);$('video-pane-b').hidden=!split;
  const src=hasVideo?$('video').getAttribute('src'):null;
  if(split&&src&&$('compare-video').getAttribute('src')!==src)$('compare-video').src=src;
  if(!split)$('compare-video').pause();
  $('video-label-a').textContent=allMode?'Todo el recorrido':lapLabel(session.laps.find(lap=>lap.id===videoChoices[0]));
  $('video-label-b').textContent=split?lapLabel(session.laps.find(lap=>lap.id===videoChoices[1])):'';
  $('video-selection-note').textContent=selected.size>2?'Se comparan todas las vueltas marcadas. Elige aquí los dos videos.':'Videos alineados por distancia · audio del primero';
  videoTargets.clear();
}
function syncVideoPanes(force=false,dt=0){
  if(!session||!hasVideo)return;
  const sample=observedSample();
  const choices=allMode?[null]:videoChoices;
  choices.forEach((lapId,index)=>{
    const video=index?$('compare-video'):$('video'),warning=$(index?'video-warning-b':'video-warning-a');
    const lap=lapId===null?null:session.laps.find(lap=>lap.id===lapId);
    const targetTime=allMode||lapId===reference?t:sample?RaceAnalysis.atDistance(lap,sample.d):null;
    const target=targetTime===null?null:RaceTimeline.toVideo(currentMeta(),targetTime);
    const available=target!==null&&target>=0&&Number.isFinite(video.duration)&&target<=video.duration;
    warning.hidden=available;
    warning.textContent=targetTime===null?'Sin cobertura a esta distancia':target===null?'Sin video sincronizado en este tramo':Number.isFinite(video.duration)?'Fuera del video grabado':'Cargando video…';
    if(!available){video.pause();videoTargets.delete(index);return;}
    if(force||Math.abs(video.currentTime-target)>.12)video.currentTime=Math.max(0,Math.min(video.duration,target));
    const previous=videoTargets.get(index);
    if(playing){
      let rate=Number($('rate').value);
      if(!allMode&&previous!==undefined&&dt>0)rate=Math.max(.25,Math.min(4,(target-previous)/dt));
      video.playbackRate=rate;
      if(video.paused)video.play().catch(()=>{setPlaying(false);$('message').textContent='No se pudo reproducir el video. Pulsa Reproducir de nuevo.';});
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
  $('reference').onchange=()=>{reference=Number($('reference').value);applyAnalysisSelection(true);};
  $('compare-video').muted=true;
  $('compare-video').onloadedmetadata=()=>syncVideoPanes(true);
  $('compare-video').onerror=()=>{$('video-warning-b').hidden=false;$('video-warning-b').textContent='No se pudo abrir el segundo video';};
}
