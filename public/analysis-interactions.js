let expandedMetric=null,analysisHover=null,mapSegments=[],chartSegments=new Map(),mapPointer=null,scrollLocked=false,preferredMapLap=null,legendHoverLap=null;
function updateSessionActions(){
 const featured=!!session?.meta.featured;
 $('feature-session').setAttribute('aria-pressed',String(featured));
 $('feature-label').textContent=featured?'Quitar destacado':'Destacar sesión';
 $('feature-session').querySelector('.feature-icon').textContent=featured?'★':'☆';
 $('delete-session').disabled=latest?.recording===session?.meta.id;
 const cloud=$('analysis-cloud-actions');if(cloud){
  cloud.replaceChildren();
  const cloudMatch=session?.meta.id?(globalThis.VertexCloud?.cachedSessions?.()||[]).find(c=>c.id===session.meta.id):null;
  const baseAvail=session?.meta.availability||{local:true,cloud:false};
  const liveAvail={...baseAvail,cloud:baseAvail.cloud||!!cloudMatch};
  if(session?.meta){
   session.meta.availability=liveAvail;
   if(cloudMatch?.cloud&&!session.meta.cloud)session.meta.cloud=cloudMatch.cloud;
  }
  const item={...session?.meta,id:session?.meta.id,availability:liveAvail,cloud:session?.meta.cloud||cloudMatch?.cloud||null};
  const activeJob=session?.meta.id?globalThis.VertexCloud?.jobFor?.(session.meta.id):null;
  updateAnalysisCloudProgress(activeJob);
  for(const option of VertexHomeModel.actions(item,latest?.recording,globalThis.VertexCloud?.actionState?.()).filter(option=>option.key!=='favorite')){
   const button=document.createElement('button');button.className='session-action'+(option.danger?' danger-action':'')+(option.soon?' sync-placeholder':'');button.disabled=!session||!option.enabled||(!!activeJob&&(option.key==='sync'||option.key==='download'||option.key.startsWith('delete')));
   button.innerHTML=option.key.startsWith('delete')?HomeGlyphs.remove:HomeGlyphs.cloud;
   const text=document.createElement('span');text.textContent=option.label;
   if(option.soon){const note=document.createElement('small');note.textContent='Conecta Google Drive';text.append(note);}
   button.append(text);
   if(option.key==='sync')button.onclick=action(async()=>{setMenu(false);$('message').textContent='Subiendo sesión a Google Drive…';await VertexCloud.syncSession(session.meta.id);updateSessionActions();});
   if(option.key==='download')button.onclick=action(async()=>{setMenu(false);$('message').textContent='Descargando sesión desde Google Drive…';await VertexCloud.downloadSession(session.meta.id);updateSessionActions();});
   if(option.key==='delete-local'||option.key==='delete-cloud'||option.key==='delete-all')button.onclick=()=>requestAnalysisDelete(option.key);
   cloud.append(button);
  }
 }
 $('export-session').disabled=!session||latest?.recording===session?.meta.id||(session.meta.version===2&&!session.meta.ended);
}
function updateAnalysisCloudProgress(job){
 let badge=$('analysis-cloud-progress');
 if(!job||!session){if(badge)badge.hidden=true;return;}
 if(!badge){
  badge=document.createElement('span');badge.id='analysis-cloud-progress';badge.className='analysis-cloud-progress';badge.setAttribute('role','status');
  $('settings-toggle').before(badge);
 }
 const pct=Math.max(0,Math.min(100,Math.round(job.percent||0)));
 const r=10,c=2*Math.PI*r,offset=c*(1-pct/100);
 badge.hidden=false;
 badge.title=`${job.phase||'Sincronizando'} · ${pct}%`;
 badge.setAttribute('aria-label',badge.title);
 badge.innerHTML=`<svg class="cloud-progress-ring" viewBox="0 0 26 26" aria-hidden="true"><circle class="ring-track" cx="13" cy="13" r="${r}"/><circle class="ring-fill" cx="13" cy="13" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"/></svg><b class="cloud-progress-pct">${pct}</b>`;
}
function clearAnalysisHover(){analysisHover=null;legendHoverLap=null;$('analysis-hover').hidden=true;$('map').removeAttribute('data-hover-lap');}
function showAnalysisHover(hit,event,kind,key=null){
 if(!hit){clearAnalysisHover();return;}
 analysisHover={...hit,kind,key,clientX:event.clientX,clientY:event.clientY};
 const lap=session.laps.find(l=>l.id===hit.lapId),metric=metricDefs.find(m=>m.key===key);
 let value='';
 if(metric){const number=hit.row?.[key];if(Number.isFinite(number)){const duration=metric.divisor?RaceInstruments.duration(number):null;value=' · '+metric.name+': '+(duration?duration.text+' '+duration.unit:number.toFixed(metric.decimals)+' '+metric.unit);}}
 const tip=$('analysis-hover');tip.hidden=false;
 tip.textContent=lapLabel(lap)+' · '+RaceAnalysis.clock(hit.time-RaceAnalysis.lapStart(lap))+value+' · clic para analizar';
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
function requestAnalysisDelete(scope){
 if(!session||latest?.recording===session.meta.id)return;
 setPlaying(false);setMenu(false);
 $('delete-title').textContent=scope==='delete-all'?'¿Eliminar definitivamente?':scope==='delete-cloud'?'¿Eliminar de Google Drive?':'¿Eliminar de este dispositivo?';
 $('delete-description').textContent=session.meta.name||session.meta.carName||'Sesión';
 const browser=!!globalThis.VertexBrowser?.enabled,inCloud=!!session.meta.availability?.cloud,isLocal=session.meta.availability?.local!==false;
 $('delete-dialog').dataset.scope=scope;
 if(scope==='delete-cloud'){
  $('delete-dialog').querySelector('.delete-warning').textContent=isLocal?'Se eliminará únicamente el respaldo en Google Drive. Tu copia local en este dispositivo se conserva.':'Se eliminará el respaldo en Google Drive. Esta sesión no está descargada en este dispositivo y esta acción no se puede deshacer.';
  $('delete-confirm').textContent='Eliminar de Google Drive';
 }else if(scope==='delete-all'&&inCloud){
  $('delete-dialog').querySelector('.delete-warning').textContent='Se eliminarán definitivamente tanto la copia en este dispositivo como el respaldo en Google Drive. Esta acción no se puede deshacer.';
  $('delete-confirm').textContent='Eliminar de todos lados';
 }else if(inCloud){
  $('delete-dialog').querySelector('.delete-warning').textContent='Se eliminará únicamente la copia local en este dispositivo. Tu respaldo en Google Drive se conserva.';
  $('delete-confirm').textContent='Eliminar copia local';
 }else{
  $('delete-dialog').querySelector('.delete-warning').textContent=browser?'Se eliminará la copia local de VertexLab. Tu archivo .vrtx original se conserva. No hay un respaldo en Google Drive.':scope==='delete-all'?'Se eliminarán definitivamente la telemetría y el video. No hay una copia en Google Drive. Esta acción no se puede deshacer.':'Se eliminarán la telemetría y el video de este dispositivo. Esta acción no se puede deshacer.';
  $('delete-confirm').textContent=scope==='delete-all'?'Eliminar definitivamente':'Eliminar local';
 }
 $('delete-dialog').showModal();$('delete-cancel').focus();
}
function setupAnalysisInteractions(){
 $('feature-session').onclick=action(async()=>{
  if(!session)return;const result=await api('feature/'+session.meta.id,{featured:!session.meta.featured});
  session.meta.featured=result.featured;updateSessionActions();await list();
 });
 $('delete-session').onclick=()=>requestAnalysisDelete('delete-local');
 $('delete-cancel').onclick=()=>$('delete-dialog').close();
 $('delete-confirm').onclick=action(async()=>{
  if(!session)return;const id=session.meta.id,scope=$('delete-dialog').dataset.scope||'delete-local',inCloud=!!session.meta.availability?.cloud,isLocal=session.meta.availability?.local!==false,folderId=session.meta.cloud?.driveFolderId;$('delete-confirm').disabled=true;
  try{
   if(scope==='delete-cloud'){
    await VertexCloud.deleteCloudSession(id,folderId);
    $('delete-dialog').close();
    if(isLocal){
     if(session.meta.availability)session.meta.availability.cloud=false;
     session.meta.cloud=null;updateSessionActions();await list();
     $('message').textContent='Respaldo eliminado de Google Drive. Tu copia local se conserva.';
    }else{
     clearVideo();openHome();await list();
     $('message').textContent='Sesión eliminada de Google Drive.';
    }
    return;
   }
   clearVideo();
   if(isLocal)await api('delete/'+id,{confirm:true,removeLocal:true});
   if(scope==='delete-all'&&inCloud)await VertexCloud.deleteCloudSession(id,folderId);
   $('delete-dialog').close();openHome();await list();
   $('message').textContent=scope==='delete-all'&&inCloud?'Sesión eliminada de este dispositivo y de Google Drive.':inCloud?'Copia local eliminada. Tu respaldo en Google Drive se conserva.':'Sesión y video eliminados.';
  }
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
 globalThis.VertexCloud?.onJobUpdate?.(()=>{
  if(!session)return;
  const job=VertexCloud.jobFor(session.meta.id);
  updateAnalysisCloudProgress(job);
  if(!job)updateSessionActions();
 });
}
function zoomMap(factor,pointer){
 const rect=$('map').getBoundingClientRect(),next=Math.max(.2,Math.min(256,zoom*factor));
 pan=RaceView.anchoredPan(pan,pointer||[rect.width/2,rect.height/2],[rect.width/2,rect.height/2],next/zoom);zoom=next;clearAnalysisHover();draw();
}
