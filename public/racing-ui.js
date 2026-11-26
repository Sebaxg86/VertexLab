const RaceIcons={
 play:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 4 12 8-12 8Z"/></svg>',
 pause:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6ZM14 4h4v16h-4Z"/></svg>',
 volume:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4ZM17 8q6 4 0 8"/></svg>',
 muted:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4ZM17 9l5 6m0-6-5 6"/></svg>',
 flag:'<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 17V3m0 0h12v9H4"/><path d="M4 3h4v3H4Zm8 0h4v3h-4ZM8 6h4v3H8Zm-4 3h4v3H4Zm8 0h4v3h-4Z" fill="currentColor" stroke="none"/></svg>'
};
const headerTimers=new Map();let manualBusy=false;
function setHeaderDrop(id,triggerId,open){
  const panel=$(id),trigger=$(triggerId);clearTimeout(headerTimers.get(id));
  trigger.setAttribute('aria-expanded',String(open));panel.inert=!open;
  if(open){panel.hidden=false;requestAnimationFrame(()=>{if(!panel.inert)panel.classList.add('is-open');});}
  else{panel.classList.remove('is-open');headerTimers.set(id,setTimeout(()=>{panel.hidden=true;},190));}
}
function syncCaptureControls(state){
  const recording=!!state?.recording;
  $('record').hidden=recording;$('stop').hidden=!recording;
  $('record').disabled=manualBusy;$('stop').disabled=manualBusy;
  $('record-name-trigger').disabled=recording||manualBusy;
  if(recording&&state.sessionName)setViewText('record-name-label',state.sessionName);
  else if(!$('name').value.trim())setViewText('record-name-label','Nombrar sesión');
  $('capture-state').dataset.mode=state?.mode||'idle';
  setViewText('capture-state',recording?(state.mode==='paused'?'PAUSA · ':'REC · ')+(state.elapsed||0).toFixed(1)+' s':'');
}
function setupRacingUI(){
  $('open-vertexconnect').onclick=action(async()=>{setMenu(false);const result=await api('connect/show',{});if(!result.nativeWindow)throw Error('Abre VertexConnect desde el acceso directo de VertexLab.');});
  $('analysis-settings').prepend($('feature-session'));

  const closeName=()=>setHeaderDrop('record-name-menu','record-name-trigger',false);
  const saveName=()=>{setViewText('record-name-label',$('name').value.trim()||'Nombrar sesión');closeName();$('record-name-trigger').focus();};
  $('record-name-trigger').onclick=()=>{setMenu(false);const open=$('record-name-trigger').getAttribute('aria-expanded')!=='true';setHeaderDrop('record-name-menu','record-name-trigger',open);if(open)$('name').focus();};
  $('name-done').onclick=saveName;
  $('name').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();saveName();}};
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('.settings-wrap'))setMenu(false);if(!event.target.closest('.record-name-wrap'))closeName();});
  document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if($('settings-toggle').getAttribute('aria-expanded')==='true'){setMenu(false);$('settings-toggle').focus();}if($('record-name-trigger').getAttribute('aria-expanded')==='true'){closeName();$('record-name-trigger').focus();}});
  for(const [panel,trigger] of [['settings-panel','settings-toggle'],['record-name-menu','record-name-trigger']])$(panel).addEventListener('focusout',()=>requestAnimationFrame(()=>{if(!$(panel).parentElement.contains(document.activeElement))setHeaderDrop(panel,trigger,false);}));
  syncCaptureControls(null);
}
