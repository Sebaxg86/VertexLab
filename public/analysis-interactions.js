let expandedMetric=null,analysisHover=null,mapSegments=[],chartSegments=new Map(),mapPointer=null,scrollLocked=false,hoverPaintAt=0,preferredMapLap=null,legendHoverLap=null;
function updateSessionActions(){
 const featured=!!session?.meta.featured;
 $('feature-session').setAttribute('aria-pressed',String(featured));
 $('feature-label').textContent=featured?'Quitar destacado':'Destacar sesión';
 $('feature-session').querySelector('.feature-icon').textContent=featured?'★':'☆';
 $('delete-session').disabled=latest?.recording===session?.meta.id;
}
function clearAnalysisHover(){analysisHover=null;legendHoverLap=null;$('analysis-hover').hidden=true;$('map').removeAttribute('data-hover-lap');}
function showAnalysisHover(hit,event,kind,key=null){
 if(!hit){clearAnalysisHover();return;}
 analysisHover={...hit,kind,key,clientX:event.clientX,clientY:event.clientY};
 const lap=session.laps.find(l=>l.id===hit.lapId),metric=metricDefs.find(m=>m.key===key);
 let value='';
 if(metric){const number=hit.row?.[key];if(Number.isFinite(number)){const duration=metric.divisor?RaceInstruments.duration(number):null;value=' · '+metric.name+': '+(duration?duration.text+' '+duration.unit:number.toFixed(metric.decimals)+' '+metric.unit);}}
 const tip=$('analysis-hover');tip.hidden=false;
 tip.textContent=lapLabel(lap)+' · '+RaceAnalysis.clock(hit.time-RaceAnalysis.bounds(lap).start)+value+' · clic para analizar';
 tip.style.left=Math.max(8,Math.min(innerWidth-tip.offsetWidth-8,event.clientX+14))+'px';
 tip.style.top=Math.max(8,Math.min(innerHeight-tip.offsetHeight-8,event.clientY+16))+'px';
 if(kind==='map')$('map').dataset.hoverLap=hit.lapId;
}
function seekHit(hit){
 if(!hit||!session)return;
 if(!allMode&&reference!==hit.lapId){
  reference=hit.lapId;
  if(!videoChoices.includes(reference))videoChoices=[reference,...videoChoices].slice(0,2);
  renderVideoControls();
 }
 seek(hit.time);refreshTransport();
}
function setMetricLayout(){
 for(const card of $('telemetry-rows').children){
  const key=card.querySelector('canvas').dataset.key;
  card.hidden=!!expandedMetric&&expandedMetric!==key;
  card.classList.toggle('is-expanded',expandedMetric===key);
  card.querySelector('.metric-expand')?.setAttribute('aria-expanded',String(expandedMetric===key));
 }
}
function toggleMetric(key){
 const was=expandedMetric;expandedMetric=was===key?null:key;clearAnalysisHover();setMetricLayout();
 $('telemetry-scroll').scrollTop=0;draw();
 if(!expandedMetric){const index=metricDefs.findIndex(m=>m.key===key),height=$('telemetry-scroll').clientHeight/2;$('telemetry-scroll').scrollTop=Math.min(index,metricDefs.length-2)*height;draw();}
}
function stepMetrics(direction){
 if(scrollLocked)return;
 if(expandedMetric){
  const index=metricDefs.findIndex(m=>m.key===expandedMetric),next=Math.max(0,Math.min(metricDefs.length-1,index+Math.sign(direction)));
  if(index===next)return;
  const refocus=document.activeElement.classList.contains('metric-expand');
  expandedMetric=metricDefs[next].key;clearAnalysisHover();setMetricLayout();$('telemetry-scroll').scrollTop=0;draw();
  if(refocus)document.querySelector('.metric-card.is-expanded .metric-expand').focus();
  scrollLocked=true;setTimeout(()=>{scrollLocked=false;},230);return;
 }
 const container=$('telemetry-scroll'),height=container.clientHeight/2;
 if(!height)return;
 const index=RaceInteraction.scrollIndex(container.scrollTop/height,direction,metricDefs.length);
 scrollLocked=true;clearAnalysisHover();container.scrollTo({top:index*height,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 setTimeout(()=>{scrollLocked=false;},230);
}
function setupAnalysisInteractions(){
 $('feature-session').onclick=action(async()=>{
  if(!session)return;const result=await api('feature/'+session.meta.id,{featured:!session.meta.featured});
  session.meta.featured=result.featured;updateSessionActions();await list();
 });
 $('delete-session').onclick=()=>{
  if(!session)return;setPlaying(false);setMenu(false);
  $('delete-description').textContent=session.meta.name+(session.meta.videoPath?' · '+session.meta.videoPath.split(/[\\/]/).at(-1):' · sin video asociado');
  $('delete-dialog').showModal();$('delete-cancel').focus();
 };
 $('delete-cancel').onclick=()=>$('delete-dialog').close();
 $('delete-confirm').onclick=action(async()=>{
  if(!session)return;const id=session.meta.id;$('delete-confirm').disabled=true;
  try{clearVideo();await api('delete/'+id,{confirm:true});$('delete-dialog').close();openLiveView();await list();$('message').textContent='Sesión y video eliminados.';}
  catch(error){$('delete-dialog').close();await load(id);throw error;}
  finally{$('delete-confirm').disabled=false;}
 });
 for(const card of $('telemetry-rows').children){
  const title=card.querySelector('.metric-name'),key=card.querySelector('canvas').dataset.key;
  const button=document.createElement('button');button.className='metric-expand';button.setAttribute('aria-expanded','false');button.setAttribute('aria-label','Expandir o contraer '+title.textContent);
  button.innerHTML='<span></span><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4"/></svg>';
  button.querySelector('span').textContent=title.textContent;title.replaceChildren(button);button.onclick=()=>toggleMetric(key);
 }
 $('telemetry-scroll').addEventListener('wheel',event=>{if(event.ctrlKey||!event.deltaY)return;event.preventDefault();stepMetrics(event.deltaY);},{passive:false});
 $('telemetry-scroll').addEventListener('keydown',event=>{if(['ArrowDown','PageDown','ArrowUp','PageUp'].includes(event.key)&&(event.target===$('telemetry-scroll')||event.target.closest('.metric-expand'))){event.preventDefault();stepMetrics(['ArrowDown','PageDown'].includes(event.key)?1:-1);}});
 $('map').onpointerdown=event=>{const rect=$('map').getBoundingClientRect(),picked=RaceInteraction.hitSegments(mapSegments,event.clientX-rect.left,event.clientY-rect.top,12,preferredMapLap??analysisHover?.lapId);mapPointer={x:event.clientX,y:event.clientY,lastX:event.clientX,lastY:event.clientY,moved:false,hit:picked};$('map').setPointerCapture(event.pointerId);};
 $('map').onpointermove=event=>{
  if(mapPointer){if(Math.hypot(event.clientX-mapPointer.x,event.clientY-mapPointer.y)>4)mapPointer.moved=true;if(mapPointer.moved){pan[0]+=event.clientX-mapPointer.lastX;pan[1]+=event.clientY-mapPointer.lastY;clearAnalysisHover();}mapPointer.lastX=event.clientX;mapPointer.lastY=event.clientY;draw();return;}
  const rect=$('map').getBoundingClientRect(),hit=RaceInteraction.hitSegments(mapSegments,event.clientX-rect.left,event.clientY-rect.top,12,preferredMapLap??(analysisHover?.kind==='map'?analysisHover.lapId:null));
  showAnalysisHover(hit,event,'map');$('map').style.cursor=hit?'pointer':'grab';draw();
 };
 $('map').onpointerup=()=>{if(mapPointer&&!mapPointer.moved)seekHit(mapPointer.hit);mapPointer=null;draw();};
 $('map').onpointercancel=()=>{mapPointer=null;clearAnalysisHover();};
 $('map').onpointerleave=()=>{if(!mapPointer){clearAnalysisHover();draw();}};
 $('map-zoom-in').onclick=()=>zoomMap(2);$('map-zoom-out').onclick=()=>zoomMap(.5);
}
function zoomMap(factor,pointer){
 const rect=$('map').getBoundingClientRect(),next=Math.max(.2,Math.min(256,zoom*factor));
 pan=RaceView.anchoredPan(pan,pointer||[rect.width/2,rect.height/2],[rect.width/2,rect.height/2],next/zoom);zoom=next;clearAnalysisHover();draw();
}
