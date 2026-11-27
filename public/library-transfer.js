/* ZIP bundles contain complete .vrtx packages, never loose session/video files. */
(function(root){
 const LIMIT=256*1024**3;
 function day(now=new Date()){return [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');}
 function bundleName(now){return 'VRTX-Sessions-'+day(now)+'.zip';}
 function entries(items){
  if(items.length>20000)throw Error('El ZIP admite hasta 10000 sesiones');
  const names=new Set(),files=[];let bytes=0;
  for(const item of items){
   const name=item.filename,parts=name.split('/'),key=name.toLowerCase();
   if(!name||name.startsWith('/')||name.includes('\\')||name.includes(':')||parts.includes('..')||names.has(key)||item.encrypted||((item.externalFileAttributes>>>16)&0xf000)===0xa000)throw Error('El ZIP contiene rutas, duplicados o entradas no permitidas');
   names.add(key);if(item.directory)continue;
   if(!name.toLowerCase().endsWith('.vrtx'))throw Error('El ZIP debe contener únicamente archivos .vrtx');
   if(!Number.isSafeInteger(item.uncompressedSize)||item.uncompressedSize<0)throw Error('Tamaño de archivo ZIP inválido');
   bytes+=item.uncompressedSize;files.push(item);
  }
  if(!files.length||files.length>10000||bytes>LIMIT)throw Error('ZIP vacío o demasiado grande (máximo 10000 sesiones y 256 GiB)');
  return files;
 }
 root.VertexBatchModel={day,bundleName,entries};if(typeof module!=='undefined')module.exports=root.VertexBatchModel;
})(globalThis);
let libraryZipTask;
async function libraryZip(){
 if(globalThis.zip)return globalThis.zip;
 await (libraryZipTask??=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='vendor-zip-2.25.0.js';script.onload=resolve;script.onerror=()=>{libraryZipTask=null;reject(Error('No se pudo cargar el gestor de ZIP'));};document.head.append(script);}));
 zip.configure({useWebWorkers:false});return zip;
}
function transferReader(z,file){
 class LocalReader extends z.Reader{
  constructor(){super();this.size=file.size;}
  async readUint8Array(offset,length){
   for(let attempt=0;attempt<3;attempt++)try{
    const bytes=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(new Uint8Array(reader.result));reader.onerror=()=>reject(reader.error||Error('No se pudo leer el archivo'));reader.readAsArrayBuffer(file.slice(offset,offset+length));});
    if(bytes.length!==length)throw Error('Lectura incompleta del archivo');return bytes;
   }catch(error){if(attempt===2)throw error;}
  }
 }
 return new LocalReader();
}
function downloadLibraryFile(file,name){const url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>{URL.revokeObjectURL(url);void releaseExport(file);},600000);}
function downloadLibraryURL(result){const link=document.createElement('a');link.href=result.url;link.download=result.name;document.body.append(link);link.click();link.remove();}
async function transferTemp(name){
 if(!navigator.storage?.getDirectory)return null;
 const root=await navigator.storage.getDirectory(),directory=await root.getDirectoryHandle('transfer-'+crypto.randomUUID(),{create:true});
 let writable;const cleanup=async()=>{await writable?.abort().catch(()=>{});await root.removeEntry(directory.name,{recursive:true}).catch(()=>{});};
 try{const handle=await directory.getFileHandle(name,{create:true});if(!handle.createWritable){await cleanup();return null;}writable=await handle.createWritable();return {handle,stream:writable,cleanup};}catch(error){await cleanup();throw error;}
}
let transferHashTask;
async function transferHash() {
 if(globalThis.hashwasm)return globalThis.hashwasm;
 if(!transferHashTask)transferHashTask=new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  script.src='vendor-sha256-4.13.0.js';
  script.onload=()=>resolve(globalThis.hashwasm);
  script.onerror=()=>{transferHashTask=null;script.remove();reject(Error('No se pudo cargar la verificación de archivos'));};
  document.head.append(script);
 });
 return transferHashTask;
}

async function writeComponentPackage(parts, overrides, view, zip, hash, destination) {
 const original=JSON.parse(parts.metaText);
 const metadataKeys=['id','name','created','ended','duration','offset','version',
  'carOrdinal','carClass','carPI','automatic','events','syncSegments','syncState','featured'];
 const meta={};
 for(const key of metadataKeys){
  const value=overrides?.[key]??original[key];
  if(value!==undefined)meta[key]=value;
 }
 meta.version??=1;
 if(typeof view?.offset==='number')meta.offset=view.offset;
 const videoTypes={'video/mp4':'mp4','video/x-matroska':'mkv','video/quicktime':'mov',
  'video/webm':'webm','video/x-flv':'flv','video/mp2t':'ts','video/x-m4v':'m4v'};
 const savedExtension=/^video\.(mp4|mkv|mov|webm|flv|ts|m4v)$/i.exec(parts.videoName||'');
 const extension=savedExtension?.[1].toLowerCase()||videoTypes[parts.videoFile?.type]||'mp4';
 const video=parts.videoFile?'video.'+extension:null;
 const members={
  'session.json':new Blob([JSON.stringify(meta)]),
  'view.json':new Blob([JSON.stringify(view||{})]),
  'telemetry.jsonl':new Blob([parts.telemetryText])
 };
 if(video)members[video]=parts.videoFile;
 const writer=new zip.ZipWriter(destination||new zip.BlobWriter(),{zip64:true});
 const files={};
 for(const [name,blob] of Object.entries(members)){
  const digest=await hash.createSHA256();
  const source=blob.stream().pipeThrough(new TransformStream({transform(chunk,controller){
   digest.update(chunk);
   controller.enqueue(chunk);
  }}));
  await writer.add(name,source,{level:name===video?0:6});
  files[name]={size:blob.size,sha256:digest.digest('hex')};
 }
 await writer.add('manifest.json',new zip.TextReader(JSON.stringify({format:'VertexLab session',version:1,files,video})));
 return writer.close();
}

