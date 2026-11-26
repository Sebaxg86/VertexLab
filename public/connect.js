'use strict';
const el=id=>document.getElementById(id);
let state=null,step=1,busy=false,polling=false,obsVerified=false,initialized=false,quickMode=false,activeMode=null;
async function request(name,body){const response=await fetch('/api/'+name,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw Error(result.error||'No se pudo completar la operación');return result;}
function error(message){el('connection-error').hidden=!message;el('connection-error').textContent=message||'';el('connection-error').title=message||'';}
function layout(){
 if(activeMode===quickMode)return;activeMode=quickMode;
 document.body.classList.toggle('quick-mode',quickMode);
 el('quick-panel').hidden=!quickMode;
 if(quickMode){el('quick-forza-slot').append(el('forza-step'));el('quick-obs-slot').append(el('obs-step'));el('quick-storage').append(el('storage-settings'));el('quick-actions').append(el('capture-options'));}
 else{el('wizard-content').prepend(el('forza-step'),el('obs-step'));el('ready-storage').append(el('storage-settings'));el('ready-actions').append(el('capture-options'));}
 el('intro-eyebrow').textContent=quickMode?'VERTEXLAB · CONEXIONES':'PRIMERA CONEXIÓN';
 el('intro-title').textContent=quickMode?'Todo listo para conducir.':'Prepara tu próxima sesión.';
}
function render(){
 if(!state?.connect)return;
 const c=state.connect,connected=c.forzaConnected,locked=busy||!!state.recording;
 layout();document.body.dataset.step=String(step);
 el('forza-signal').className='signal '+(connected?'connected':'waiting');
 el('forza-state').textContent=connected?'Forza conectado':'Esperando señal de Forza';
 el('forza-detail').textContent=state.udpError||(connected?'Telemetría recibida · UDP '+c.udpPort:'Activa Data Out y entra al juego.');
 el('quick-forza-dot').dataset.connected=String(connected);el('quick-obs-dot').dataset.connected=String(!c.telemetryOnly&&state.obs.connected);
 el('forza-next').disabled=locked||!connected;
 const only=el('telemetry-only').checked;
 for(const input of el('obs-fields').querySelectorAll('input,button'))input.disabled=locked||only;
 for(const id of ['udp-port','apply-port','telemetry-only','data-path','browse-folder','save-folder','auto-record'])el(id).disabled=locked;
 el('obs-state').textContent=only?'Solo telemetría · sin video':obsVerified&&state.obs.connected?'OBS conectado · listo para grabar':'OBS pendiente de conexión';
 el('obs-next').disabled=locked||(!only&&!(obsVerified&&state.obs.connected));
 el('forza-body').hidden=!quickMode&&step!==1;el('obs-step').hidden=!quickMode&&(step===1||step===3);el('obs-body').hidden=!quickMode&&step!==2;
 el('forza-step').hidden=!quickMode&&step===3;el('ready-step').hidden=quickMode||step!==3;
 el('forza-step').classList.toggle('completed',!quickMode&&step>1);el('forza-check').hidden=quickMode||step<2;
 el('forza-heading').setAttribute('aria-expanded',String(quickMode||step===1));el('obs-heading').setAttribute('aria-expanded',String(quickMode||step===2));
 el('forza-heading').disabled=quickMode;el('obs-heading').disabled=quickMode;
 for(const item of document.querySelectorAll('[data-step]')){item.classList.toggle('current',Number(item.dataset.step)===step);item.classList.toggle('done',Number(item.dataset.step)<step);item.setAttribute('aria-current',Number(item.dataset.step)===step?'step':'false');}
 el('ready-forza').textContent=connected?'Conectado':'Configurado · esperando al juego';
 el('ready-video').textContent=only?'Solo telemetría':state.obs.connected?'Video + telemetría':'OBS pendiente';
 el('open-app').disabled=busy||!c.complete;
 el('intro-status').dataset.ready=String(c.ready);el('intro-status').textContent=state.recording?'SESIÓN EN CURSO':c.ready?'LISTO PARA CAPTURAR':quickMode?'REVISAR CONEXIÓN':'EN TU PC';
 el('footer-status').textContent=state.recording?'Grabando · los ajustes se habilitan al terminar':c.ready?'Conexiones preparadas':'VertexConnect';
}
async function refresh(){if(polling)return;polling=true;try{state=await request('status');if(!state.connect)throw Error('Abre VertexConnect desde su acceso directo.');if(!initialized){initialized=true;el('udp-port').value=state.connect.udpPort;el('obs-port').value=state.connect.obsPort;el('data-path').value=state.connect.dataPath;el('auto-record').checked=state.connect.auto;el('telemetry-only').checked=state.connect.telemetryOnly;obsVerified=state.obs.connected;quickMode=state.connect.complete;step=quickMode?3:1;}if(state.connect.error&&!busy)error(state.connect.error);render();}catch(e){error(e.message);}finally{polling=false;}}
function action(handler){return async()=>{if(busy)return;busy=true;error('');render();try{await handler();await refresh();}catch(e){error(e.message);}finally{busy=false;render();}};}
el('apply-port').onclick=action(async()=>{await request('connect/udp',{port:el('udp-port').value});});
el('forza-next').onclick=action(async()=>{await request('connect/forza',{});step=2;});
el('forza-heading').onclick=()=>{if(!quickMode&&step===2){step=1;render();}};
el('test-obs').onclick=action(async()=>{obsVerified=false;await request('connect/obs',{port:el('obs-port').value,password:el('obs-password').value});el('obs-password').value='';obsVerified=true;if(quickMode)await request('connect/complete',{telemetryOnly:false,auto:el('auto-record').checked});});
for(const id of ['obs-port','obs-password'])el(id).oninput=()=>{obsVerified=false;render();};
el('telemetry-only').onchange=action(async()=>{if(quickMode&&el('telemetry-only').checked)await request('connect/complete',{telemetryOnly:true,auto:el('auto-record').checked});});
el('obs-next').onclick=action(async()=>{await request('connect/complete',{telemetryOnly:el('telemetry-only').checked,auto:el('auto-record').checked});step=3;});
el('save-folder').onclick=action(async()=>{await request('connect/data',{path:el('data-path').value});});
el('auto-record').onchange=action(async()=>{if(state.connect.complete)await request('auto',{enabled:el('auto-record').checked});});
el('open-app').onclick=action(async()=>{quickMode=true;render();if(window.pywebview?.api){await window.pywebview.api.open_vertexlab();}else location.assign('/');});
for(const button of document.querySelectorAll('[data-copy]'))button.onclick=action(async()=>{await navigator.clipboard.writeText(button.dataset.copy);button.dataset.copied='true';setTimeout(()=>delete button.dataset.copied,1200);});
function enableNativeControls(){el('browse-folder').hidden=false;for(const id of ['window-minimize','window-close'])el(id).disabled=false;}
window.addEventListener('pywebviewready',enableNativeControls);
el('window-minimize').onclick=()=>window.pywebview?.api.minimize_window();el('window-close').onclick=()=>window.pywebview?.api.close_window();
for(const id of ['window-minimize','window-close'])el(id).disabled=true;
el('browse-folder').onclick=action(async()=>{const path=await window.pywebview.api.choose_folder();if(path)el('data-path').value=path;});
window.addEventListener('vertexconnectshown',async()=>{await refresh();if(state?.connect.complete){quickMode=true;el('udp-port').value=state.connect.udpPort;el('obs-port').value=state.connect.obsPort;el('data-path').value=state.connect.dataPath;el('auto-record').checked=state.connect.auto;el('telemetry-only').checked=state.connect.telemetryOnly;obsVerified=state.obs.connected;render();}});
// Keep the common controls inside the hidden final step until status arrives.
el('ready-storage').append(el('storage-settings'));el('ready-actions').append(el('capture-options'));
refresh();setInterval(refresh,800);
