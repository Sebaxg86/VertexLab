/* In-memory storage adapter for the static viewer. Session files never leave the device. */
(function(root){
  const enabled=document.body.dataset.mode==='viewer',sessions=new Map();let catalog=null;let initialized;let openStorageSettings=()=>{};
  const DOWNLOAD_URL='https://vertexlab.racing/#descargar';
  const DEMO_ID='0000000000000000000000000000de01';
  const DEMO_BASE='https://vertexlab.racing/demo/';
  const DEMO_VIDEO_FALLBACK='https://media.vertexlab.racing/demo/safety-car-demo.mp4';
  const DEMO_ITEM={
    id:DEMO_ID,
    name:'Safety Car DEMO',
    carName:'2021 Mercedes-AMG GT Black Series',
    carOrdinal:4265,
    carClass:7,
    carPI:999,
    brand:{name:'Mercedes-AMG',logo:'brand-mercedes-amg.png'},
    created:1795859619.5706332,
    ended:1795859780.6939113,
    duration:145.70300000000134,
    version:2,
    featured:false,
    demo:true,
    lapCount:3,
    availability:{local:false,cloud:false,demo:true},
    preview:{path:'M68.52,41.53 L67.37,40.00 L66.16,38.37 L64.89,36.69 L63.67,35.11 L62.41,33.53 L61.31,32.21 L60.28,31.04 L59.33,30.03 L58.38,29.22 L57.36,28.58 L56.21,28.05 L54.95,27.66 L53.51,27.38 L52.08,27.18 L50.63,27.00 L49.23,26.86 L47.88,26.77 L46.68,26.76 L45.50,26.89 L44.39,27.23 L43.37,27.77 L42.48,28.47 L41.67,29.34 L41.00,30.27 L40.36,31.31 L39.64,32.53 L38.89,33.84 L38.15,35.15 L37.39,36.50 L36.71,37.69 L36.10,38.73 L35.55,39.62 L34.88,40.49 L34.05,41.26 L33.16,41.84 L32.19,42.27 L31.16,42.56 L30.03,42.69 L28.83,42.68 L27.45,42.58 L25.99,42.37 L24.74,42.08 L23.51,41.65 L22.38,41.07 L21.42,40.37 L20.62,39.53 L19.94,38.54 L19.32,37.40 L18.71,36.12 L18.07,34.71 L17.51,33.34 L16.95,31.87 L16.40,30.45 L15.85,29.02 L15.25,27.47 L14.64,25.88 L14.01,24.23 L13.35,22.53 L12.65,20.71 L11.97,18.98 L11.33,17.36 L10.77,15.98 L10.28,14.76 L9.83,13.66 L9.44,12.70 L9.15,11.92 L8.91,11.22 L8.74,10.60 L8.65,10.04 L8.68,9.48 L8.82,8.99 L9.08,8.57 L9.44,8.25 L9.86,8.05 L10.30,8.00 L10.73,8.08 L11.09,8.29 L11.43,8.62 L11.71,9.08 L11.98,9.64 L12.29,10.32 L12.63,11.09 L13.01,11.99 L13.38,12.99 L13.74,14.03 L14.13,15.13 L14.60,16.20 L15.22,17.22 L15.95,18.09 L16.84,18.84 L17.84,19.45 L18.86,19.88 L20.15,20.24 L21.42,20.46 L22.79,20.58 L24.20,20.63 L25.73,20.67 L27.26,20.74 L28.70,20.83 L30.15,20.94 L31.65,21.06 L33.26,21.17 L35.07,21.28 L36.89,21.40 L38.61,21.52 L40.44,21.65 L42.21,21.78 L44.01,21.92 L45.97,22.08 L48.19,22.29 L50.29,22.51 L52.25,22.73 L53.98,22.93 L55.53,23.13 L56.91,23.37 L58.15,23.73 L59.32,24.27 L60.40,25.00 L61.38,25.91 L62.21,26.86 L63.08,27.92 L63.96,28.93 L64.93,29.90 L65.93,30.68 L67.02,31.29 L68.15,31.71 L69.34,31.94 L70.62,32.05 L71.99,32.06 L73.45,32.03 L75.08,31.98 L76.63,31.95 L78.12,31.94 L79.50,31.93 L80.76,31.94 L81.86,31.95 L82.79,31.99 L83.68,32.12 L84.56,32.38 L85.40,32.83 L86.10,33.44 L86.61,34.20 L86.92,35.03 L87.08,35.91 L87.11,36.86 L87.09,37.91 L87.08,39.00 L87.08,40.19 L87.09,41.65 L87.12,43.11 L87.17,44.67 L87.21,46.34 L87.26,47.88 L87.30,49.29 L87.33,50.58 L87.35,51.62 L87.33,52.54 L87.22,53.35 L86.91,54.17 L86.44,54.84 L85.80,55.40 L85.10,55.77 L84.36,55.97 L83.55,55.99 L82.70,55.89 L81.80,55.63 L80.93,55.20 L80.03,54.58 L79.12,53.80 L78.18,52.91 L77.27,51.91 L76.30,50.71 L75.37,49.51 L74.43,48.30 L73.39,46.97 L72.30,45.60 L71.20,44.26 L70.06,42.90 L68.83,41.47',source:'lap',lap:2,partial:false,recordedLap:2}
  };
  function showGuestDemo(){
    return enabled&&typeof fetch==='function'&&!!globalThis.VertexCloud&&!globalThis.VertexCloud.state?.()?.signedIn;
  }
  async function decodeMaybeGzip(buffer){
    const bytes=new Uint8Array(buffer);
    if(bytes.length>=2&&bytes[0]===0x1f&&bytes[1]===0x8b){
      if(typeof DecompressionStream==='undefined')throw Error('Este navegador no soporta descompresión gzip para la sesión demo.');
      const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).text();
    }
    return new TextDecoder().decode(bytes);
  }
  async function openDemoSession(){
    const statusEl=typeof document!=='undefined'?document.querySelector?.('.session-loading-card>span'):null;
    if(statusEl)statusEl.textContent='Descargando sesión demo…';
    const [metaRes,telRes]=await Promise.all([
      fetch(DEMO_BASE+'safety-car-demo.meta.json',{cache:'no-cache'}),
      fetch(DEMO_BASE+'safety-car-demo.jsonl.gz')
    ]);
    if(!metaRes.ok||!telRes.ok)throw Error('No se pudo cargar la sesión demo. Comprueba tu conexión e inténtalo de nuevo.');
    const [remoteMeta,telBuf]=await Promise.all([metaRes.json(),telRes.arrayBuffer()]);
    if(statusEl)statusEl.textContent='Procesando telemetría…';
    const telText=await decodeMaybeGzip(telBuf);
    const builder=new VertexBrowserCore.LapBuilder();
    for(const line of telText.split('\n')){if(line.trim())builder.push(JSON.parse(line));}
    const laps=builder.finish();
    let cars={},brands={};
    try{[cars,brands]=await catalogs();}catch{}
    const meta=VertexBrowserCore.metadata({...remoteMeta,id:DEMO_ID,name:remoteMeta.name||DEMO_ITEM.name});
    Object.assign(meta,{
      id:DEMO_ID,
      name:remoteMeta.name||DEMO_ITEM.name,
      demo:true,
      featured:false,
      lapCount:laps.length,
      videoPath:'demo',
      availability:{local:false,cloud:false,demo:true}
    });
    const key=String(meta.carOrdinal??''),info=cars[key];
    meta.carName=typeof info==='string'?info:info?.name||remoteMeta.carName||DEMO_ITEM.carName;
    meta.brand=brands[key]||remoteMeta.brand||DEMO_ITEM.brand;
    const item={
      meta,
      laps,
      file:null,
      video:null,
      demoVideoUrl:remoteMeta.videoUrl||DEMO_VIDEO_FALLBACK,
      url:null,
      preview:remoteMeta.preview||DEMO_ITEM.preview
    };
    sessions.set(DEMO_ID,item);
    return item;
  }
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
    if(path==='sessions'){
      const result=new Map([...saved].map(([id,item])=>[id,{...item.meta,preview:item.preview}]));
      for(const [id,item] of sessions)if(id!==DEMO_ID||showGuestDemo())result.set(id,{...item.meta,preview:item.preview});
      if(showGuestDemo()&&!result.has(DEMO_ID))result.set(DEMO_ID,{...DEMO_ITEM});
      return [...result.values()];
    }
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
      if(showGuestDemo()&&!merged.some(item=>item.id===DEMO_ID))merged.unshift(enrich({...DEMO_ITEM}));
      return VertexHomeModel.page(merged,query.get('offset'),query.get('limit'));
    }
    const [action,id]=path.split('/');
    if(action==='feature'){
      if(id===DEMO_ID)throw Error('La sesión demo es de solo lectura');
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
      if(id===DEMO_ID){
        await openDemoSession();
      }else{
        const cloudItem=(globalThis.VertexCloud?.cachedSessions?.()||[]).find(item=>item.id===id);
        if(cloudItem){
          const opened=await VertexCloud.openCloudSession(cloudItem,progress=>{const el=document.querySelector('.session-loading-card>span');if(el)el.textContent=progress.phase+' · '+progress.percent+'%';});
          const [cars,brands]=await catalogs();
          const info=cars[String(opened.meta.carOrdinal)],carName=typeof info==='string'?info:info?.name||opened.meta.name;
          opened.meta.carName=carName;opened.meta.brand=brands[String(opened.meta.carOrdinal)]||null;
          sessions.set(id,{meta:opened.meta,laps:opened.laps,file:null,video:null,cloudVideo:opened.cloudVideo,url:null,preview:cloudItem.preview});
        }
      }
    }
    const item=get(id);
    if(action==='sessions')return {meta:{...item.meta},laps:item.laps};
    if(action==='delete'){release(item);sessions.delete(id);return {ok:true};}
    if(action==='sync'){
      const offset=Number(body.offset)||0;
      item.meta.offset=offset;
      if(id!==DEMO_ID&&item.meta.availability?.cloud)await globalThis.VertexCloud?.updateCloudMetadata?.(id,{sync_offset:offset});
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
    if(item.demoVideoUrl){
      item.url=item.demoVideoUrl;
      return;
    }
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
    const isDemo=!!session?.meta?.demo;
    if(isDemo){
      $('view-eyebrow').textContent='SESIÓN DEMO';
      $('feature-session').hidden=true;
      $('export-session').hidden=true;
      $('analysis-cloud-actions').hidden=true;
      $('delete-session').hidden=false;
      $('delete-session').lastElementChild.textContent='Salir de la sesión demo';
    }else{
      $('feature-session').hidden=false;
      $('export-session').hidden=false;
      $('analysis-cloud-actions').hidden=false;
      $('export-session').lastElementChild.textContent='Guardar archivo .vrtx original';
      $('delete-session').lastElementChild.textContent='Cerrar sesión de esta pestaña';
    }
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
    $('delete-session').onclick=action(async()=>{if(!session)return;const id=session.meta.id,isDemo=!!session.meta.demo;clearVideo();await request('delete/'+id,{});openHome();await list();$('message').textContent=isDemo?'Sesión demo cerrada.':'Sesión cerrada. Tu archivo original no se ha eliminado.';});
    globalThis.VertexCloud?.onChange?.(s=>{
      if(s?.signedIn){
        if(sessions.has(DEMO_ID)){release(sessions.get(DEMO_ID));sessions.delete(DEMO_ID);}
        if(session?.meta?.demo&&typeof openHome==='function'){clearVideo();openHome();}
      }
    });
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
