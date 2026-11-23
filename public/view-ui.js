/* The LIVE clock is based on packet arrival, never on saved session data. */
(function(root){
  function connection(state,now,stream=true){
    const age=now-(state?.lastPacket??-Infinity);
    const online=!!(stream&&state?.packet&&!state.udpError&&age>=0&&age<2);
    return {online,active:online&&!!state.packet.active,label:online?'LIVE':'OFF LIVE',detail:!stream?'Servidor desconectado · reconectando…':state?.udpError?'No se pudo abrir el receptor UDP':online?state.packet.active?'Recibiendo telemetría en tiempo real':'Forza conectado · juego en pausa o menú':'Sin señal de Forza · esperando Data Out'};
  }
  root.RaceConnection={connection};
  if(typeof module!=='undefined')module.exports=root.RaceConnection;
})(globalThis);
let pickerTimer,streamConnected=false;
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
  const state=RaceConnection.connection(latest,Date.now()/1000,streamConnected);
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
