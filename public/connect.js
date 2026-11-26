'use strict';
const el=id=>document.getElementById(id);
let state=null,step=1,busy=false,polling=false,obsVerified=false,obsPortInitialized=false;
async function request(name,body){const response=await fetch('/api/'+name,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw Error(result.error||'No se pudo completar la operación');return result;}
function error(message){el('connection-error').hidden=!message;el('connection-error').textContent=message||'';}
function render(){
 if(!state?.connect)return;
 const c=state.connect;
 const connected=c.forzaConnected;
 el('forza-signal').className='signal '+(connected?'connected':'waiting');
 el('forza-state').textContent=connected?'Forza conectado':'Esperando a Forza';
 el('forza-detail').textContent=state.udpError|| (connected?'Recibiendo telemetría válida en el puerto '+c.udpPort:'Activa Data Out, entra al juego y conduce.');
 el('forza-next').disabled=busy||!connected;
 const only=el('telemetry-only').checked;
 for(const input of el('obs-fields').querySelectorAll('input,button'))input.disabled=busy||only;
 el('obs-state').textContent=only?'Se guardará la telemetría, sin video.':obsVerified&&state.obs.connected?'OBS conectado. Listo para grabar.':'Todavía no conectado';
 el('obs-next').disabled=busy||(!only&&!(obsVerified&&state.obs.connected));
 el('forza-body').hidden=step!==1;el('obs-step').hidden=step===1||step===3;el('obs-body').hidden=step!==2;
 el('forza-step').hidden=step===3;el('ready-step').hidden=step!==3;
 el('forza-step').classList.toggle('completed',step>1);el('forza-check').hidden=step<2;
 el('forza-heading').setAttribute('aria-expanded',String(step===1));el('obs-heading').setAttribute('aria-expanded',String(step===2));
 for(const item of document.querySelectorAll('[data-step]')){item.classList.toggle('current',Number(item.dataset.step)===step);item.classList.toggle('done',Number(item.dataset.step)<step);item.setAttribute('aria-current',Number(item.dataset.step)===step?'step':'false');}
 el('ready-forza').textContent=connected?'Conectado':'Configurado · esperando al juego';
 el('ready-video').textContent=only?'Solo telemetría':state.obs.connected?'Video + telemetría':'OBS pendiente de conexión';
 el('open-app').disabled=busy;
 el('footer-status').textContent=state.recording?'Grabando sesión':c.ready?'Listo para capturar':'Configuración inicial';
}
async function refresh(){if(polling)return;polling=true;try{state=await request('status');if(!state.connect)throw Error('Esta instancia no es VertexConnect. Abre VertexConnect desde su acceso directo.');if(!obsPortInitialized){obsPortInitialized=true;el('udp-port').value=state.connect.udpPort;el('obs-port').value=state.connect.obsPort;el('data-path').value=state.connect.dataPath;el('auto-record').checked=state.connect.auto;el('telemetry-only').checked=state.connect.telemetryOnly;obsVerified=state.obs.connected;step=state.connect.complete?3:1;}render();}catch(e){error(e.message);}finally{polling=false;}}
function action(handler){return async()=>{if(busy)return;busy=true;error('');render();try{await handler();await refresh();}catch(e){error(e.message);}finally{busy=false;render();}};}
el('apply-port').onclick=action(async()=>{await request('connect/udp',{port:el('udp-port').value});});
el('forza-next').onclick=action(async()=>{await request('connect/forza',{});step=2;});
el('forza-heading').onclick=()=>{if(step===2){step=1;render();}};
el('test-obs').onclick=action(async()=>{obsVerified=false;await request('connect/obs',{port:el('obs-port').value,password:el('obs-password').value});el('obs-password').value='';obsVerified=true;});
for(const id of ['obs-port','obs-password'])el(id).oninput=()=>{obsVerified=false;render();};
el('telemetry-only').onchange=()=>render();
el('obs-next').onclick=action(async()=>{await request('connect/complete',{telemetryOnly:el('telemetry-only').checked,auto:el('auto-record').checked});step=3;el('data-path').value=state.connect.dataPath;});
el('save-folder').onclick=action(async()=>{await request('connect/data',{path:el('data-path').value});});
el('auto-record').onchange=action(async()=>{await request('auto',{enabled:el('auto-record').checked});});
el('review').onclick=()=>{step=1;error('');render();};
el('open-app').onclick=action(async()=>{if(window.pywebview?.api){await window.pywebview.api.open_vertexlab();}else location.assign('/');});
for(const button of document.querySelectorAll('[data-copy]'))button.onclick=action(async()=>{await navigator.clipboard.writeText(button.dataset.copy);button.textContent='Copiado';setTimeout(()=>button.textContent='Copiar',1500);});
window.addEventListener('pywebviewready',()=>{el('browse-folder').hidden=false;});
el('browse-folder').onclick=action(async()=>{const path=await window.pywebview.api.choose_folder();if(path)el('data-path').value=path;});
refresh();setInterval(refresh,800);
