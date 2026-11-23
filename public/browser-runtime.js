/* In-memory storage adapter for the static viewer. Session files never leave the device. */
(function(root){
  const enabled=document.body.dataset.mode==='viewer',sessions=new Map();let catalog=null;
  async function catalogs(){
    if(!catalog)catalog=Promise.all(['cars.json','car-brands.json'].map(async name=>{const response=await fetch(new URL(name,document.baseURI));if(!response.ok)throw Error('No se pudo cargar el catálogo del visor');return response.json();}));
    return catalog;
  }
  function get(id){const item=sessions.get(id);if(!item)throw Error('Vuelve a abrir el archivo .vrtx en este dispositivo');return item;}
  function release(item){if(item?.url)URL.revokeObjectURL(item.url);chartLayers.clear();mapLayer=null;mapSegments=[];chartSegments.clear();RaceRender.mapData([]);}
  async function open(file,progress){
    if(!enabled)throw Error('Visor no disponible');
    const [cars,brands]=await catalogs();
    return new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('viewer-worker.js',document.baseURI));
      const cancel=$('loading-cancel');cancel.hidden=false;
      function finish(){worker.terminate();cancel.hidden=true;cancel.onclick=null;}
      cancel.onclick=()=>{finish();reject(Error('Apertura cancelada'));};
      worker.onerror=()=>{finish();reject(Error('No se pudo procesar el archivo. Comprueba la memoria disponible y vuelve a abrirlo.'));};
      worker.onmessage=event=>{
        if(event.data.progress){progress?.(event.data.progress);return;}
        finish();
        if(event.data.error){reject(Error(event.data.error));return;}
        try{
          const result=event.data.result,id=crypto.randomUUID().replaceAll('-','');
          const meta={...result.meta,id,portableView:result.view,videoPath:result.video?'archivo local':null};
          const info=cars[String(meta.carOrdinal)],carName=typeof info==='string'?info:info?.name||meta.name;
          meta.carName=carName;meta.brand=brands[String(meta.carOrdinal)]||null;
          const item={meta,laps:result.laps,file,video:result.video,url:null};
          item.preview=VertexBrowserCore.preview(item.laps,meta);sessions.set(id,item);resolve({id,hasVideo:!!result.video});
        }catch(error){reject(error);}
      };
      worker.postMessage(file);
    });
  }
  async function request(path,body){
    if(path==='sessions')return [...sessions.values()].map(item=>({...item.meta,preview:item.preview}));
    const [action,id]=path.split('/'),item=get(id);
    if(action==='sessions')return {meta:{...item.meta},laps:item.laps};
    if(action==='feature'){item.meta.featured=!!body.featured;return {featured:item.meta.featured};}
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
    if(!session){$('title').textContent='Abre una sesión';$('view-eyebrow').textContent='VISOR PORTABLE';$('session-info').textContent='Archivos .vrtx · privados en tu dispositivo';}
  }
  function setup(){
    if(!enabled)return;
    const button=document.createElement('button');button.className='viewer-open';button.textContent='Abrir archivo .vrtx';button.onclick=()=>$('portable-file').click();
    $('video-empty').querySelector('p').textContent='Tus vueltas, en cualquier pantalla';
    $('video-empty').querySelector('small').textContent='Abre una sesión .vrtx. El archivo se procesa aquí y no se sube a ningún servidor.';
    $('video-empty').append(button);
    $('delete-session').onclick=action(async()=>{if(!session)return;const id=session.meta.id;clearVideo();await request('delete/'+id,{});openLiveView();await list();$('message').textContent='Sesión cerrada. Tu archivo original no se ha eliminado.';});
    if('serviceWorker' in navigator&&isSecureContext)navigator.serviceWorker.register(new URL('sw.js',document.baseURI)).catch(()=>{});
    decorate();
  }
  root.VertexBrowser={enabled,open,request,videoURL,original,decorate,setup};
})(globalThis);
