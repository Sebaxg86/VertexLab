importScripts('vendor-zip-2.25.0.js','vendor-sha256-4.13.0.js','browser-core.js','vrtx-reader.js');
self.onmessage=async event=>{
  try{const result=await VertexPackageReader.read(event.data,{zip,hash:hashwasm,core:VertexBrowserCore,progress:progress=>self.postMessage({progress})});self.postMessage({result});}
  catch(error){self.postMessage({error:/I\/?O|Read operation|NotReadable/i.test(error.message)?'No se pudo leer el archivo. Descarga el .vrtx completamente en Archivos, cópialo a «En mi iPhone» y vuelve a abrirlo. '+error.message:(error.message||'No se pudo abrir el archivo .vrtx')});}
};
