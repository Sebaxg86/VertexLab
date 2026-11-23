/* Persistent local library. Metadata is separate from the original package. */
(function(root){
  let connection;
  function db(){return connection??=new Promise((resolve,reject)=>{const r=indexedDB.open('vertexlab-library',1);r.onupgradeneeded=()=>{r.result.createObjectStore('sessions',{keyPath:'id'});r.result.createObjectStore('settings');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  async function transaction(store,mode,operation){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction(store,mode),request=operation(tx.objectStore(store));let value;request.onsuccess=()=>{value=request.result;};tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('No se pudo guardar la biblioteca'));});}
  const setting=(key,value)=>value===undefined?transaction('settings','readonly',s=>s.get(key)):transaction('settings','readwrite',s=>s.put(value,key));
  const records=()=>transaction('sessions','readonly',s=>s.getAll());
  const update=record=>transaction('sessions','readwrite',s=>s.put(record));
  async function save(file,item,progress){
    const destination=await setting('directory'),record={id:item.meta.id,meta:item.meta,preview:item.preview,name:file.name,size:file.size};
    const estimate=await navigator.storage?.estimate?.();if(!destination&&estimate?.quota&&estimate.quota-estimate.usage<file.size*1.1)throw Error('No hay espacio suficiente para guardar esta sesión. Elige una carpeta o ábrela temporalmente.');
    let handle,writable;
    try{
      if(destination){if(await destination.queryPermission({mode:'readwrite'})!=='granted')throw Error('Vuelve a elegir la carpeta para autorizar el guardado.');record.directory=destination;record.filename=record.id+'.vrtx';handle=await destination.getFileHandle(record.filename,{create:true});record.storage='folder';}
      else if(navigator.storage?.getDirectory){const folder=await (await navigator.storage.getDirectory()).getDirectoryHandle('sessions',{create:true});record.filename=record.id+'.vrtx';handle=await folder.getFileHandle(record.filename,{create:true});record.storage='private';}
      if(handle&&!handle.createWritable){if(record.storage==='folder')throw Error('Este navegador no puede escribir en la carpeta elegida. Usa el almacenamiento de VertexLab.');const folder=await (await navigator.storage.getDirectory()).getDirectoryHandle('sessions');await folder.removeEntry(record.filename);handle=null;delete record.filename;}
      if(handle){writable=await handle.createWritable();for(let offset=0;offset<file.size;offset+=1024**2){await writable.write(await file.slice(offset,offset+1024**2).arrayBuffer());progress?.({phase:'Guardando en este dispositivo',percent:Math.round(Math.min(file.size,offset+1024**2)/file.size*100)});}await writable.close();writable=null;}
      else {record.storage='database';record.file=file.slice();}
      await update(record);return record;
    }catch(error){await writable?.abort().catch(()=>{});if(handle&&record.filename){const directory=record.directory||await (await navigator.storage.getDirectory()).getDirectoryHandle('sessions');await directory.removeEntry(record.filename).catch(()=>{});}throw Error(error.name==='QuotaExceededError'?'No hay espacio suficiente. Puedes abrir el archivo temporalmente.':error.message);}
  }
  async function file(record){
    if(record.storage==='database')return new File([record.file],record.name);
    let directory=record.directory;
    if(directory){if(await directory.queryPermission({mode:'read'})!=='granted'&&await directory.requestPermission({mode:'read'})!=='granted')throw Error('Autoriza la carpeta para abrir esta sesión.');}
    else directory=await (await navigator.storage.getDirectory()).getDirectoryHandle('sessions');
    const blob=await (await directory.getFileHandle(record.filename)).getFile();return new File([blob],record.name,{lastModified:blob.lastModified});
  }
  async function forget(id){await transaction('sessions','readwrite',s=>s.delete(id));}
  root.VertexLibrary={setting,records,save,file,update,forget};
})(globalThis);
