/* In-memory storage adapter for the static viewer. Session files never leave the device. */
(function(root){
  const enabled=document.body.dataset.mode==='viewer',sessions=new Map();let catalog=null;let initialized;
  const saved=new Map();
  async function initialize(){return initialized??=(async()=>{for(const record of await VertexLibrary.records())saved.set(record.id,record);})();}
  async function catalogs(){
    if(!catalog)catalog=Promise.all(['cars.json','car-brands.json'].map(async name=>{const response=await fetch(new URL(name,document.baseURI));if(!response.ok)throw Error('No se pudo cargar el catálogo del visor');return response.json();}));
    return catalog;
  }
  function get(id){const item=sessions.get(id);if(!item)throw Error('Vuelve a abrir el archivo .vrtx en este dispositivo');return item;}
  function release(item){if(item?.url)URL.revokeObjectURL(item.url);chartLayers.clear();mapLayer=null;mapSegments=[];chartSegments.clear();RaceRender.mapData([]);}
  async function open(file,progress,{id:existingId,persist=true}={}){
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
      worker.postMessage(file);
    });
  }
  async function request(path,body){
    await initialize();
    if(path==='sessions'){const result=new Map([...saved].map(([id,item])=>[id,{...item.meta,preview:item.preview}]));for(const [id,item] of sessions)result.set(id,{...item.meta,preview:item.preview});return [...result.values()];}
    const [action,id]=path.split('/');
    if(action==='sessions'&&!sessions.has(id)&&saved.has(id)){const record=saved.get(id);await open(await VertexLibrary.file(record),progress=>{document.querySelector('.session-loading-card>span').textContent=progress.phase+' · '+progress.percent+'%';},{id,persist:false});Object.assign(get(id).meta,record.meta);}
    const item=get(id);
    if(action==='sessions')return {meta:{...item.meta},laps:item.laps};
    if(action==='feature'){item.meta.featured=!!body.featured;if(saved.has(id)){saved.get(id).meta.featured=item.meta.featured;await VertexLibrary.update(saved.get(id));}return {featured:item.meta.featured};}
    if(action==='delete'){release(item);sessions.delete(id);return {ok:true};}
    if(action==='sync'){item.meta.offset=Number(body.offset)||0;return {ok:true};}
    throw Error('Esta función requiere VertexLab Capture en la PC');
  }
  function videoURL(id){const item=get(id);if(!item.video)return null;if(!item.url)item.url=URL.createObjectURL(item.file.slice(item.video.offset,item.video.offset+item.video.size,item.video.type));return item.url;}
  function original(id){return get(id).file;}
  function decorate(){
    if(!enabled)return;
    document.body.dataset.sessionOpen=String(!!session);
    if(matchMedia('(pointer: coarse)').matches)document.querySelector('.map-footer>span').textContent='Zoom con +/− · arrastra para mover';
    $('picker-live').hidden=true;$('manual-controls').hidden=true;
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
    $('delete-session').onclick=action(async()=>{if(!session)return;const id=session.meta.id;clearVideo();await request('delete/'+id,{});openLiveView();await list();$('message').textContent='Sesión cerrada. Tu archivo original no se ha eliminado.';});
    if('serviceWorker' in navigator&&isSecureContext)navigator.serviceWorker.register(new URL('sw.js',document.baseURI),{updateViaCache:'none'}).catch(()=>{});
    setupLibraryUI();decorate();
    initialize().then(()=>list()).catch(error=>{$('message').textContent='Biblioteca no disponible: '+error.message;});
  }
  function setupLibraryUI(){
    const settings=document.createElement('dialog');settings.id='library-settings';settings.innerHTML=`<h2>BIBLIOTECA DEL DISPOSITIVO</h2><p>Elige dónde guardar las próximas sesiones. Las anteriores conservan su ubicación.</p><label class="switch"><input id="library-save" type="checkbox" checked> Guardar las sesiones que abra en este dispositivo</label><output id="library-location">Almacenamiento privado de VertexLab</output><div class="dialog-actions"><button id="library-folder">Elegir carpeta</button><button id="library-private">Usar almacenamiento de VertexLab</button></div><p id="library-help"></p><button id="library-persist">Proteger almacenamiento sin conexión</button><p id="library-storage-status" role="status"></p><button id="library-close">Listo</button>`;document.body.append(settings);
    const openSettings=document.createElement('button');openSettings.className='library-settings-button icon-button';openSettings.textContent='⚙';openSettings.setAttribute('aria-label','Almacenamiento de sesiones');document.querySelector('.app-header').append(openSettings);
    const showStatus=async()=>{const folder=await VertexLibrary.setting('directory');$('library-location').textContent=folder?'Carpeta: '+folder.name:'Almacenamiento privado de VertexLab';const estimate=await navigator.storage?.estimate?.();$('library-storage-status').textContent=estimate?.quota?`${(estimate.usage/1024**3).toFixed(2)} GB usados · ${(estimate.quota/1024**3).toFixed(1)} GB de cuota del sitio`:'';};
    openSettings.onclick=()=>{settings.showModal();showStatus().catch(error=>$('library-storage-status').textContent=error.message);};$('library-close').onclick=()=>settings.close();
    $('library-folder').hidden=!root.showDirectoryPicker;
    $('library-help').textContent=root.showDirectoryPicker?'La carpeta elegida guarda archivos .vrtx organizados por identificador.':'Este navegador no permite elegir una carpeta. Las sesiones se organizan dentro de VertexLab. Conserva el .vrtx original en Archivos como respaldo.';
    $('library-folder').onclick=async()=>{try{const folder=await root.showDirectoryPicker({id:'vertexlab-sessions',mode:'readwrite'});await VertexLibrary.setting('directory',folder);await showStatus();}catch(error){if(error.name!=='AbortError')$('library-storage-status').textContent=error.message;}};
    $('library-private').onclick=action(async()=>{await VertexLibrary.setting('directory',null);await showStatus();});
    $('library-save').onchange=action(async()=>VertexLibrary.setting('save',$('library-save').checked));
    VertexLibrary.setting('save').then(value=>{$('library-save').checked=value!==false;}).catch(()=>{$('library-save').checked=false;});
    $('library-persist').onclick=action(async()=>{$('library-storage-status').textContent=await navigator.storage?.persist?.()?'El navegador ha concedido almacenamiento persistente.':'El navegador no concedió persistencia. Conserva tus archivos originales.';});
    const forget=document.createElement('button');forget.className='session-action';forget.textContent='Quitar de la biblioteca (conservar archivo)';forget.onclick=action(async()=>{if(!session)return;await VertexLibrary.forget(session.meta.id);saved.delete(session.meta.id);setMenu(false);$('message').textContent='Sesión retirada de la biblioteca. El archivo se conserva en su ubicación.';});$('analysis-settings').append(forget);
    // Reparent the video on small screens so sticky spans the entire analysis, not just Al volante.
    const media=matchMedia('(max-width:600px)'),video=document.querySelector('.video-panel'),placeholder=document.createComment('video position');video.before(placeholder);
    const position=()=>{if(media.matches)$('workspace').prepend(video);else placeholder.after(video);};media.addEventListener('change',position);position();
    new ResizeObserver(()=>{document.body.style.setProperty('--viewer-header-height',document.querySelector('.app-header').getBoundingClientRect().height+'px');}).observe(document.querySelector('.app-header'));
  }
  root.VertexBrowser={enabled,open,request,videoURL,original,decorate,setup};
})(globalThis);
