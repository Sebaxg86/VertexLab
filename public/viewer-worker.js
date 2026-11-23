importScripts('vendor-zip-2.25.0.js','vendor-sha256-4.13.0.js','browser-core.js','vrtx-reader.js');
const pendingReads=new Map();let readId=0;
self.onmessage=async event=>{
  if(event.data.readReply){const pending=pendingReads.get(event.data.id);if(!pending)return;pendingReads.delete(event.data.id);event.data.error?pending.reject(Error(event.data.error)):pending.resolve(event.data.buffer);return;}
  const remote=event.data.remote;
  const file=remote?{remote:true,size:event.data.size,slice(start,end){return {arrayBuffer:()=>new Promise((resolve,reject)=>{const id=++readId;pendingReads.set(id,{resolve,reject});self.postMessage({readRange:{id,start,end}});})};}}:event.data;
  try{const result=await VertexPackageReader.read(file,{zip,hash:hashwasm,core:VertexBrowserCore,progress:progress=>self.postMessage({progress})});self.postMessage({result});}
  catch(error){
    if(!remote&&/I\/?O|Read operation|NotReadable|No se pudo leer el archivo|End of central directory|Zip64 end of central directory/i.test(error.message)){self.postMessage({retryRead:true});return;}
    if(/End of central directory/i.test(error.message)){self.postMessage({error:'No se pudo leer el final de la sesión guardada. La copia puede estar incompleta o no estar disponible. Vuelve a importar el archivo .vrtx original desde almacenamiento local; conserva el original y no borres los datos de VertexLab.'});return;}
    self.postMessage({error:/I\/?O|Read operation|NotReadable/i.test(error.message)?'Safari no pudo leer el archivo grande. Vuelve a abrirlo desde almacenamiento local. '+error.message:(error.message||'No se pudo abrir el archivo .vrtx')});
  }
};
