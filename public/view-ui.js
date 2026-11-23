/* The LIVE clock is based on packet arrival, never on saved session data. */
(function(root){
  function connection(state,now,stream=true,receivedAt){
    const elapsed=Number.isFinite(receivedAt)?Math.max(0,now-receivedAt):Infinity;
    const age=Number.isFinite(state?.packetAge)?state.packetAge+(Number.isFinite(elapsed)?elapsed:0):Math.max(0,now-(state?.lastPacket??-Infinity));
    const online=!!((stream||elapsed<2)&&state?.packet&&!state.udpError&&age<5);
    const fresh=age<2;
    return {online,active:online&&fresh&&!!state.packet.active,label:online?'LIVE':'OFF LIVE',detail:!stream?'Servidor desconectado · reconectando…':state?.udpError?'No se pudo abrir el receptor UDP':online?!fresh?'Señal interrumpida · esperando nuevos datos':state.packet.active?'Recibiendo telemetría en tiempo real':'Forza conectado · juego en pausa o menú':'Sin señal de Forza · esperando Data Out'};
  }
  root.RaceConnection={connection};
  if(typeof module!=='undefined')module.exports=root.RaceConnection;
})(globalThis);
let pickerTimer,streamConnected=false,liveReceivedAt=null;
function liveConnection(){return RaceConnection.connection(latest,Number.isFinite(latest?.packetAge)?performance.now()/1000:Date.now()/1000,streamConnected,liveReceivedAt);}
function setViewText(id,value){if($(id).textContent!==value)$(id).textContent=value;}
function setSessionPicker(open,restoreFocus=false){
  clearTimeout(pickerTimer);
  const picker=$('session-picker');
  $('session-trigger').setAttribute('aria-expanded',String(open));
  picker.inert=!open;
  if(open){picker.hidden=false;requestAnimationFrame(()=>{if(!picker.inert)picker.classList.add('is-open');});}
  else{picker.classList.remove('is-open');pickerTimer=setTimeout(()=>{picker.hidden=true;},220);}
  if(restoreFocus)$('session-trigger').focus();
}
function updateLiveView(){
  const state=liveConnection();
  document.body.dataset.liveConnected=String(state.online);
  setViewText('picker-live-status',state.online?'Conectado':'Sin señal');
  $('picker-live').setAttribute('aria-current',session?'false':'page');
  if(session)return;
  setViewText('title',state.label);
  setViewText('view-eyebrow','SEGUNDO MONITOR');
  const car=latest?.packet?.carOrdinal>0?latest.carName:null;
  setViewText('session-info',state.online?car||'Forza conectado':'Esperando a Forza');
  setViewText('live-car',state.online?car||'Esperando datos del vehículo':'Listo para tu próxima salida');
  setViewText('live-connection',state.detail);
}
function setViewLayout(isLive){
  document.body.classList.toggle('live-view',isLive);
  $('workspace').hidden=isLive;$('live-workspace').hidden=!isLive;$('player').hidden=isLive;
  $('instant-dashboard').setAttribute('aria-label',isLive?'Instrumentos LIVE en tiempo real':'Indicadores del instante observado');
  if(isLive)$('live-dashboard-host').append($('instant-dashboard'));
  else{document.querySelector('.visual-column').append($('instant-dashboard'));$('view-eyebrow').textContent='ANÁLISIS DE SESIÓN';}
  updateLiveView();
}
function openLiveView(){
  setPlaying(false);clearVideo();session=null;selected.clear();reference=null;t=0;
  allRows=[];allMode=true;videoChoices=[];chartRange=null;scaleCache.clear();legendKey=null;
  $('analysis-nav').hidden=true;$('show-live').hidden=true;$('video-options').hidden=true;
  $('video-options-button').hidden=true;$('video-pane-b').hidden=true;
  $('video-split').classList.remove('two-videos');
  setSessionPicker(false);if(!$('session-menu').hidden)setMenu(false);
  history.replaceState(null,'','#live');setViewLayout(true);draw();
}
function renderPickerSessions(items){
  const container=$('picker-sessions'),scroll=container.scrollTop;container.replaceChildren();
  $('picker-count').textContent=items.length;
  if(!items.length){const empty=document.createElement('p');empty.className='picker-empty';empty.textContent='Tus carreras aparecerán aquí cuando se guarden.';container.append(empty);}
  for(const item of items){
    const button=document.createElement('button');button.className='picker-session';
    button.setAttribute('aria-current',session?.meta.id===item.id?'page':'false');
    const icon=document.createElement('span');icon.className='picker-session-icon';icon.textContent='↗';icon.setAttribute('aria-hidden','true');
    const text=document.createElement('span'),title=document.createElement('b'),meta=document.createElement('small');
    title.textContent=item.name;meta.textContent=new Date(item.created*1000).toLocaleString()+(item.version===2&&!item.ended?' · En curso':'');
    text.append(title,meta);button.append(icon,text);
    button.onclick=action(async()=>{button.disabled=true;try{await load(item.id);setSessionPicker(false);if(!$('session-menu').hidden)setMenu(false);}finally{button.disabled=false;}});
    container.append(button);
  }
  container.scrollTop=scroll;
}
function setupViewUI(){
  $('session-trigger').onclick=()=>setSessionPicker($('session-trigger').getAttribute('aria-expanded')!=='true');
  $('session-trigger').onkeydown=event=>{if(event.key==='ArrowDown'){event.preventDefault();setSessionPicker(true);$('picker-live').focus();}};
  $('picker-live').onclick=openLiveView;
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('.session-switcher'))setSessionPicker(false);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('session-trigger').getAttribute('aria-expanded')==='true')setSessionPicker(false,true);});
  $('session-picker').addEventListener('focusout',()=>{requestAnimationFrame(()=>{if(!document.querySelector('.session-switcher').contains(document.activeElement))setSessionPicker(false);});});
  setInterval(()=>{if(!session){updateLiveView();draw();}},500);
}