async function prepareComponentExport(record, view) {
 const [parts,z,hash]=await Promise.all([VertexLibrary.loadComponents(record),libraryZip(),transferHash()]);
 const name=(record.meta.name||record.id)+'.vrtx';
 const temporary=await transferTemp('session.vrtx');
 try{
  const blob=await writeComponentPackage({...parts,videoName:record.videoName||record.meta?.cloud?.videoName},record.meta,view,z,hash,temporary?.stream);
  const file=new File([temporary?await temporary.handle.getFile():blob],name);
  if(temporary)exportCleanup.set(file,temporary.cleanup);
  return file;
 }catch(error){await temporary?.cleanup();throw error;}
}
const exportCleanup=new WeakMap();
async function releaseExport(file) {
 const cleanup=exportCleanup.get(file);
 if(cleanup){exportCleanup.delete(file);await cleanup();}
}

async function exportLibrarySessions(items, view){
 if(!items.length)return;
 if(items.length>10000)throw Error('Exporta hasta 10000 sesiones por archivo ZIP');
 closeHomeMenus();
 const browser=!!globalThis.VertexBrowser?.enabled,name=VertexBatchModel.bundleName();
 const finish=startSessionLoading(items.length===1?'Exportando sesión':'Exportando '+items.length+' sesiones','Preparando video y telemetría');
 const progress=text=>{document.querySelector('.session-loading-card>span').textContent=text;};
 let temporary,stream;
 try{
  if(!browser){const result=await api('portable/export-batch',{ids:items.map(item=>item.id),date:VertexBatchModel.day()});downloadLibraryURL(result);}
  else if(items.length===1){const file=await VertexBrowser.source(items[0].id,view);downloadLibraryFile(file,file.name);}
  else{
   const z=await libraryZip();temporary=await transferTemp(name);
   stream=temporary?.stream;
   const writer=new z.ZipWriter(stream||new z.BlobWriter('application/zip'),{zip64:true,level:0});
   let totalBytes=0;
   for(let index=0;index<items.length;index++){
    const file=await VertexBrowser.source(items[index].id),safe=file.name.replace(/[\\/<>:"|?*\x00-\x1f]/g,'_');
    try{
     totalBytes+=file.size;if(totalBytes>256*1024**3)throw Error('El ZIP supera el límite de 256 GiB');
     await writer.add(String(index+1).padStart(3,'0')+'-'+safe,transferReader(z,file),{level:0,onprogress:(done,total)=>progress('Sesión '+(index+1)+' de '+items.length+' · '+Math.round(done/Math.max(1,total)*100)+'%')});
    }finally{await releaseExport(file);}
   }
   const blob=await writer.close();stream=null;
   downloadLibraryFile(temporary?await temporary.handle.getFile():blob,name);if(temporary){const saved=temporary;setTimeout(()=>saved.cleanup(),600000);temporary=null;}
  }
  $('message').textContent=items.length===1?'Archivo .vrtx exportado.':'ZIP exportado con '+items.length+' sesiones completas.';return true;
 }catch(error){await stream?.abort().catch(()=>{});throw error;}
 finally{await temporary?.cleanup();await finish();}
}
async function importLibraryBundle(file){
 const finish=startSessionLoading('Importando sesiones','Verificando el archivo ZIP');
 let reader;const imported=[];
 try{
  if(!globalThis.VertexBrowser?.enabled){const response=await fetch('/api/portable/import-batch',{method:'POST',headers:{'Content-Type':'application/zip'},body:file});const result=await response.json();if(!response.ok)throw Error(result.error);imported.push(...result.sessions);}
  else{
   const z=await libraryZip();reader=new z.ZipReader(transferReader(z,file));const entries=VertexBatchModel.entries(await reader.getEntries());
   for(let index=0;index<entries.length;index++){
    const entry=entries[index];let temp;
    try{
     temp=await transferTemp('session.vrtx');
     const blob=await entry.getData(temp?.stream||new z.BlobWriter(),{checkSignature:true,onprogress:(done,total)=>{document.querySelector('.session-loading-card>span').textContent='Extrayendo '+(index+1)+' de '+entries.length+' · '+Math.round(done/Math.max(1,total)*100)+'%';}});
     const packageFile=new File([temp?await temp.handle.getFile():blob],entry.filename.split('/').at(-1));
     const result=await VertexBrowser.importFile(packageFile,p=>{document.querySelector('.session-loading-card>span').textContent='Sesión '+(index+1)+' de '+entries.length+' · '+p.phase+' · '+p.percent+'%';});imported.push(result);
    }finally{await temp?.cleanup();}
   }
  }
  await list();await transitionView(openHome);$('message').textContent=imported.length+' sesiones importadas en la biblioteca.';
 }catch(error){
  let rollbackFailed=false;
  if(globalThis.VertexBrowser?.enabled)for(const item of imported)try{await VertexBrowser.request('delete/'+item.id,{confirm:true,removeLocal:true});}catch{rollbackFailed=true;}
  await HomeLibrary.refresh();
  if(rollbackFailed)throw Error('La importación falló y algunas copias nuevas no pudieron retirarse. Revisa la biblioteca.');
  if(/File format|central directory|Bad signature/i.test(error.message))throw Error('El ZIP contiene una sesión dañada o incompatible. No se añadió ninguna sesión.');
  throw error;
 }
 finally{await reader?.close();await finish();}
}

if(typeof module!=="undefined")module.exports.writeComponentPackage=writeComponentPackage;
