/* In-memory storage adapter for the static viewer. Session files never leave the device. */
(function(root){
  const enabled=document.body.dataset.mode==='viewer',sessions=new Map();let catalog=null;let initialized;let openStorageSettings=()=>{};
  const DOWNLOAD_URL='https://vertexlab.racing/#descargar';
  let liveDemoActive=false,demoData=null,demoTimer=null,demoStart=0,deferredInstallPrompt=null;
  function isStandalone(){return matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;}
  function canInstall(){
    if(!enabled||isStandalone())return null;
    if(deferredInstallPrompt)return 'prompt';
    if(mobileApple)return 'ios';
    return null;
  }
  async function installApp(){
    if(deferredInstallPrompt){
      const promptEvent=deferredInstallPrompt;
      deferredInstallPrompt=null;
      await promptEvent.prompt();
      await promptEvent.userChoice.catch(()=>{});
      globalThis.VertexCloud?.renderMenu?.();
      return;
    }
    if(mobileApple&&!isStandalone()){
      let dialog=$('pwa-ios-dialog');
      if(!dialog){
        dialog=document.createElement('dialog');
        dialog.id='pwa-ios-dialog';
        dialog.className='cloud-auth-dialog';
        dialog.innerHTML='<span class="eyebrow">INSTALAR EN IPHONE / IPAD</span><h2>Agregar a pantalla de inicio</h2><p class="auth-subtitle">Para abrir VertexLab a pantalla completa como app nativa en iOS:</p><ol class="pwa-ios-steps"><li>Pulsa el botón <b>Compartir</b> (icono de cuadro con flecha hacia arriba) en la barra de Safari.</li><li>Desliza y elige <b>Agregar a pantalla de inicio</b>.</li><li>Pulsa <b>Agregar</b> arriba a la derecha.</li></ol><div class="cloud-auth-footer"><button type="button" id="pwa-ios-close" class="cloud-auth-cancel">Entendido</button></div>';
        document.body.append(dialog);
        dialog.querySelector('#pwa-ios-close').onclick=()=>dialog.close();
      }
      dialog.showModal();
    }
  }
  const mobileApple=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const saved=new Map();
  async function initialize(){return initialized??=(async()=>{for(const record of await VertexLibrary.records())saved.set(record.id,record);})();}
  async function catalogs(){
    if(!catalog)catalog=Promise.all(['cars.json','car-brands.json'].map(async name=>{const response=await fetch(new URL(name,document.baseURI));if(!response.ok)throw Error('No se pudo cargar el catálogo del visor');return response.json();}));
    return catalog;
  }
  function get(id){const item=sessions.get(id);if(!item)throw Error('Vuelve a abrir el archivo .vrtx en este dispositivo');return item;}
  function release(item){if(item?.url?.startsWith('blob:'))URL.revokeObjectURL(item.url);if(item)navigator.serviceWorker?.controller?.postMessage({type:'vertex-media-release',id:item.meta.id});chartLayers.clear();mapLayer=null;mapSegments=[];chartSegments.clear();RaceRender.mapData([]);}
  async function open(file,progress,{id:existingId,persist=true,rangeRead=false,forceSave=false}={}){
    if(!enabled)throw Error('Visor no disponible');
    const [cars,brands]=await catalogs();
    return new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('viewer-worker.js',document.baseURI));
      const cancel=$('loading-cancel');cancel.hidden=false;
      function finish(){worker.terminate();cancel.hidden=true;cancel.onclick=null;}
      cancel.onclick=()=>{finish();reject(Error('Apertura cancelada'));};
      worker.onerror=()=>{finish();reject(Error('No se pudo procesar el archivo. Comprueba la memoria disponible y vuelve a abrirlo.'));};
      worker.onmessage=async event=>{
        if(event.data.retryRead){progress?.({phase:'Reintentando lectura por bloques',percent:0});worker.postMessage({remote:true,size:file.size});return;}
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
          if(persist&&(forceSave||$('library-save')?.checked)){try{const record=await VertexLibrary.save(file,item,progress);saved.set(id,record);}catch(error){sessions.delete(id);reject(error);return;}}
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
      let cars={},brands={};
      if(typeof fetch==='function'){try{[cars,brands]=await catalogs();}catch{}}
      const enrich=item=>{
        const key=String(item.carOrdinal??''),info=cars[key];
        const carName=typeof info==='string'?info:info?.name||item.carName||item.name;
        const brand=brands[key]||(item.brand&&typeof item.brand==='object'?item.brand:null);
        return {...item,carName,brand};
      };
      const catalog=new Map([...saved].map(([id,item])=>[id,enrich({...item.meta,preview:item.preview,availability:{local:true,cloud:false}})]));
      for(const [id,item] of sessions)if(item.file||saved.has(id))catalog.set(id,enrich({...item.meta,preview:item.preview,availability:{local:true,cloud:false,temporary:!saved.has(id)}}));
      const cloudItems=(globalThis.VertexCloud?.cachedSessions?.()||[]).map(enrich);
      const merged=globalThis.VertexCloudModel?VertexCloudModel.mergeLibrary([...catalog.values()],cloudItems):[...catalog.values()];
      return VertexHomeModel.page(merged,query.get('offset'),query.get('limit'));
    }
    const [action,id]=path.split('/');
    if(action==='feature'){
      const stored=saved.get(id),opened=sessions.get(id);
      const cloudMatch=(globalThis.VertexCloud?.cachedSessions?.()||[]).find(item=>item.id===id);
      if(!stored&&!opened&&!cloudMatch)throw Error('Esta sesión ya no está en la biblioteca');
      const featured=!!body.featured;
      if(stored){const updated={...stored,meta:{...stored.meta,featured}};await VertexLibrary.update(updated);saved.set(id,updated);}
      if(opened)opened.meta.featured=featured;
      if(cloudMatch)await globalThis.VertexCloud?.updateCloudMetadata?.(id,{featured});
      return {featured};
    }
    if(action==='delete'&&body?.removeLocal){
      if(body.confirm!==true)throw Error('Confirma la eliminación de la copia local');
      release(sessions.get(id));await VertexLibrary.remove(id);saved.delete(id);sessions.delete(id);return {ok:true};
    }
    if(action==='sessions'){for(const [otherId,other] of sessions){if(otherId!==id&&saved.has(otherId)){release(other);sessions.delete(otherId);}}}
    if(action==='sessions'&&!sessions.has(id)&&saved.has(id)){
      const record=saved.get(id);
      if(record.kind==='components'){
        const parts=await VertexLibrary.loadComponents(record);
        const meta=VertexBrowserCore.metadata(JSON.parse(parts.metaText));
        Object.assign(meta,record.meta,{id,videoPath:parts.videoFile?'archivo local':null});
        const [cars,brands]=await catalogs();
        const info=cars[String(meta.carOrdinal)],carName=typeof info==='string'?info:info?.name||meta.name;
        meta.carName=carName;meta.brand=brands[String(meta.carOrdinal)]||null;
        const builder=new VertexBrowserCore.LapBuilder();
        for(const line of parts.telemetryText.split('\n')){if(line.trim())builder.push(JSON.parse(line));}
        const laps=builder.finish();
        sessions.set(id,{meta,laps,file:parts.videoFile,video:parts.videoFile?{offset:0,size:parts.videoFile.size,type:record.videoMime||'video/mp4'}:null,url:null,preview:record.preview});
      }else{
        await open(await VertexLibrary.file(record),progress=>{document.querySelector('.session-loading-card>span').textContent=progress.phase+' · '+progress.percent+'%';},{id,persist:false,rangeRead:true});
        Object.assign(get(id).meta,record.meta);
      }
    }
    if(action==='sessions'&&!sessions.has(id)&&!saved.has(id)){
      const cloudItem=(globalThis.VertexCloud?.cachedSessions?.()||[]).find(item=>item.id===id);
      if(cloudItem){
        const opened=await VertexCloud.openCloudSession(cloudItem,progress=>{const el=document.querySelector('.session-loading-card>span');if(el)el.textContent=progress.phase+' · '+progress.percent+'%';});
        const [cars,brands]=await catalogs();
        const info=cars[String(opened.meta.carOrdinal)],carName=typeof info==='string'?info:info?.name||opened.meta.name;
        opened.meta.carName=carName;opened.meta.brand=brands[String(opened.meta.carOrdinal)]||null;
        sessions.set(id,{meta:opened.meta,laps:opened.laps,file:null,video:null,cloudVideo:opened.cloudVideo,url:null,preview:cloudItem.preview});
      }
    }
    const item=get(id);
    if(action==='sessions')return {meta:{...item.meta},laps:item.laps};
    if(action==='delete'){release(item);sessions.delete(id);return {ok:true};}
    if(action==='sync'){
      const offset=Number(body.offset)||0;
      item.meta.offset=offset;
      if(item.meta.availability?.cloud)await globalThis.VertexCloud?.updateCloudMetadata?.(id,{sync_offset:offset});
      return {ok:true};
    }
    throw Error('Esta función requiere VertexLab Capture en la PC');
  }
  async function waitServiceWorkerController(timeoutMs=3000){
    const registration=await navigator.serviceWorker?.ready;
    if(!registration)return {registration:null,controller:null};
    if(navigator.serviceWorker.controller)return {registration,controller:navigator.serviceWorker.controller};
    await new Promise(resolve=>{
      const timer=setTimeout(resolve,timeoutMs);
      navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(timer);resolve();},{once:true});
    });
    return {registration,controller:navigator.serviceWorker.controller};
  }
  async function prepareVideo(id){
    const item=get(id);
    if(item.cloudVideo){
      const {registration,controller}=await waitServiceWorkerController();
      if(!controller||!registration)throw Error('Recarga VertexLab para activar el reproductor de streaming desde Google Drive.');
      const channel=new MessageChannel();
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{channel.port1.close();reject(Error('El reproductor en la nube necesita recargarse.'));},4000);channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();event.data.ok?resolve():reject(Error('No se pudo preparar el streaming de video'));};controller.postMessage({type:'vertex-cloud-media',id,fileId:item.cloudVideo.fileId,size:item.cloudVideo.size,mime:item.cloudVideo.type},[channel.port2]);});
      item.url=new URL('__vertex_media/'+id+'/video',registration.scope).href;
      return;
    }
    if(!item.video||item.url)return;
    if(!$('library-range-video')?.checked)return;
    if(saved.has(id)){const record=saved.get(id);record.video=item.video;await VertexLibrary.update(record);}
    const registration=await navigator.serviceWorker?.ready;
    const controller=navigator.serviceWorker?.controller;
    if(!controller||!registration)throw Error('Cierra VertexLab y vuelve a abrirlo para activar el reproductor local actualizado.');
    const channel=new MessageChannel();
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{channel.port1.close();reject(Error('El reproductor local necesita actualizarse. Cierra todas las ventanas de VertexLab y vuelve a abrirlo.'));},4000);channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();event.data.ok?resolve():reject(Error('No se pudo preparar el video local'));};controller.postMessage({type:'vertex-media',id,video:item.video,size:item.file.size},[channel.port2]);});
    item.url=new URL('__vertex_media/'+id+'/video',registration.scope).href;
  }
  function videoURL(id){const item=get(id);if(item.url)return item.url;if(!item.video||!item.file)return null;item.url=URL.createObjectURL(item.file.slice(item.video.offset,item.video.offset+item.video.size,item.video.type));return item.url;}
  async function source(id,view){
    await initialize();
    const record=saved.get(id);
    if(record?.kind==='components')return prepareComponentExport(record,view);
    if(sessions.has(id)&&get(id).file)return get(id).file;
    if(record)return VertexLibrary.file(record);
    throw Error('Descarga la sesión en este dispositivo antes de exportarla');
  }
  async function importFile(file,progress){const result=await open(file,progress,{forceSave:true});release(sessions.get(result.id));sessions.delete(result.id);return result;}
  function original(id){return get(id).file;}
  function stopLiveDemo(){
    liveDemoActive=false;
    if(demoTimer){clearInterval(demoTimer);demoTimer=null;}
  }
  async function openLiveDemo(){
    if(!enabled)return;
    stopLiveDemo();
    const [[cars,brands],demo]=await Promise.all([
      catalogs(),
      demoData?Promise.resolve(demoData):fetch(new URL('live-demo-gr86.json',document.baseURI)).then(r=>{if(!r.ok)throw Error('No se pudo cargar la telemetría demo');return r.json();}).then(d=>(demoData=d))
    ]);
    liveDemoActive=true;
    const brand=brands[String(demo.carOrdinal)]||null;
    const info=cars[String(demo.carOrdinal)];
    const carName=typeof info==='string'?info:info?.name||demo.carName;
    if(brand)headerBrands.set(demo.carOrdinal,brand);
    liveCarMemory={ordinal:demo.carOrdinal,name:carName,carClass:demo.carClass,carPI:demo.carPI,brand};
    openLiveView();
    document.body.classList.remove('live-offline');
    $('live-dashboard-host').inert=false;
    $('live-offline-notice').setAttribute('aria-hidden','true');
    document.body.dataset.liveConnected='true';
    $('view-eyebrow').textContent='MODO DEMO';
    $('title').textContent='LIVE DEMO';
    $('session-info').textContent='';
    renderLiveVehicle('live-car',true,carName);
    demoStart=performance.now();
    const duration=Math.max(1,Number(demo.duration)||35);
    const samples=demo.samples||[];
    const tick=()=>{
      if(!liveDemoActive||session||homeActive){stopLiveDemo();return;}
      const elapsed=((performance.now()-demoStart)/1000)%duration;
      let lo=0,hi=samples.length-1;
      while(lo<hi){const mid=(lo+hi+1)>>1;if(samples[mid].t<=elapsed)lo=mid;else hi=mid-1;}
      const sample=samples[lo];
      if(sample&&typeof drawInstruments==='function'){
        liveSampleMemory=sample;
        drawInstruments(sample);
        $('instant-source').textContent='Demo en tiempo real';
        $('instant-note').textContent='2022 Toyota GR86 · Telemetría grabada';
      }
    };
    tick();
    demoTimer=setInterval(tick,50);
  }
  function decorate(){
    if(!enabled)return;
    if(session)stopLiveDemo();
    document.body.dataset.sessionOpen=String(!!session);
    $('analysis-settings').hidden=!session;
    $('settings-title').textContent=session?'SESIÓN / ANÁLISIS':'CONFIGURACIÓN';
    if(matchMedia('(pointer: coarse)').matches)document.querySelector('.map-footer>span').textContent='Zoom con +/− · arrastra para mover';
    $('picker-live').hidden=!session;
    $('picker-live').querySelector('b').textContent='LIVE DEMO';
    $('picker-live-status').textContent='Vista previa';
    $('picker-live-status').hidden=false;
    $('manual-controls').hidden=true;
    document.body.dataset.liveConnected='true';
    const cta=$('viewer-download-wrap');
    if(cta)cta.hidden=!liveDemoActive;
    if(liveDemoActive){
      document.querySelector('.settings-wrap').hidden=true;
      return;
    }
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
    const headerWrap=document.createElement('div');
    headerWrap.id='viewer-download-wrap';headerWrap.className='viewer-download-wrap';headerWrap.hidden=true;
    const chevrons=document.createElement('span');
    chevrons.className='viewer-cta-chevrons';chevrons.setAttribute('aria-hidden','true');
    chevrons.innerHTML='<svg viewBox="0 0 42 20"><path class="c1" d="M3 3l7 7-7 7"/><path class="c2" d="M16 3l7 7-7 7"/><path class="c3" d="M29 3l7 7-7 7"/></svg>';
    const headerCta=document.createElement('a');
    headerCta.id='viewer-download-cta';headerCta.className='viewer-download-cta';
    headerCta.href=DOWNLOAD_URL;headerCta.target='_blank';headerCta.rel='noopener noreferrer';
    headerCta.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v13m-5-5 5 5 5-5M4 15v6h16v-6"/></svg><span class="viewer-cta-text"><small><b>VERTEX<em class="brand-accent">LAB</em></b> · WINDOWS</small><strong>DESCARGAR AHORA <i class="diagonal-arrow" aria-hidden="true">↗</i></strong></span>';
    const openDownloadModal=event=>{
      event.preventDefault();
      event.stopPropagation();
      let dialog=$('viewer-download-modal');
      if(!dialog){
        dialog=document.createElement('dialog');
        dialog.id='viewer-download-modal';
        dialog.className='cloud-auth-dialog viewer-download-modal';
        dialog.innerHTML=`<span class="eyebrow">APLICACIÓN DE ESCRITORIO · WINDOWS</span><h2>VERTEX<em class="brand-accent">LAB</em> + CONNECT</h2><p class="auth-subtitle">Lleva tu experiencia al siguiente nivel en tu PC de juego y analiza cada vuelta desde tu teléfono.</p><ul class="download-modal-perks"><li>Telemetría real de Forza en tiempo real (LIVE) para segundo monitor.</li><li>Grabación automática con OBS sincronizada por tramos y pausas.</li><li>Respaldo en tu Google Drive para reproducir en streaming desde cualquier dispositivo.</li></ul><a class="cloud-google-btn viewer-modal-dl" href="${DOWNLOAD_URL}" target="_blank" rel="noopener noreferrer"><span>Descargar para Windows <i class="diagonal-arrow" aria-hidden="true">↗</i></span></a><div class="cloud-auth-footer"><button type="button" id="viewer-dl-close" class="cloud-auth-cancel">Ahora no</button></div>`;
        document.body.append(dialog);
        const closeDownloadModal=()=>{
          if(!dialog.open||dialog.classList.contains('is-closing'))return;
          if(matchMedia('(prefers-reduced-motion: reduce)').matches){dialog.close();return;}
          dialog.classList.add('is-closing');
          clearTimeout(dialog._closeTimer);
          dialog._closeTimer=setTimeout(()=>{dialog.close();dialog.classList.remove('is-closing');},200);
        };
        dialog.querySelector('#viewer-dl-close').onclick=closeDownloadModal;
        dialog.addEventListener('cancel',e=>{e.preventDefault();closeDownloadModal();});
        dialog.addEventListener('click',e=>{
          if(e.target!==dialog)return;
          const r=dialog.getBoundingClientRect();
          if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDownloadModal();
        });
      }
      clearTimeout(dialog._closeTimer);
      dialog.classList.remove('is-closing');
      if(!dialog.open)dialog.showModal();
    };
    headerCta.addEventListener('click',openDownloadModal);
    headerWrap.append(chevrons,headerCta);
    document.querySelector('.app-header')?.append(headerWrap);
    const homeZone=document.querySelector('.home-live-zone');
    if(homeZone){
      const homeLink=document.createElement('a');
      homeLink.id='home-download-link';homeLink.className='home-download-link';
      homeLink.href=DOWNLOAD_URL;homeLink.target='_blank';homeLink.rel='noopener noreferrer';
      homeLink.innerHTML='¿QUIERES CAPTURAR TUS CARRERAS? <b>DESCARGA <span class="brand-word">VERTEX<em class="brand-accent">LAB</em></span> PARA WINDOWS <i class="diagonal-arrow" aria-hidden="true">↗</i></b>';
      homeLink.addEventListener('click',openDownloadModal);
      homeZone.append(homeLink);
    }
    $('delete-session').onclick=action(async()=>{if(!session)return;const id=session.meta.id;clearVideo();await request('delete/'+id,{});openHome();await list();$('message').textContent='Sesión cerrada. Tu archivo original no se ha eliminado.';});
    if('serviceWorker' in navigator&&isSecureContext)navigator.serviceWorker.register(new URL('sw.js',document.baseURI),{updateViaCache:'none'}).catch(()=>{});
    window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;globalThis.VertexCloud?.renderMenu?.();});
    window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;globalThis.VertexCloud?.renderMenu?.();$('message').textContent='VertexLab instalada como app en este dispositivo.';});
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
    settings.innerHTML=`<header class="library-dialog-heading"><div class="library-dialog-icon">${books}</div><div><span class="library-eyebrow">VERTEXLAB · ESTE DISPOSITIVO</span><h2 id="library-title">Ajustes avanzados</h2></div><button id="library-dismiss" class="icon-button" aria-label="Cerrar ajustes avanzados">${icon('M6 6l12 12M18 6 6 18')}</button></header>
    <p class="library-intro">Configura el almacenamiento local del navegador y la reproducción en este dispositivo.</p>
    <section class="library-section"><h3>${deviceIcon} Guardado de sesiones</h3><label class="switch library-option"><input id="library-save" type="checkbox" checked><span>Guardar las sesiones que abra<small>Disponibles al volver a abrir VertexLab en este dispositivo.</small></span></label><output id="library-location">Almacenamiento privado de VertexLab</output><div class="dialog-actions"><button id="library-folder">${folderIcon}<span>Elegir carpeta</span></button><button id="library-private">${deviceIcon}<span>Usar VertexLab</span></button></div><p id="library-help"></p></section>
    <section class="library-section"><h3>${filmIcon} Reproducción</h3><label class="switch library-option"><input id="library-range-video" type="checkbox"><span>Reproducir video por fragmentos locales<small>Lee el video por partes para reducir el uso de memoria.</small></span></label><label class="switch library-option"><input id="library-two-videos" type="checkbox"><span>Permitir dos videos simultáneos<small>La comparación de video utiliza más memoria.</small></span></label><p class="library-note">Los cambios de reproducción se aplican al reabrir la sesión.</p></section>
    <section class="library-section"><h3>${shieldIcon} Almacenamiento</h3><button id="library-persist">${shieldIcon}<span>Proteger almacenamiento sin conexión</span></button><p id="library-storage-status" role="status"></p></section><footer class="library-dialog-footer"><button id="library-close">Listo</button></footer>`;document.body.append(settings);
    const showStatus=async()=>{const folder=await VertexLibrary.setting('directory');$('library-location').textContent=folder?'Carpeta: '+folder.name:'Almacenamiento privado de VertexLab';const estimate=await navigator.storage?.estimate?.();$('library-storage-status').textContent=estimate?.quota?`${(estimate.usage/1024**3).toFixed(2)} GB usados · ${(estimate.quota/1024**3).toFixed(1)} GB de cuota del sitio`:'';};
    let closeTimer;
    const closeLibrary=()=>{if(!settings.open||settings.classList.contains('is-closing'))return;settings.classList.add('is-closing');closeTimer=setTimeout(()=>{settings.close();settings.classList.remove('is-closing');},matchMedia('(prefers-reduced-motion: reduce)').matches?0:180);};
    openStorageSettings=()=>{clearTimeout(closeTimer);settings.classList.remove('is-closing');setMenu(false);settings.showModal();showStatus().catch(error=>$('library-storage-status').textContent=error.message);};
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
    let lastHeaderH=-1;
    new ResizeObserver(()=>{const h=Math.round(document.querySelector('.app-header').getBoundingClientRect().height);if(h!==lastHeaderH){lastHeaderH=h;document.body.style.setProperty('--viewer-header-height',h+'px');}}).observe(document.querySelector('.app-header'));
  }
  function registerSavedRecord(record){
    if(!record?.id)return;
    const old=sessions.get(record.id);
    if(old){release(old);sessions.delete(record.id);}
    saved.set(record.id,record);
  }
  root.VertexBrowser={enabled,mobileApple,singleVideo:()=>!$('library-two-videos')?.checked,prepareVideo,open,request,videoURL,original,source,importFile,registerSavedRecord,openStorageSettings:()=>openStorageSettings(),openLiveDemo,stopLiveDemo,liveDemoActive:()=>liveDemoActive,canInstall,installApp,decorate,setup};
})(globalThis);
