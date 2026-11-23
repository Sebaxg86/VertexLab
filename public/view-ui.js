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
  $('manual-controls').hidden=!isLive;document.querySelector('.settings-wrap').hidden=false;
  $('live-settings').hidden=!isLive;$('analysis-settings').hidden=isLive;
  $('settings-title').textContent=isLive?'CONTROL DE CAPTURA':'SESIÓN / ANÁLISIS';
  $('settings-panel').setAttribute('aria-label',isLive?'Configuración de LIVE':'Configuración de la sesión');
  $('settings-toggle').setAttribute('aria-label',isLive?'Configuración de LIVE':'Configuración de la sesión');
  setMenu(false);setHeaderDrop('record-name-menu','record-name-trigger',false);
  $('workspace').hidden=isLive;$('live-workspace').hidden=!isLive;$('player').hidden=isLive;
  $('instant-dashboard').setAttribute('aria-label',isLive?'Instrumentos LIVE en tiempo real':'Indicadores del instante observado');
  if(isLive)$('live-dashboard-host').append($('instant-dashboard'));
  else{document.querySelector('.visual-column').append($('instant-dashboard'));$('view-eyebrow').textContent='ANÁLISIS DE SESIÓN';}
  updateLiveView();
}
function openLiveView(){
  clearAnalysisHover();preferredMapLap=null;
  setPlaying(false);clearVideo();session=null;selected.clear();reference=null;t=0;
  allRows=[];allMode=true;videoChoices=[];chartRange=null;scaleCache.clear();legendKey=null;
  $('analysis-nav').hidden=true;$('video-options').hidden=true;
  $('video-options-button').hidden=true;$('video-pane-b').hidden=true;
  $('video-split').classList.remove('two-videos');
  setSessionPicker(false);setMenu(false);
  history.replaceState(null,'','#live');setViewLayout(true);draw();
}
function renderPickerSessions(items){
  const container=$('picker-sessions'),scroll=container.scrollTop;container.replaceChildren();
  $('picker-count').textContent=items.length;
  if(!items.length){const empty=document.createElement('p');empty.className='picker-empty';empty.textContent='Tus carreras aparecerán aquí cuando se guarden.';container.append(empty);}
  for(const item of items){
    const button=document.createElement('button');button.className='picker-session';
    button.setAttribute('aria-current',session?.meta.id===item.id?'page':'false');
    const preview=document.createElement('span');preview.className='picker-route';
    if(item.preview?.path){
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');
      svg.setAttribute('viewBox','0 0 96 64');svg.setAttribute('role','img');
      const routeLabel=item.preview.source==='session'?'Trazada de la sesión libre':`Trazada de la ${item.preview.recordedLap===1?'primera':'segunda'} vuelta`+(item.preview.partial?' · parcial':'');
      svg.setAttribute('aria-label',routeLabel);
      path.setAttribute('d',item.preview.path);svg.append(path);preview.append(svg);
      preview.title=routeLabel;
    }else{preview.textContent='Sin trazada';preview.classList.add('empty-route');}
    const brand=document.createElement('span');brand.className='picker-brand';
    if(item.brand?.logo){
      const logo=document.createElement('img');logo.src=item.brand.logo;logo.alt=item.brand.name;logo.width=38;logo.height=32;logo.loading='lazy';if(item.brand.logo.endsWith('.svg'))logo.className='brand-vector';
      logo.onerror=()=>{brand.textContent=item.brand.name;brand.classList.add('brand-text');};brand.append(logo);
    }else{brand.textContent='—';brand.title='Marca sin identificar';}
    const text=document.createElement('span');text.className='picker-session-text';
    const title=document.createElement('b'),date=document.createElement('small');
    const knownCar=item.carName&&!item.carName.startsWith('Vehículo #');
    title.textContent=knownCar?item.carName:item.name;
    if(knownCar&&item.name!==item.carName){const label=document.createElement('span');label.className='picker-custom-name';label.textContent=item.name;text.append(label);}
    date.textContent=new Date(item.created*1000).toLocaleString()+(item.version===2&&!item.ended?' · En curso':'');
    if(item.featured){const star=document.createElement('span');star.className='session-star';star.textContent='★';star.setAttribute('aria-label','Sesión destacada');title.append(star);}
    text.prepend(title);text.append(date);button.append(preview,brand,text);
    button.onclick=action(async()=>{button.disabled=true;try{await load(item.id);setSessionPicker(false);setMenu(false);}finally{button.disabled=false;}});
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
