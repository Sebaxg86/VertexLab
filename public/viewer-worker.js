importScripts('vendor-zip-2.25.0.js','vendor-sha256-4.13.0.js','browser-core.js','vrtx-reader.js');
self.onmessage=async event=>{
  try{const result=await VertexPackageReader.read(event.data,{zip,hash:hashwasm,core:VertexBrowserCore,progress:progress=>self.postMessage({progress})});self.postMessage({result});}
  catch(error){self.postMessage({error:error.message||'No se pudo abrir el archivo .vrtx'});}
};
