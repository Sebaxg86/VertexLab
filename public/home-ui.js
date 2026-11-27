let homeActive=true,homeMenuTrigger=null,homeDeleteTarget=null,homeExportMode=false,homeAllSelected=false,homeSelectingAll=false;
const homeExportSelection=new Map();
const HomeGlyphs={
 export:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3m-5 5 5-5 5 5M4 15v6h16v-6"/></svg>',
 computer:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1"/><path d="M8 21h8m-4-5v5"/></svg>',
 cloud:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18a4 4 0 0 1-.3-8A6.5 6.5 0 0 1 18 8a5 5 0 0 1 0 10Z"/></svg>',
 star:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1Z"/></svg>',
 remove:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></svg>'
};
function updateHomeLive(){
 if(!$('home-live-entry'))return;
 const browser=!!globalThis.VertexBrowser?.enabled,online=!browser&&liveConnection().online;
 $('home-live-entry').dataset.online=String(online||browser);
 setViewText('home-live-title',browser?'LIVE DEMO':online?'LIVE':'OFFLINE');
 renderLiveVehicle('home-live-description',online,browser?'Prueba la telemetría en tiempo real con un 2022 Toyota GR86. Para capturar tus carreras usa VertexConnect en Windows.':online?liveCarMemory?.name||'Forza conectado.':'Esperando señal de Forza');
 const enter=$('home-live-entry').querySelector('.home-enter');
 if(enter)enter.firstChild.textContent=browser?'PROBAR TELEMETRÍA EN TIEMPO REAL ':'ENTRAR AL TABLERO ';
 $('home-live-entry').setAttribute('aria-label',browser?'Probar telemetría en tiempo real demo':online?'Entrar a LIVE, Forza conectado':'Entrar al tablero, OFFLINE');
}
function openHome(){
 globalThis.VertexMobileFocus?.exit?.(false);
 globalThis.VertexBrowser?.stopLiveDemo?.();
 openLiveView();homeActive=true;revSweepState=null;
 document.body.classList.add('home-view');$('lab-home').hidden=false;
 $('workspace').hidden=true;$('live-workspace').hidden=true;$('player').hidden=true;
 history.replaceState(null,'','#home');closeHomeMenus();updateHomeLive();HomeLibrary.render(true);
}
let homeBackdropTimer=null;
function homeBackdrop(){
 let el=$('home-popover-backdrop');
 if(!el){
  el=document.createElement('div');
  el.id='home-popover-backdrop';
  el.className='home-popover-backdrop';
  el.setAttribute('aria-hidden','true');
  el.hidden=true;
  el.addEventListener('pointerdown',event=>{event.stopPropagation();});
  el.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();closeHomeMenus();});
  document.body.append(el);
 }
 return el;
}
function setHomeBackdrop(open){
 if(open&&!matchMedia('(max-width:600px)').matches)return;
 const el=$('home-popover-backdrop')||(open?homeBackdrop():null);
 if(!el)return;
 clearTimeout(homeBackdropTimer);
 if(open){
  el.hidden=false;
  requestAnimationFrame(()=>{if(!el.hidden)el.classList.add('is-open');});
 }else{
  el.classList.remove('is-open');
  homeBackdropTimer=setTimeout(()=>{el.hidden=true;},200);
 }
}
function closeHomeMenus(){
 for(const [panelId,triggerId] of [['home-cloud-menu','home-cloud-trigger'],['home-profile-menu','home-account-trigger'],['home-import-menu','home-import'],['home-row-menu',homeMenuTrigger]]){
  const panel=$(panelId),trigger=triggerId&&$(triggerId);
  if(trigger)setHeaderDrop(panelId,triggerId,false);else if(panel){panel.classList.remove('is-open');panel.inert=true;panel.hidden=true;}
 }
 setHomeBackdrop(false);
}
function positionHomeMenu(panel,trigger){
 const rect=trigger.getBoundingClientRect(),width=panel.offsetWidth||312,height=panel.offsetHeight;
 panel.style.left=Math.max(12,Math.min(innerWidth-width-12,rect.right-width))+'px';
 panel.style.top=Math.max(12,rect.bottom+height+12>innerHeight?rect.top-height-8:rect.bottom+8)+'px';
 setHomeBackdrop(true);
}
function openHomeSessionMenu(item,trigger){
 const open=trigger.getAttribute('aria-expanded')!=='true';closeHomeMenus();if(!open)return;
 homeMenuTrigger=trigger.id;
 const menu=$('home-row-menu');menu.replaceChildren();
 const caption=document.createElement('span');caption.className='home-menu-caption';caption.textContent='OPCIONES DE SESIÓN';menu.append(caption);
 const cloudState=globalThis.VertexCloud?.actionState?.();
 const baseActions=VertexHomeModel.actions(item,latest?.recording,cloudState);
 for(const option of [...baseActions.slice(0,1),{key:'export',label:'Exportar sesión',enabled:VertexHomeModel.availability(item).local&&item.id!==latest?.recording},...baseActions.slice(1)]){
  const button=document.createElement('button');button.disabled=!option.enabled;
  if(option.danger)button.classList.add('danger-action');
  button.innerHTML=option.key==='export'?HomeGlyphs.export:option.key==='favorite'?HomeGlyphs.star:option.key.startsWith('delete')?HomeGlyphs.remove:HomeGlyphs.cloud;
  const text=document.createElement('span');text.textContent=option.label;
  if(option.soon){const note=document.createElement('small');note.textContent='Conecta Google Drive';text.append(note);}
  button.append(text);
  if(option.key==='export')button.onclick=action(async()=>{await exportLibrarySessions([item]);});
  if(option.key==='sync')button.onclick=action(async()=>{closeHomeMenus();$('message').textContent='Subiendo sesión a Google Drive…';await VertexCloud.syncSession(item.id);});
  if(option.key==='download')button.onclick=action(async()=>{closeHomeMenus();$('message').textContent='Descargando sesión desde Google Drive…';await VertexCloud.downloadSession(item.id);});
  if(option.key==='favorite')button.onclick=action(async()=>{closeHomeMenus();const result=await api('feature/'+item.id,{featured:!item.featured});item.featured=result.featured;HomeLibrary.changed(item);$('home-settings-'+item.id)?.focus({preventScroll:true});});
  if(option.key==='delete-local'||option.key==='delete-cloud'||option.key==='delete-all')button.onclick=()=>{
   closeHomeMenus();homeDeleteTarget={item,scope:option.key};
   const browser=!!globalThis.VertexBrowser?.enabled,avail=VertexHomeModel.availability(item);
   $('home-delete-title').textContent=option.key==='delete-all'?'¿Eliminar definitivamente?':option.key==='delete-cloud'?'¿Eliminar de Google Drive?':'¿Eliminar de este dispositivo?';
   $('home-delete-description').textContent=item.name||item.carName||'Sesión';
   if(option.key==='delete-cloud'){
    $('home-delete-warning').textContent=avail.local?'Se eliminará únicamente el respaldo en Google Drive. Tu copia local en este dispositivo se conserva.':'Se eliminará el respaldo en Google Drive. Esta sesión no está descargada en este dispositivo y esta acción no se puede deshacer.';
    $('home-delete-confirm').textContent='Eliminar de Google Drive';
   }else if(option.key==='delete-all'&&avail.cloud){
    $('home-delete-warning').textContent='Se eliminarán definitivamente tanto la copia en este dispositivo como el respaldo en Google Drive. Esta acción no se puede deshacer.';
    $('home-delete-confirm').textContent='Eliminar de todos lados';
   }else if(avail.cloud){
    $('home-delete-warning').textContent='Se eliminará únicamente la copia local en este dispositivo para liberar espacio. Tu respaldo en Google Drive se conserva y podrás seguir viéndolo en streaming o descargarlo de nuevo.';
    $('home-delete-confirm').textContent='Eliminar copia local';
   }else{
    $('home-delete-warning').textContent=browser?'Se eliminará la copia guardada por VertexLab y su registro en la biblioteca. El archivo .vrtx original que importaste se conserva. No hay un respaldo en Google Drive.':'Se eliminarán la telemetría y el video asociados a esta sesión. No hay un respaldo en Google Drive. Esta acción no se puede deshacer.';
    $('home-delete-confirm').textContent=browser?'Eliminar copia local':'Eliminar sesión y video';
   }
   $('home-delete-error').hidden=true;$('home-delete-dialog').showModal();$('home-delete-cancel').focus();
  };
  menu.append(button);
 }
 setHeaderDrop('home-row-menu',trigger.id,true);positionHomeMenu(menu,trigger);
}
function applyCloudProgress(status,item){
 const job=globalThis.VertexCloud?.jobFor?.(item.id);
 const state=VertexHomeModel.availability(item);
 if(job){
  const pct=Math.max(0,Math.min(100,Math.round(job.percent||0)));
  const r=10,c=2*Math.PI*r,offset=c*(1-pct/100);
  status.classList.add('is-syncing');
  status.classList.remove('available');
  status.innerHTML=`<svg class="cloud-progress-ring" viewBox="0 0 26 26" aria-hidden="true"><circle class="ring-track" cx="13" cy="13" r="${r}"/><circle class="ring-fill" cx="13" cy="13" r="${r}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"/></svg><b class="cloud-progress-pct">${pct}</b>`;
  const label=`${job.phase||'Sincronizando'} · ${pct}%`;
  status.setAttribute('aria-label',label);status.title=label;
 }else{
  status.classList.remove('is-syncing');
  status.innerHTML=HomeGlyphs.cloud;
  status.classList.toggle('available',state.cloud);
  const label=state.cloud?'Respaldada en Google Drive':'Sin respaldo en Google Drive';
  status.setAttribute('aria-label',label);status.title=label;
 }
}
function createAvailability(item){
  const availability=document.createElement('div');availability.className='home-availability';const state=VertexHomeModel.availability(item);
  for(const [key,icon,active,label] of [['local',HomeGlyphs.computer,state.local,state.temporary?'Disponible temporalmente en este dispositivo':'Disponible en este dispositivo'],['cloud',HomeGlyphs.cloud,state.cloud,'Respaldada en Google Drive']]){
   const status=document.createElement('span');status.dataset.storage=key;status.setAttribute('role','img');
   if(key==='cloud'){applyCloudProgress(status,item);}
   else{status.innerHTML=icon;status.classList.toggle('available',active);status.setAttribute('aria-label',active?label:'No disponible en este dispositivo');status.title=status.getAttribute('aria-label');}
   availability.append(status);
  }
 return availability;
}
const HomeLibrary=(()=>{
 const ROW=112,PAGE=12;
 let items=[],total=null,nextOffset=0,pending=null,generation=0,failed=false,renderKey='',scheduled=false,pickerLimit=12;
 const cards=new Map();
 function visiblePicker(){return !$('session-picker').hidden&&!$('session-picker').inert;}
 function renderPicker(){renderPickerSessions(items.slice(0,pickerLimit));$('picker-count').textContent=total??items.length;}
 function changed(item){const index=items.findIndex(row=>row.id===item.id);if(index>=0)items[index]=item;cards.delete(item.id);render(true);if(visiblePicker())renderPicker();}
 function removed(id){homeExportSelection.delete(id);syncHomeExportControls();const index=items.findIndex(item=>item.id===id);if(index<0)return;items.splice(index,1);cards.delete(id);total=Math.max(0,(total||0)-1);if(nextOffset!==null)nextOffset=Math.max(0,nextOffset-1);render(true);if(visiblePicker())renderPicker();if(!items.length&&nextOffset!==null)loadMore();}
 function row(item,index){
  let card=cards.get(item.id);if(card){syncHomeExportRow(card,item);return card;}
  card=document.createElement('article');card.className='home-session-row'+(item.featured?' is-featured':'');card.setAttribute('role','listitem');card.dataset.id=item.id;
  const button=createSessionButton(item);button.className='home-session-main';button.id='home-open-'+item.id;button.title=item.name||item.carName;button.setAttribute('aria-label','Analizar '+(item.name||item.carName));
  button.onclick=action(async()=>{if(homeExportMode){toggleHomeExport(item);return;}button.disabled=true;closeHomeMenus();try{await transitionView(()=>load(item.id));}finally{button.disabled=false;}});
  const availability=createAvailability(item);
  const gear=document.createElement('button');gear.id='home-settings-'+item.id;gear.className='home-row-settings';gear.innerHTML=$('settings-toggle').innerHTML;
  gear.setAttribute('aria-label','Opciones de '+(item.name||item.carName));gear.setAttribute('aria-expanded','false');gear.setAttribute('aria-controls','home-row-menu');gear.onclick=()=>openHomeSessionMenu(item,gear);
  const check=document.createElement('input');check.type='checkbox';check.className='home-export-check';check.setAttribute('aria-label','Seleccionar '+(item.name||item.carName)+' para exportar');check.onchange=()=>toggleHomeExport(item,check.checked);card.append(check,button,availability,gear);syncHomeExportRow(card,item);cards.set(item.id,card);return card;
 }
 function render(force=false){
  setViewText('home-library-count',total===null?'…':String(total));
  const empty=total===0&&!pending&&!failed;$('home-library-empty').hidden=!empty;$('home-library-scroll').hidden=empty;
  $('home-library-status').dataset.loading=String(!!pending);
  setViewText('home-library-status',failed?'No se pudo cargar la biblioteca.':pending?'Cargando sesiones…':nextOffset===null?'':'Desliza para ver más sesiones');
  $('home-library-retry').hidden=!failed;
  if(!homeActive)return;
  const scroll=$('home-library-scroll'),range=VertexHomeModel.windowRange(items.length,scroll.scrollTop,scroll.clientHeight,ROW);
  const key=[generation,range.start,range.end,items.length,total].join(':');if(!force&&key===renderKey)return;renderKey=key;
  const focused=document.activeElement?.closest('#home-library-rows')?document.activeElement.id:null;
  const container=$('home-library-rows');
  let top=container.querySelector('[data-spacer="top"]'),bottom=container.querySelector('[data-spacer="bottom"]');
  if(!top){top=document.createElement('div');top.dataset.spacer='top';top.setAttribute('aria-hidden','true');container.prepend(top);}
  if(!bottom){bottom=document.createElement('div');bottom.dataset.spacer='bottom';bottom.setAttribute('aria-hidden','true');container.append(bottom);}
  top.style.height=range.top+'px';bottom.style.height=range.bottom+'px';
  const nodes=[],keep=new Map();
  for(let i=range.start;i<range.end;i++){const item=items[i],card=row(item,i);card.setAttribute('aria-posinset',i+1);card.setAttribute('aria-setsize',total??items.length);nodes.push(card);keep.set(item.id,card);}
  for(const node of [...container.children])if(node.dataset.id&&keep.get(node.dataset.id)!==node)node.remove();
  let cursor=top.nextSibling;
  for(const card of nodes){if(card===cursor)cursor=cursor.nextSibling;else container.insertBefore(card,cursor||bottom);}
  for(const id of cards.keys())if(!keep.has(id))cards.delete(id);
  if(focused){const target=$(focused)||scroll;target.focus({preventScroll:true});}
 }
 async function loadMore(){
  if(pending)return pending;if(nextOffset===null)return;
  const token=generation,offset=nextOffset;failed=false;
  const task=api('library?offset='+offset+'&limit='+PAGE).then(page=>{
   if(token!==generation)return;
   const ids=new Set(items.map(item=>item.id));for(const item of page.items){headerBrands.set(item.carOrdinal,item.brand);if(!ids.has(item.id)){items.push(item);ids.add(item.id);}}
   total=page.total;nextOffset=page.nextOffset;renderHeaderBrand();if(visiblePicker())renderPicker();
  }).catch(error=>{if(token===generation){failed=true;$('message').textContent=error.message;}}).finally(()=>{if(token===generation){pending=null;render(true);}});
  pending=task;render();return task;
 }
 async function refresh(){
  homeAllSelected=false;syncHomeExportControls();
  generation++;pending=null;nextOffset=0;total=null;items=[];cards.clear();renderKey='';pickerLimit=12;
  closeHomeMenus();$('home-library-scroll').scrollTop=0;return loadMore();
 }
 function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;render();const scroll=$('home-library-scroll');if(scroll.scrollTop+scroll.clientHeight>=items.length*ROW-ROW*2)loadMore();});}
 async function morePicker(){if(pending)return;if(pickerLimit<items.length){pickerLimit+=PAGE;renderPicker();}else if(nextOffset!==null){pickerLimit+=PAGE;await loadMore();renderPicker();}}
 return {refresh,loadMore,render,changed,removed,renderPicker,morePicker,schedule};
})();
function setupHome(){
 $('lab-logo').onclick=()=>transitionView(openHome);$('lab-logo').onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();transitionView(openHome);}};
 $('home-live-entry').onclick=()=>{if(globalThis.VertexBrowser?.enabled){transitionView(()=>VertexBrowser.openLiveDemo());return;}enterHomeLive();};
 $('home-empty-import').onclick=()=>$('portable-file').click();
 $('home-import').classList.add('home-menu-trigger');
 $('home-import').onclick=()=>{const open=$('home-import').getAttribute('aria-expanded')!=='true';closeHomeMenus();if(open){setHeaderDrop('home-import-menu','home-import',true);positionHomeMenu($('home-import-menu'),$('home-import'));}};
 $('home-import-vrtx').onclick=()=>{closeHomeMenus();$('portable-file').click();};
 $('home-import-zip').onclick=()=>{closeHomeMenus();$('portable-bundle').click();};
 $('portable-bundle').onchange=async()=>{const file=$('portable-bundle').files[0];$('portable-bundle').value='';if(file)try{await importLibraryBundle(file);}catch(error){$('message').textContent=error.message;}};
 $('home-export').onclick=()=>setHomeExportMode(!homeExportMode);
 $('home-export-cancel').onclick=()=>setHomeExportMode(false);
 $('home-export-confirm').onclick=action(async()=>{if(await exportLibrarySessions([...homeExportSelection.values()]))setHomeExportMode(false);});
 $('home-select-all').onchange=async()=>{
  if(homeSelectingAll)return;
  if(!$('home-select-all').checked){homeExportSelection.clear();homeAllSelected=false;syncHomeExportControls();HomeLibrary.render(true);return;}
  homeSelectingAll=true;syncHomeExportControls();
  try{
   const selection=new Map();let offset=0;
   do{const page=await api('library?offset='+offset+'&limit=48');for(const item of page.items)if(VertexHomeModel.availability(item).local&&item.id!==latest?.recording)selection.set(item.id,item);offset=page.nextOffset;}while(offset!==null);
   if(homeExportMode){homeExportSelection.clear();for(const [id,item] of selection)homeExportSelection.set(id,item);homeAllSelected=true;}
  }catch(error){$('message').textContent=error.message;}
  finally{homeSelectingAll=false;syncHomeExportControls();HomeLibrary.render(true);}
 };
 syncHomeExportControls();
 $('home-cloud-trigger').onclick=()=>{const open=$('home-cloud-trigger').getAttribute('aria-expanded')!=='true';closeHomeMenus();if(open){globalThis.VertexCloud?.renderMenu?.();setHeaderDrop('home-cloud-menu','home-cloud-trigger',true);positionHomeMenu($('home-cloud-menu'),$('home-cloud-trigger'));}};
 globalThis.VertexCloud?.init?.().then(()=>{VertexCloud.pollJobs?.();return HomeLibrary.refresh();}).catch(()=>{});
 globalThis.VertexCloud?.onJobUpdate?.(()=>{
  for(const row of $('home-library-rows').children){
   if(!row.dataset.id)continue;
   const status=row.querySelector('[data-storage="cloud"]');
   if(status)applyCloudProgress(status,{id:row.dataset.id,availability:{cloud:status.classList.contains('available')}});
  }
 });
 $('home-library-scroll').addEventListener('scroll',()=>{closeHomeMenus();HomeLibrary.schedule();},{passive:true});
 new ResizeObserver(()=>HomeLibrary.schedule()).observe($('home-library-scroll'));
 $('picker-sessions').addEventListener('scroll',()=>{const box=$('picker-sessions');if(box.scrollTop+box.clientHeight>=box.scrollHeight-100)HomeLibrary.morePicker();},{passive:true});
 $('home-library-retry').onclick=()=>HomeLibrary.loadMore();
 document.addEventListener('pointerdown',event=>{if(!event.target.closest('.home-popover,.home-menu-trigger,.home-row-settings,.home-account-trigger'))closeHomeMenus();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'){const target=homeMenuTrigger&&$(homeMenuTrigger);closeHomeMenus();if(target?.isConnected)target.focus({preventScroll:true});}});
 window.addEventListener('resize',closeHomeMenus);
 $('home-delete-cancel').onclick=()=>{const id=homeDeleteTarget?.item?.id;$('home-delete-dialog').close();homeDeleteTarget=null;id&&$('home-settings-'+id)?.focus({preventScroll:true});};
 $('home-delete-confirm').onclick=async()=>{
  if(!homeDeleteTarget)return;const {item:target,scope}=homeDeleteTarget;const state=VertexHomeModel.availability(target);$('home-delete-confirm').disabled=true;$('home-delete-error').hidden=true;
  try{
   if(scope!=='delete-cloud'&&state.local)await api('delete/'+target.id,{confirm:true,removeLocal:true});
   if((scope==='delete-cloud'||scope==='delete-all')&&state.cloud)await VertexCloud.deleteCloudSession(target.id,target.cloud?.driveFolderId);
   $('home-delete-dialog').close();homeDeleteTarget=null;
   if(scope==='delete-cloud'&&state.local){await HomeLibrary.refresh();$('message').textContent='Respaldo eliminado de Google Drive. Tu copia local se conserva.';}
   else if(scope==='delete-local'&&state.cloud){await HomeLibrary.refresh();$('message').textContent='Copia local eliminada. Tu respaldo en Google Drive se conserva.';}
   else{HomeLibrary.removed(target.id);$('message').textContent=scope==='delete-cloud'?'Sesión eliminada de Google Drive.':scope==='delete-all'&&state.cloud?'Sesión eliminada de este dispositivo y de Google Drive.':'Sesión eliminada de este dispositivo.';}
  }
  catch(error){$('home-delete-error').textContent=error.message;$('home-delete-error').hidden=false;}
  finally{$('home-delete-confirm').disabled=false;}
 };
 updateHomeLive();
}

let viewTransitionTask=null;
function transitionView(change){
 if(viewTransitionTask)return viewTransitionTask;
 if(matchMedia('(prefers-reduced-motion: reduce)').matches)return Promise.resolve().then(change);
 const task=(async()=>{
  let curtain=$('view-transition');if(!curtain){curtain=document.createElement('div');curtain.id='view-transition';curtain.setAttribute('aria-hidden','true');document.body.append(curtain);}
  curtain.classList.add('is-covering');
  try{await new Promise(resolve=>setTimeout(resolve,170));await change();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}
  finally{curtain.classList.remove('is-covering');await new Promise(resolve=>setTimeout(resolve,280));}
 })();
 viewTransitionTask=task;task.finally(()=>{if(viewTransitionTask===task)viewTransitionTask=null;}).catch(()=>{});return task;
}
function enterHomeLive(){return transitionView(openLiveView);}

function syncHomeExportRow(card,item){
 const check=card.querySelector('.home-export-check');check.hidden=!homeExportMode;check.checked=homeExportSelection.has(item.id);check.disabled=homeSelectingAll||!VertexHomeModel.availability(item).local||item.id===latest?.recording;
 card.classList.toggle('export-selected',homeExportMode&&check.checked);
}
function syncHomeExportControls(){
 document.body.classList.toggle('home-export-mode',homeExportMode);
 $('home-export').setAttribute('aria-pressed',String(homeExportMode));
 $('home-select-all-wrap').hidden=!homeExportMode;$('home-export-bar').hidden=!homeExportMode;
 $('home-select-all').disabled=homeSelectingAll;$('home-select-all').checked=homeSelectingAll||(homeAllSelected&&homeExportSelection.size>0);$('home-select-all').indeterminate=!homeSelectingAll&&!homeAllSelected&&homeExportSelection.size>0;
 $('home-export-confirm').disabled=homeSelectingAll||!homeExportSelection.size;
 $('home-export-cancel').disabled=homeSelectingAll;$('home-export').disabled=homeSelectingAll;
 $('home-export-count').textContent=homeSelectingAll?'Seleccionando biblioteca…':homeExportSelection.size+' seleccionadas';
}
function setHomeExportMode(enabled){if(homeSelectingAll)return;closeHomeMenus();homeExportMode=enabled;homeExportSelection.clear();homeAllSelected=false;syncHomeExportControls();HomeLibrary.render(true);}
function toggleHomeExport(item,checked=!homeExportSelection.has(item.id)){
 if(homeSelectingAll||!VertexHomeModel.availability(item).local||item.id===latest?.recording)return;
 checked?homeExportSelection.set(item.id,item):homeExportSelection.delete(item.id);homeAllSelected=false;syncHomeExportControls();HomeLibrary.render(true);
}
