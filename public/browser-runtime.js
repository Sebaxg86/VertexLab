/* In-memory storage adapter for the static viewer. Session files never leave the device. */
(function(root){
  const enabled=document.body.dataset.mode==='viewer',sessions=new Map();let catalog=null;let initialized;
  const mobileApple=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const saved=new Map();
  async function initialize(){return initialized??=(async()=>{for(const record of await VertexLibrary.records())saved.set(record.id,record);})();}
  async function catalogs(){
    if(!catalog)catalog=Promise.all(['cars.json','car-brands.json'].map(async name=>{const response=await fetch(new URL(name,document.baseURI));if(!response.ok)throw Error('No se pudo cargar el catálogo del visor');return response.json();}));
    return catalog;
  }
  function get(id){const item=sessions.get(id);if(!item)throw Error('Vuelve a abrir el archivo .vrtx en este dispositivo');return item;}
  function release(item){if(item?.url?.startsWith('blob:'))URL.revokeObjectURL(item.url);if(item)navigator.serviceWorker?.controller?.postMessage({type:'vertex-media-release',id:item.meta.id});chartLayers.clear();mapLayer=null;mapSegments=[];chartSegments.clear();RaceRender.mapData([]);}
  async function open(file,progress,{id:existingId,persist=true,rangeRead=false}={}){
    if(!enabled)throw Error('Visor no disponible');
    const [cars,brands]=await catalogs();
    return new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('viewer-worker.js',document.baseURI));
      const cancel=$('loading-cancel');cancel.hidden=false;
      function finish(){worker.terminate();cancel.hidden=true;cancel.onclick=null;}
      cancel.onclick=()=>{finish();reject(Error('Apertura cancelada'));};
      worker.onerror=()=>{finish();reject(Error('No se pudo procesar el archivo. Comprueba la memoria disponible y vuelve a abrirlo.'));};
      worker.onmessage=async event=>{
        if(event.data.retryRead){progress?.({phase:'Reintentando lectura compatible con Safari',percent:0});worker.postMessage({remote:true,size:file.size});return;}
        if(event.data.readRange){const {id,start,end}=event.data.readRange;try{if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>file.size||end-start>4*1024**2)throw Error('Rango de lectura inválido');const reader=new FileReader();const buffer=await new Promise((resolve,reject)=>{reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error||Error('I/O Read operation failed'));reader.readAsArrayBuffer(file.slice(start,end));});worker.postMessage({readReply:true,id,buffer},[buffer]);}catch(error){worker.postMessage({readReply:true,id,error:error.message});}return;}
        if(event.data.progress){progress?.(event.data.progress);return;}
        finish();
        if(event.data.error){reject(Error(event.data.error));return;}
        try{
          const result=event.data.result,id=existingId||crypto.randomUUID().replaceAll('-','');
          const meta={...result.meta,id,portableView:result.view,videoPath:result.video?'archivo local':null};
          const info=cars[String(meta.carOrdinal)],carName=typeof info==='string'?info:info?.name||meta.name;
          meta.carName=carName;meta.brand=brands[String(meta.carOrdinal)]||null;
          const item={meta,laps:result.laps,file,video:result.video,url:null};
          item.preview=VertexBrowserCore.preview(item.laps,meta);sessions.set(id,item);
          if(persist&&$('library-save')?.checked){try{const record=await VertexLibrary.save(file,item,progress);saved.set(id,record);}catch(error){sessions.delete(id);reject(error);return;}}
          resolve({id,hasVideo:!!result.video});
        }catch(error){reject(error);}
      };
      worker.postMessage(rangeRead?{remote:true,size:file.size}:file);
    });
  }
  async function request(path,body){
    await initialize();
    if(path==='sessions'){const result=new Map([...saved].map(([id,item])=>[id,{...item.meta,preview:item.preview}]));for(const [id,item] of sessions)result.set(id,{...item.meta,preview:item.preview});return [...result.values()];}
    if(path.startsWith('library?')){
      const query=new URLSearchParams(path.split('?')[1]);
      const catalog=new Map([...saved].map(([id,item])=>[id,{...item.meta,preview:item.preview,availability:{local:true,cloud:false}}]));
      for(const [id,item] of sessions)catalog.set(id,{...item.meta,preview:item.preview,availability:{local:true,cloud:false,temporary:!saved.has(id)}});
      return VertexHomeModel.page([...catalog.values()],query.get('offset'),query.get('limit'));
    }
    const [action,id]=path.split('/');
    if(action==='feature'){
      const stored=saved.get(id),opened=sessions.get(id);
      if(!stored&&!opened)throw Error('Esta sesión ya no está en la biblioteca');
      if(stored){const updated={...stored,meta:{...stored.meta,featured:!!body.featured}};await VertexLibrary.update(updated);saved.set(id,updated);}
      if(opened)opened.meta.featured=!!body.featured;
      return {featured:!!body.featured};
    }
    if(action==='delete'&&body?.removeLocal){
      if(body.confirm!==true)throw Error('Confirma la eliminación de la copia local');
      release(sessions.get(id));await VertexLibrary.remove(id);saved.delete(id);sessions.delete(id);return {ok:true};
    }
    if(action==='sessions'){for(const [otherId,other] of sessions){if(otherId!==id&&saved.has(otherId)){release(other);sessions.delete(otherId);}}}
    if(action==='sessions'&&!sessions.has(id)&&saved.has(id)){const record=saved.get(id);await open(await VertexLibrary.file(record),progress=>{document.querySelector('.session-loading-card>span').textContent=progress.phase+' · '+progress.percent+'%';},{id,persist:false,rangeRead:true});Object.assign(get(id).meta,record.meta);}
    const item=get(id);
    if(action==='sessions')return {meta:{...item.meta},laps:item.laps};
    if(action==='delete'){release(item);sessions.delete(id);return {ok:true};}
    if(action==='sync'){item.meta.offset=Number(body.offset)||0;return {ok:true};}
    throw Error('Esta función requiere VertexLab Capture en la PC');
  }
  async function prepareVideo(id){
    const item=get(id);if(!item.video||item.url)return;
    if(!$('library-range-video')?.checked)return;
    if(saved.has(id)){const record=saved.get(id);record.video=item.video;await VertexLibrary.update(record);}
    const registration=await navigator.serviceWorker?.ready;
    const controller=navigator.serviceWorker?.controller;
    if(!controller||!registration)throw Error('Cierra VertexLab y vuelve a abrirlo para activar el reproductor local actualizado.');
    const channel=new MessageChannel();
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{channel.port1.close();reject(Error('El reproductor local necesita actualizarse. Cierra todas las ventanas de VertexLab y vuelve a abrirlo.'));},4000);channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();event.data.ok?resolve():reject(Error('No se pudo preparar el video local'));};controller.postMessage({type:'vertex-media',id,video:item.video,size:item.file.size},[channel.port2]);});
    item.url=new URL('__vertex_media/'+id+'/video',registration.scope).href;
  }
  function videoURL(id){const item=get(id);if(!item.video)return null;if(!item.url)item.url=URL.createObjectURL(item.file.slice(item.video.offset,item.video.offset+item.video.size,item.video.type));return item.url;}
  function original(id){return get(id).file;}
  function decorate(){
    if(!enabled)return;
    document.body.dataset.sessionOpen=String(!!session);
    $('analysis-settings').hidden=!session;
    $('settings-title').textContent=session?'SESIÓN / ANÁLISIS':'CONFIGURACIÓN';
    if(matchMedia('(pointer: coarse)').matches)document.querySelector('.map-footer>span').textContent='Zoom con +/− · arrastra para mover';
    $('picker-live').hidden=!session;$('picker-live').querySelector('b').textContent='OFFLINE';document.body.dataset.liveConnected='false';$('manual-controls').hidden=true;
    $('export-session').lastElementChild.textContent='Guardar archivo .vrtx original';
    $('delete-session').lastElementChild.textContent='Cerrar sesión de esta pestaña';
    if(!session){$('title').textContent='Abre una sesión';$('view-eyebrow').textContent='VISOR PORTABLE';$('session-info').textContent='Biblioteca privada de este dispositivo';}
  }
  function setup(){
    if(!enabled)return;
    const button=document.createElement('button');button.className='viewer-open';button.textContent='Abrir archivo .vrtx';button.onclick=()=>$('portable-file').click();
    $('video-empty').querySelector('p').textContent='Tus vueltas, en cualquier pantalla';
    $('video-empty').querySelector('small').textContent='Abre una sesión .vrtx. El archivo se procesa aquí y no se sube a ningún servidor.';
    $('video-empty').append(button);
    $('delete-session').onclick=action(async()=>{if(!session)return;const id=session.meta.id;clearVideo();await request('delete/'+id,{});openHome();await list();$('message').textContent='Sesión cerrada. Tu archivo original no se ha eliminado.';});
    if('serviceWorker' in navigator&&isSecureContext)navigator.serviceWorker.register(new URL('sw.js',document.baseURI),{updateViaCache:'none'}).catch(()=>{});
    navigator.serviceWorker?.addEventListener('message',async event=>{
      if(event.data?.type!=='vertex-media-range'||!event.ports[0])return;
      const port=event.ports[0];
      try{const {id,start,end}=event.data,file=get(id).file;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||end>file.size||end-start>256*1024)throw Error('Invalid local media range');const reader=new FileReader();const buffer=await new Promise((resolve,reject)=>{reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error||Error('Local media read failed'));reader.readAsArrayBuffer(file.slice(start,end));});port.postMessage({buffer},[buffer]);}catch(error){port.postMessage({error:error.message});}finally{port.close();}
    });
    setupLibraryUI();decorate();
    initialize().then(()=>list()).catch(error=>{$('message').textContent='Biblioteca no disponible: '+error.message;});
  }
  function setupLibraryUI(){
    const icon=(path)=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
    const books=icon('M4 4h4v16H4ZM10 4h4v16h-4ZM16 5l4-1 3 15-4 1Z');
    const folderIcon=icon('M3 7V4h7l2 3h9v13H3Z');
    const deviceIcon=icon('M4 3h16v14H4ZM9 21h6m-3-4v4');
    const shieldIcon=icon('M12 2l8 3v6c0 6-8 11-8 11S4 17 4 11V5Zm-4 9 3 3 5-6');
    const filmIcon=icon('M3 4h18v16H3ZM7 4v16M17 4v16M3 9h4m-4 6h4m10-6h4m-4 6h4');
    const settings=document.createElement('dialog');settings.id='library-settings';settings.setAttribute('aria-labelledby','library-title');
    settings.innerHTML=`<header class="library-dialog-heading"><div class="library-dialog-icon">${books}</div><div><span class="library-eyebrow">VERTEXLAB · ESTE DISPOSITIVO</span><h2 id="library-title">Biblioteca</h2></div><button id="library-dismiss" class="icon-button" aria-label="Cerrar biblioteca">${icon('M6 6l12 12M18 6 6 18')}</button></header>
    <p class="library-intro">Configura el guardado de tus sesiones y la reproducción en este dispositivo.</p>
    <section class="library-section"><h3>${deviceIcon} Guardado de sesiones</h3><label class="switch library-option"><input id="library-save" type="checkbox" checked><span>Guardar las sesiones que abra<small>Disponibles al volver a abrir VertexLab en este dispositivo.</small></span></label><output id="library-location">Almacenamiento privado de VertexLab</output><div class="dialog-actions"><button id="library-folder">${folderIcon}<span>Elegir carpeta</span></button><button id="library-private">${deviceIcon}<span>Usar VertexLab</span></button></div><p id="library-help"></p></section>
    <section class="library-section"><h3>${filmIcon} Reproducción</h3><label class="switch library-option"><input id="library-range-video" type="checkbox"><span>Reproducir video por fragmentos locales<small>Lee el video por partes para reducir el uso de memoria.</small></span></label><label class="switch library-option"><input id="library-two-videos" type="checkbox"><span>Permitir dos videos simultáneos<small>La comparación de video utiliza más memoria.</small></span></label><p class="library-note">Los cambios de reproducción se aplican al reabrir la sesión.</p></section>
    <section class="library-section"><h3>${shieldIcon} Almacenamiento</h3><button id="library-persist">${shieldIcon}<span>Proteger almacenamiento sin conexión</span></button><p id="library-storage-status" role="status"></p></section><footer class="library-dialog-footer"><button id="library-close">Listo</button></footer>`;document.body.append(settings);
    const openSettings=document.createElement('button');openSettings.className='session-action library-settings-button';openSettings.innerHTML=books+'<span>Biblioteca</span>';openSettings.setAttribute('aria-haspopup','dialog');$('settings-panel').append(openSettings);
    const showStatus=async()=>{const folder=await VertexLibrary.setting('directory');$('library-location').textContent=folder?'Carpeta: '+folder.name:'Almacenamiento privado de VertexLab';const estimate=await navigator.storage?.estimate?.();$('library-storage-status').textContent=estimate?.quota?`${(estimate.usage/1024**3).toFixed(2)} GB usados · ${(estimate.quota/1024**3).toFixed(1)} GB de cuota del sitio`:'';};
    let closeTimer;
    const closeLibrary=()=>{if(!settings.open||settings.classList.contains('is-closing'))return;settings.classList.add('is-closing');closeTimer=setTimeout(()=>{settings.close();settings.classList.remove('is-closing');$('settings-toggle').focus();},matchMedia('(prefers-reduced-motion: reduce)').matches?0:180);};
    openSettings.onclick=()=>{clearTimeout(closeTimer);settings.classList.remove('is-closing');setMenu(false);settings.showModal();showStatus().catch(error=>$('library-storage-status').textContent=error.message);};
    $('library-close').onclick=$('library-dismiss').onclick=closeLibrary;
    settings.addEventListener('cancel',event=>{event.preventDefault();closeLibrary();});
    settings.addEventListener('click',event=>{if(event.target!==settings)return;const rect=settings.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeLibrary();});
    $('library-folder').hidden=!root.showDirectoryPicker;
    $('library-help').textContent=root.showDirectoryPicker?'La carpeta elegida guarda archivos .vrtx organizados por identificador.':'Este navegador no permite elegir una carpeta. Las sesiones se organizan dentro de VertexLab. Conserva el .vrtx original en Archivos como respaldo.';
    $('library-folder').onclick=async()=>{try{const folder=await root.showDirectoryPicker({id:'vertexlab-sessions',mode:'readwrite'});await VertexLibrary.setting('directory',folder);await showStatus();}catch(error){if(error.name!=='AbortError')$('library-storage-status').textContent=error.message;}};
    $('library-private').onclick=action(async()=>{await VertexLibrary.setting('directory',null);await showStatus();});
    for(const [id,fallback] of [['library-range-video',mobileApple],['library-two-videos',!mobileApple]]){$(id).checked=fallback;VertexLibrary.setting(id).then(value=>{if(typeof value==='boolean')$(id).checked=value;}).catch(()=>{});$(id).onchange=action(async()=>VertexLibrary.setting(id,$(id).checked));}
    $('library-save').onchange=action(async()=>VertexLibrary.setting('save',$('library-save').checked));
    VertexLibrary.setting('save').then(value=>{$('library-save').checked=value!==false;}).catch(()=>{$('library-save').checked=false;});
    $('library-persist').onclick=action(async()=>{$('library-storage-status').textContent=await navigator.storage?.persist?.()?'El navegador ha concedido almacenamiento persistente.':'El navegador no concedió persistencia. Conserva tus archivos originales.';});
    const forget=document.createElement('button');forget.className='session-action';forget.hidden=true;forget.textContent='Quitar de la biblioteca (conservar archivo)';forget.onclick=action(async()=>{if(!session)return;await VertexLibrary.forget(session.meta.id);saved.delete(session.meta.id);setMenu(false);$('message').textContent='Sesión retirada de la biblioteca. El archivo se conserva en su ubicación.';});$('analysis-settings').append(forget);
    // Reparent the video on small screens so sticky spans the entire analysis, not just Al volante.
    const media=matchMedia('(max-width:600px)'),video=document.querySelector('.video-panel'),placeholder=document.createComment('video position');video.before(placeholder);
    const position=()=>{if(media.matches)$('workspace').prepend(video);else placeholder.after(video);};media.addEventListener('change',position);position();
    new ResizeObserver(()=>{document.body.style.setProperty('--viewer-header-height',document.querySelector('.app-header').getBoundingClientRect().height+'px');}).observe(document.querySelector('.app-header'));
  }
  root.VertexBrowser={enabled,mobileApple,singleVideo:()=>!$('library-two-videos')?.checked,prepareVideo,open,request,videoURL,original,decorate,setup};
})(globalThis);
