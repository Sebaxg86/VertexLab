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
let manualRequestedName='',manualDialogTimer=null;
function closeManualRecordingDialog(){
 const dialog=$('manual-record-dialog');if(!dialog.open||dialog.classList.contains('is-closing'))return;
 dialog.classList.add('is-closing');clearTimeout(manualDialogTimer);
 manualDialogTimer=setTimeout(()=>{dialog.close();dialog.classList.remove('is-closing');if(!latest?.recording&&!homeActive&&!session)$('record-name-trigger').focus({preventScroll:true});},180);
}
function requestManualRecording(){
 if(manualBusy||latest?.recording||!liveConnection().online)return;
 manualRequestedName=$('name').value.trim();
 setHeaderDrop('record-name-menu','record-name-trigger',false);
 $('manual-record-summary').textContent=manualRequestedName||'Se asignará un nombre automático a esta sesión.';
 $('manual-record-error').hidden=true;clearTimeout(manualDialogTimer);
 const dialog=$('manual-record-dialog');dialog.classList.remove('is-closing');dialog.showModal();$('manual-record-cancel').focus();
}
function syncCaptureControls(state){
 const recording=!!state?.recording,controls=$('manual-controls');
 controls.dataset.recording=String(recording);
 $('record').disabled=manualBusy||recording;$('stop').hidden=!recording;$('stop').disabled=manualBusy;
 $('record-name-trigger').disabled=recording||manualBusy;
 setViewText('record-name-label','Grabación Manual');
 if(recording&&$('record-name-trigger').getAttribute('aria-expanded')==='true')setHeaderDrop('record-name-menu','record-name-trigger',false);
 $('capture-state').dataset.mode=state?.mode||'idle';
 const elapsed=Math.max(0,state?.elapsed||0),minutes=Math.floor(elapsed/60),seconds=Math.floor(elapsed%60);
 setViewText('capture-state',recording?(state.mode==='paused'?'PAUSA · ':'')+String(minutes).padStart(2,'0')+':'+String(seconds).padStart(2,'0'):'');
 $('auto-detection-indicator').dataset.active=String(!!state?.auto);setViewText('auto-detection-label',state?.auto?'Activa':'Inactiva');
 $('manual-record-confirm').disabled=manualBusy||recording;$('manual-record-cancel').disabled=manualBusy;
 if(recording&&$('manual-record-dialog').open&&!manualBusy)closeManualRecordingDialog();
}
function setupRacingUI(){
  $('open-vertexconnect').onclick=action(async()=>{setMenu(false);const result=await api('connect/show',{});if(!result.nativeWindow)throw Error('Abre VertexConnect desde el acceso directo de VertexLab.');});
  $('analysis-settings').prepend($('feature-session'));

  const closeName=()=>setHeaderDrop('record-name-menu','record-name-trigger',false);
  $('record-name-trigger').onclick=()=>{setMenu(false);const open=$('record-name-trigger').getAttribute('aria-expanded')!=='true';setHeaderDrop('record-name-menu','record-name-trigger',open);if(open)$('name').focus();};
  $('name').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();requestManualRecording();}};
  $('manual-record-cancel').onclick=closeManualRecordingDialog;
  $('manual-record-dialog').addEventListener('cancel',event=>{event.preventDefault();if(!manualBusy)closeManualRecordingDialog();});
  document.addEventListener('pointerdown',event=>{if(!event.target.closest('.settings-wrap,#settings-panel,#analysis-menu-backdrop'))setMenu(false);if(!event.target.closest('.record-name-wrap'))closeName();});
  document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;if($('settings-toggle').getAttribute('aria-expanded')==='true'){setMenu(false);$('settings-toggle').focus();}if($('record-name-trigger').getAttribute('aria-expanded')==='true'){closeName();$('record-name-trigger').focus();}});
  $('settings-panel').addEventListener('focusout',()=>requestAnimationFrame(()=>{const active=document.activeElement;if(!$('settings-panel').contains(active)&&!$('settings-toggle').contains(active))setMenu(false);}));
  $('record-name-menu').addEventListener('focusout',()=>requestAnimationFrame(()=>{if(!$('record-name-menu').parentElement.contains(document.activeElement))setHeaderDrop('record-name-menu','record-name-trigger',false);}));
  syncCaptureControls(null);
}
