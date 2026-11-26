let homeActive=true,homeMenuTrigger=null,homeDeleteTarget=null;
const HomeGlyphs={
 computer:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1"/><path d="M8 21h8m-4-5v5"/></svg>',
 cloud:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18a4 4 0 0 1-.3-8A6.5 6.5 0 0 1 18 8a5 5 0 0 1 0 10Z"/></svg>',
 star:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1Z"/></svg>',
 remove:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></svg>'
};
function updateHomeLive(){
 if(!$('home-live-entry'))return;
 const browser=!!globalThis.VertexBrowser?.enabled,online=!browser&&liveConnection().online;
 $('home-live-entry').dataset.online=String(online);
 setViewText('home-live-title',online?'LIVE':'LIVE OFF');
 setViewText('home-live-description',browser?'La captura en vivo requiere VertexConnect en tu PC de juego.':online?liveCarMemory?.name||'Forza conectado. Tu tablero está listo.':'Esperando señal de Forza');
 $('home-live-entry').setAttribute('aria-label',online?'Entrar a LIVE, Forza conectado':'Entrar al tablero, LIVE OFF');
}
function openHome(){
 openLiveView();homeActive=true;revSweepState=null;
 document.body.classList.add('home-view');$('lab-home').hidden=false;
 $('workspace').hidden=true;$('live-workspace').hidden=true;$('player').hidden=true;
 history.replaceState(null,'','#home');closeHomeMenus();updateHomeLive();HomeLibrary.render(true);
}
function closeHomeMenus(){
 for(const [panelId,triggerId] of [['home-cloud-menu','home-cloud-trigger'],['home-row-menu',homeMenuTrigger]]){
  const panel=$(panelId),trigger=triggerId&&$(triggerId);
  if(trigger)setHeaderDrop(panelId,triggerId,false);else{panel.classList.remove('is-open');panel.inert=true;panel.hidden=true;}
 }
}
function positionHomeMenu(panel,trigger){
 const rect=trigger.getBoundingClientRect(),width=panel.offsetWidth||275,height=panel.offsetHeight;
 panel.style.left=Math.max(12,Math.min(innerWidth-width-12,rect.right-width))+'px';
 panel.style.top=Math.max(12,rect.bottom+height+12>innerHeight?rect.top-height-8:rect.bottom+8)+'px';
}
function openHomeSessionMenu(item,trigger){
 const open=trigger.getAttribute('aria-expanded')!=='true';closeHomeMenus();if(!open)return;
 homeMenuTrigger=trigger.id;
 const menu=$('home-row-menu');menu.replaceChildren();
 const caption=document.createElement('span');caption.className='home-menu-caption';caption.textContent='OPCIONES DE SESIÓN';menu.append(caption);
 for(const option of VertexHomeModel.actions(item,latest?.recording)){
  const button=document.createElement('button');button.disabled=!option.enabled;
  if(option.danger)button.classList.add('danger-action');
  button.innerHTML=option.key==='favorite'?HomeGlyphs.star:option.key.startsWith('delete')?HomeGlyphs.remove:HomeGlyphs.cloud;
  const text=document.createElement('span');text.textContent=option.label;
  if(option.soon){const note=document.createElement('small');note.textContent='Próximamente · Google Drive';text.append(note);}
  button.append(text);
  if(option.key==='favorite')button.onclick=action(async()=>{closeHomeMenus();const result=await api('feature/'+item.id,{featured:!item.featured});item.featured=result.featured;HomeLibrary.changed(item);$('home-settings-'+item.id)?.focus({preventScroll:true});});
  if(option.key==='delete-local'||option.key==='delete-all')button.onclick=()=>{
   closeHomeMenus();homeDeleteTarget=item;
   const browser=!!globalThis.VertexBrowser?.enabled;
   $('home-delete-title').textContent=option.key==='delete-all'?'¿Eliminar definitivamente?':'¿Eliminar de este dispositivo?';
   $('home-delete-description').textContent=item.name||item.carName||'Sesión';
   $('home-delete-warning').textContent=browser?'Se eliminará la copia guardada por VertexLab y su registro en la biblioteca. El archivo .vrtx original que importaste se conserva. No hay un respaldo conectado en Google Drive.':'Se eliminarán la telemetría y el video asociados a esta sesión. No hay un respaldo conectado en Google Drive. Esta acción no se puede deshacer.';
   $('home-delete-confirm').textContent=browser?'Eliminar copia local':'Eliminar sesión y video';
   $('home-delete-error').hidden=true;$('home-delete-dialog').showModal();$('home-delete-cancel').focus();
  };
  menu.append(button);
 }
 setHeaderDrop('home-row-menu',trigger.id,true);positionHomeMenu(menu,trigger);
}
function createAvailability(item){
  const availability=document.createElement('div');availability.className='home-availability';const state=VertexHomeModel.availability(item);
  for(const [key,icon,active,label] of [['local',HomeGlyphs.computer,state.local,state.temporary?'Disponible temporalmente en este dispositivo':'Disponible en este dispositivo'],['cloud',HomeGlyphs.cloud,state.cloud,'Respaldada en Google Drive']]){
   const status=document.createElement('span');status.innerHTML=icon;status.dataset.storage=key;
   status.classList.toggle('available',active);status.setAttribute('role','img');status.setAttribute('aria-label',active?label:key==='local'?'No disponible en este dispositivo':'Sin respaldo en Google Drive');status.title=status.getAttribute('aria-label');availability.append(status);
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
 function removed(id){const index=items.findIndex(item=>item.id===id);if(index<0)return;items.splice(index,1);cards.delete(id);total=Math.max(0,(total||0)-1);if(nextOffset!==null)nextOffset=Math.max(0,nextOffset-1);render(true);if(visiblePicker())renderPicker();if(!items.length&&nextOffset!==null)loadMore();}
 function row(item,index){
  let card=cards.get(item.id);if(card)return card;
  card=document.createElement('article');card.className='home-session-row'+(item.featured?' is-featured':'');card.setAttribute('role','listitem');card.dataset.id=item.id;
  const button=createSessionButton(item);button.className='home-session-main';button.id='home-open-'+item.id;button.title=item.name||item.carName;button.setAttribute('aria-label','Analizar '+(item.name||item.carName));
  button.onclick=action(async()=>{button.disabled=true;closeHomeMenus();try{await transitionView(()=>load(item.id));}finally{button.disabled=false;}});
  const availability=createAvailability(item);
  const gear=document.createElement('button');gear.id='home-settings-'+item.id;gear.className='home-row-settings';gear.innerHTML=$('settings-toggle').innerHTML;
  gear.setAttribute('aria-label','Opciones de '+(item.name||item.carName));gear.setAttribute('aria-expanded','false');gear.setAttribute('aria-controls','home-row-menu');gear.onclick=()=>openHomeSessionMenu(item,gear);
  card.append(button,availability,gear);cards.set(item.id,card);return card;
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
  generation++;pending=null;nextOffset=0;total=null;items=[];cards.clear();renderKey='';pickerLimit=12;
  closeHomeMenus();$('home-library-scroll').scrollTop=0;return loadMore();
 }
 function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;render();const scroll=$('home-library-scroll');if(scroll.scrollTop+scroll.clientHeight>=items.length*ROW-ROW*2)loadMore();});}
 async function morePicker(){if(pending)return;if(pickerLimit<items.length){pickerLimit+=PAGE;renderPicker();}else if(nextOffset!==null){pickerLimit+=PAGE;await loadMore();renderPicker();}}
 return {refresh,loadMore,render,changed,removed,renderPicker,morePicker,schedule};
})();
function setupHome(){
 $('lab-logo').onclick=()=>transitionView(openHome);$('lab-logo').onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();transitionView(openHome);}};
 $('home-live-entry').onclick=()=>{if(globalThis.VertexBrowser?.enabled){$('message').textContent='LIVE requiere VertexConnect en tu PC de juego. Aquí puedes analizar tus sesiones .vrtx.';return;}enterHomeLive();};
 $('home-import').onclick=$('home-empty-import').onclick=()=>$('portable-file').click();
 $('home-cloud-trigger').onclick=()=>{const open=$('home-cloud-trigger').getAttribute('aria-expanded')!=='true';closeHomeMenus();if(open){setHeaderDrop('home-cloud-menu','home-cloud-trigger',true);positionHomeMenu($('home-cloud-menu'),$('home-cloud-trigger'));}};
 $('home-library-scroll').addEventListener('scroll',()=>{closeHomeMenus();HomeLibrary.schedule();},{passive:true});
 new ResizeObserver(()=>HomeLibrary.schedule()).observe($('home-library-scroll'));
 $('picker-sessions').addEventListener('scroll',()=>{const box=$('picker-sessions');if(box.scrollTop+box.clientHeight>=box.scrollHeight-100)HomeLibrary.morePicker();},{passive:true});
 $('home-library-retry').onclick=()=>HomeLibrary.loadMore();
 document.addEventListener('pointerdown',event=>{if(!event.target.closest('.home-popover,.home-menu-trigger,.home-row-settings'))closeHomeMenus();});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'){const target=homeMenuTrigger&&$(homeMenuTrigger);closeHomeMenus();if(target?.isConnected)target.focus({preventScroll:true});}});
 window.addEventListener('resize',closeHomeMenus);
 $('home-delete-cancel').onclick=()=>{const id=homeDeleteTarget?.id;$('home-delete-dialog').close();homeDeleteTarget=null;id&&$('home-settings-'+id)?.focus({preventScroll:true});};
 $('home-delete-confirm').onclick=async()=>{
  if(!homeDeleteTarget)return;const target=homeDeleteTarget;$('home-delete-confirm').disabled=true;$('home-delete-error').hidden=true;
  try{await api('delete/'+target.id,{confirm:true,removeLocal:true});HomeLibrary.removed(target.id);$('home-delete-dialog').close();homeDeleteTarget=null;$('message').textContent='Sesión eliminada de este dispositivo.';}
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
