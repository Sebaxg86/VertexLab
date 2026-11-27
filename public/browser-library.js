/* Persistent local library. Metadata is separate from the original package. */
(function(root){
  let connection;
  function db(){return connection??=new Promise((resolve,reject)=>{const r=indexedDB.open('vertexlab-library',1);r.onupgradeneeded=()=>{r.result.createObjectStore('sessions',{keyPath:'id'});r.result.createObjectStore('settings');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  async function transaction(store,mode,operation){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction(store,mode),request=operation(tx.objectStore(store));let value;request.onsuccess=()=>{value=request.result;};tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('No se pudo guardar la biblioteca'));});}
  const setting=(key,value)=>value===undefined?transaction('settings','readonly',s=>s.get(key)):transaction('settings','readwrite',s=>s.put(value,key));
  const records=()=>transaction('sessions','readonly',s=>s.getAll());
  const update=record=>transaction('sessions','readwrite',s=>s.put(record));
  async function bytes(blob){
    if(typeof FileReader==='undefined')return new Uint8Array(await blob.arrayBuffer());
    return new Uint8Array(await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error||Error('No se pudo leer la copia local'));reader.readAsArrayBuffer(blob);}));
  }
  function checkSize(blob,expected){if(!blob||!Number.isSafeInteger(blob.size)||blob.size!==expected||blob.size<22)throw Error('La copia guardada está incompleta o no está disponible. Vuelve a importar el .vrtx original desde almacenamiento local.');}
  async function verifyCopy(source,copy){
    checkSize(copy,source.size);
    const start=Math.max(0,source.size-65557),[original,stored]=await Promise.all([bytes(source.slice(start)),bytes(copy.slice(start))]);
    if(original.length!==stored.length||original.some((value,index)=>value!==stored[index]))throw Error('No se pudo verificar el final de la copia guardada. Conserva el .vrtx original y vuelve a importarlo.');
  }
  async function save(file,item,progress){
    const destination=await setting('directory'),record={id:item.meta.id,meta:item.meta,video:item.video,preview:item.preview,name:file.name,size:file.size};
    const estimate=await navigator.storage?.estimate?.();if(!destination&&estimate?.quota&&estimate.quota-estimate.usage<file.size*1.1)throw Error('No hay espacio suficiente para guardar esta sesión. Elige una carpeta o ábrela temporalmente.');
    let handle,writable;
    try{
      if(destination){if(await destination.queryPermission({mode:'readwrite'})!=='granted')throw Error('Vuelve a elegir la carpeta para autorizar el guardado.');record.directory=destination;record.filename=record.id+'.vrtx';handle=await destination.getFileHandle(record.filename,{create:true});record.storage='folder';}
      else if(navigator.storage?.getDirectory){const folder=await (await navigator.storage.getDirectory()).getDirectoryHandle('sessions',{create:true});record.filename=record.id+'.vrtx';handle=await folder.getFileHandle(record.filename,{create:true});record.storage='private';}
      if(handle&&!handle.createWritable){if(record.storage==='folder')throw Error('Este navegador no puede escribir en la carpeta elegida. Usa el almacenamiento de VertexLab.');const folder=await (await navigator.storage.getDirectory()).getDirectoryHandle('sessions');await folder.removeEntry(record.filename);handle=null;delete record.filename;}
      if(handle){writable=await handle.createWritable();for(let offset=0;offset<file.size;offset+=1024**2){const part=await bytes(file.slice(offset,Math.min(file.size,offset+1024**2)));if(part.length!==Math.min(1024**2,file.size-offset))throw Error('Lectura incompleta al guardar la sesión');await writable.write(part);progress?.({phase:'Guardando en este dispositivo',percent:Math.round(Math.min(file.size,offset+1024**2)/file.size*100)});}await writable.close();writable=null;}
      else {record.storage='database';record.file=file.slice();}
      progress?.({phase:'Verificando copia guardada',percent:100});
      await verifyCopy(file,handle?await handle.getFile():record.file);
      await update(record);return record;
    }catch(error){await writable?.abort().catch(()=>{});if(handle&&record.filename){const directory=record.directory||await (await navigator.storage.getDirectory()).getDirectoryHandle('sessions');await directory.removeEntry(record.filename).catch(()=>{});}throw Error(error.name==='QuotaExceededError'?'No hay espacio suficiente. Puedes abrir el archivo temporalmente.':error.message);}
  }
  async function saveComponents(item,{metaText,telemetryText,videoReader,videoSize,videoMime,videoName},progress){
    const destination=await setting('directory');
    const id=item.meta.id;
    const record={id,kind:'components',meta:item.meta,preview:item.preview,name:(item.meta.name||id)+'.vrtx',size:Number(videoSize)||0,video:videoSize?{offset:0,size:Number(videoSize),type:videoMime||'video/mp4'}:null,videoMime:videoMime||'video/mp4',videoName};
    const estimate=await navigator.storage?.estimate?.();
    if(!destination&&estimate?.quota&&estimate.quota-estimate.usage<(record.size+telemetryText.length)*1.1)throw Error('No hay espacio suficiente en este dispositivo para descargar esta sesión.');
    let dir=null;
    try{
      if(destination){
        if(await destination.queryPermission({mode:'readwrite'})!=='granted')throw Error('Vuelve a elegir la carpeta en Biblioteca para autorizar el guardado.');
        record.directory=destination;record.storage='folder';dir=await destination.getDirectoryHandle(id,{create:true});
      }else if(navigator.storage?.getDirectory){
        const rootDir=await (await navigator.storage.getDirectory()).getDirectoryHandle('sessions',{create:true});
        record.storage='private';dir=await rootDir.getDirectoryHandle(id,{create:true});
      }
      if(dir){
        const writeSmall=async(name,text)=>{const fh=await dir.getFileHandle(name,{create:true});if(!fh.createWritable)throw Error('NO_WRITABLE');const w=await fh.createWritable();await w.write(text);await w.close();};
        try{
          await writeSmall('meta.json',metaText);
          await writeSmall('telemetry.jsonl',telemetryText);
          if(videoReader&&videoSize>0){
            const vfh=await dir.getFileHandle('video.bin',{create:true});
            const vw=await vfh.createWritable();
            let offset=0,chunk=4*1024*1024;
            while(offset<videoSize){
              const end=Math.min(videoSize-1,offset+chunk-1);
              const part=await videoReader(offset,end);
              await vw.write(part);
              offset=end+1;
              progress?.({phase:'Descargando video',percent:Math.min(98,15+Math.round(offset/videoSize*83))});
            }
            await vw.close();
          }
          await update(record);
          return record;
        }catch(err){
          if(err.message!=='NO_WRITABLE'||record.storage==='folder')throw err;
          const rootDir=await (await navigator.storage.getDirectory()).getDirectoryHandle('sessions');
          await rootDir.removeEntry(id,{recursive:true}).catch(()=>{});
          dir=null;
        }
      }
      // IndexedDB fallback (e.g. Safari without createWritable)
      record.storage='database';
      record.metaText=metaText;
      record.telemetryText=telemetryText;
      if(videoReader&&videoSize>0){
        const parts=[];let offset=0,chunk=4*1024*1024;
        while(offset<videoSize){
          const end=Math.min(videoSize-1,offset+chunk-1);
          parts.push(await videoReader(offset,end));
          offset=end+1;
          progress?.({phase:'Descargando video',percent:Math.min(98,15+Math.round(offset/videoSize*83))});
        }
        record.videoBlob=new Blob(parts,{type:videoMime||'video/mp4'});
      }
      await update(record);
      return record;
    }catch(error){
      if(dir){
        const parent=record.directory||await (await navigator.storage.getDirectory()).getDirectoryHandle('sessions');
        await parent.removeEntry(id,{recursive:true}).catch(()=>{});
      }
      throw Error(error.name==='QuotaExceededError'?'No hay espacio suficiente en este dispositivo.':error.message);
    }
  }
  async function loadComponents(record){
    if(record.storage==='database'){
      return {metaText:record.metaText,telemetryText:record.telemetryText,videoFile:record.videoBlob?new File([record.videoBlob],record.id+'.mp4',{type:record.videoMime||'video/mp4'}):null};
    }
    let parent=record.directory;
    if(parent){if(await parent.queryPermission({mode:'read'})!=='granted'&&await parent.requestPermission({mode:'read'})!=='granted')throw Error('Autoriza la carpeta para abrir esta sesión.');}
    else parent=await (await navigator.storage.getDirectory()).getDirectoryHandle('sessions');
    const dir=await parent.getDirectoryHandle(record.id);
    const metaText=await (await (await dir.getFileHandle('meta.json')).getFile()).text();
    const telemetryText=await (await (await dir.getFileHandle('telemetry.jsonl')).getFile()).text();
    let videoFile=null;
    if(record.video){
      const vf=await (await dir.getFileHandle('video.bin')).getFile();
      if(record.size&&vf.size!==record.size)throw Error('La descarga local del video está incompleta. Elimina la copia local y vuelve a descargarla.');
      videoFile=vf.slice(0,vf.size,record.videoMime||'video/mp4');
    }
    return {metaText,telemetryText,videoFile};
  }
  async function file(record){
    if(record.storage==='database'){checkSize(record.file,record.size);return new File([record.file],record.name);}
    let directory=record.directory;
    if(directory){if(await directory.queryPermission({mode:'read'})!=='granted'&&await directory.requestPermission({mode:'read'})!=='granted')throw Error('Autoriza la carpeta para abrir esta sesión.');}
    else directory=await (await navigator.storage.getDirectory()).getDirectoryHandle('sessions');
    const blob=await (await directory.getFileHandle(record.filename)).getFile();checkSize(blob,record.size);return new File([blob],record.name,{lastModified:blob.lastModified});
  }
  async function forget(id){await transaction('sessions','readwrite',s=>s.delete(id));}
  async function remove(id){
    const record=await transaction('sessions','readonly',s=>s.get(id));if(!record)return;
    if(record.storage!=='database'){
      if(!/^[a-f0-9]{32}$/.test(id))throw Error('La ruta de la copia local no es válida');
      let directory=record.directory;
      if(directory){if(await directory.queryPermission({mode:'readwrite'})!=='granted'&&await directory.requestPermission({mode:'readwrite'})!=='granted')throw Error('Autoriza la carpeta para eliminar la copia local');}
      else directory=await (await navigator.storage.getDirectory()).getDirectoryHandle('sessions');
      try{
        if(record.kind==='components')await directory.removeEntry(id,{recursive:true});
        else{if(record.filename!==id+'.vrtx')throw Error('La ruta de la copia local no es válida');await directory.removeEntry(record.filename);}
      }catch(error){if(error.name!=='NotFoundError')throw error;}
    }
    await forget(id);
  }
  root.VertexLibrary={verifyCopy,setting,records,record:id=>transaction('sessions','readonly',s=>s.get(id)),save,saveComponents,loadComponents,file,update,forget,remove};
})(globalThis);
