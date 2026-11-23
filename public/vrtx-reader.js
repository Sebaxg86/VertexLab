/* Shared browser/Node ZIP reader. Videos remain lazy slices of the user's File. */
(function(root){
  const MAX_TELEMETRY=128*1024**2,MAX_PACKAGE=256*1024**3;
  async function read(file,{zip,hash,core,progress=()=>{}}){
    if(file.size>MAX_PACKAGE)throw Error('El archivo supera 256 GiB');
    zip.configure({useWebWorkers:false});
    const archive=new zip.ZipReader(new zip.BlobReader(file),{checkSignature:true,checkOverlappingEntry:true});
    let processed=0,lastProgress=0;
    try{
      const entries=[];for await(const entry of archive.getEntriesGenerator()){entries.push(entry);if(entries.length>5)throw Error('Demasiados archivos en el paquete .vrtx');}const byName=new Map(entries.map(entry=>[entry.filename,entry]));
      if(entries.length>5||byName.size!==entries.length||!byName.has('manifest.json'))throw Error('Paquete .vrtx inválido o duplicado');
      async function text(name,limit){const entry=byName.get(name);if(!entry||entry.uncompressedSize>limit)throw Error('Metadatos demasiado grandes');return entry.getData(new zip.TextWriter(),{checkSignature:true});}
      const manifest=JSON.parse(await text('manifest.json',65536));
      if(manifest.format!=='VertexLab session'||manifest.version!==1)throw Error('Versión .vrtx no compatible');
      const names=['session.json','view.json','telemetry.jsonl'];
      if(manifest.video!==null){if(!/^video\.(mp4|mkv|mov|webm|flv|ts|m4v)$/.test(manifest.video))throw Error('Nombre de video inválido');names.push(manifest.video);}
      if(!manifest.files||Object.keys(manifest.files).length!==names.length||entries.length!==names.length+1||names.some(name=>!byName.has(name)||!Object.hasOwn(manifest.files,name)))throw Error('Faltan archivos o hay rutas no permitidas');
      const total=names.reduce((sum,name)=>sum+byName.get(name).uncompressedSize,0);
      if(!Number.isSafeInteger(total)||total>MAX_PACKAGE)throw Error('Tamaño .vrtx inválido');
      let meta,view,video=null,laps;
      for(const name of names){
        const entry=byName.get(name),expected=manifest.files[name];
        if(name===manifest.video&&entry.compressionMethod!==0)throw Error('Reexporta esta sesión desde VertexLab: el video debe estar almacenado sin compresión ZIP');
        const limit=name==='view.json'?65536:name==='session.json'?4*1024**2:name==='telemetry.jsonl'?MAX_TELEMETRY:MAX_PACKAGE;
        if(entry.encrypted||!Number.isSafeInteger(entry.uncompressedSize)||entry.uncompressedSize>limit)throw Error(name==='telemetry.jsonl'?'Esta sesión supera el límite de telemetría del visor web (128 MiB). Ábrela en VertexLab de escritorio.':'Archivo cifrado o demasiado grande');
        if(expected?.size!==entry.uncompressedSize||!/^[a-f0-9]{64}$/.test(expected?.sha256))throw Error('Manifiesto de integridad inválido');
        const digest=await hash.createSHA256(),decoder=new TextDecoder('utf-8',{fatal:true});
        let written=0,buffer='';const builder=name==='telemetry.jsonl'?new core.LapBuilder():null;
        function append(line){if(builder.count>=250000)throw Error('La sesión supera 250.000 muestras; ábrela en VertexLab de escritorio.');builder.push(JSON.parse(line));}
        function lines(final=false){let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(line.length>2*1024**2)throw Error('Muestra demasiado grande');if(line.trim())append(line);}if(buffer.length>2*1024**2)throw Error('Muestra demasiado grande');if(final&&buffer.trim()){append(buffer);buffer='';}}
        await entry.getData(new WritableStream({write(chunk){
          written+=chunk.length;if(written>expected.size)throw Error('Tamaño de archivo incorrecto');digest.update(chunk);processed+=chunk.length;
          if(name!==manifest.video){buffer+=decoder.decode(chunk,{stream:true});if(builder)lines();}
          const now=performance.now();if(now-lastProgress>150){lastProgress=now;progress({percent:Math.round(processed/Math.max(1,total)*100),phase:builder?'Leyendo telemetría':'Verificando integridad'});}
        }}),{checkSignature:true});
        if(written!==expected.size||digest.digest('hex')!==expected.sha256)throw Error('El archivo .vrtx está incompleto o dañado');
        if(name!==manifest.video)buffer+=decoder.decode();
        if(builder){lines(true);laps=builder.finish();}
        else if(name==='session.json')meta=core.metadata(JSON.parse(buffer));
        else if(name==='view.json'){view=JSON.parse(buffer);if(!view||typeof view!=='object'||Array.isArray(view))throw Error('Estado del análisis inválido');}
        else{
          if(entry.compressionMethod!==0)throw Error('Reexporta esta sesión desde VertexLab: el video debe estar almacenado sin compresión ZIP');
          const offset=entry.offset;
          if(!Number.isSafeInteger(offset)||offset<0)throw Error('Posición de video inválida');
          const local=new DataView(await file.slice(offset,offset+30).arrayBuffer());
          if(local.byteLength!==30||local.getUint32(0,true)!==0x04034b50)throw Error('Cabecera de video inválida');
          const nameLength=local.getUint16(26,true),extraLength=local.getUint16(28,true),start=offset+30+nameLength+extraLength;
          const localName=new TextDecoder().decode(await file.slice(offset+30,offset+30+nameLength).arrayBuffer());
          if(localName!==name||start+written>file.size||entry.compressedSize!==written)throw Error('Rango de video inválido');
          const extension=name.split('.').at(-1),types={mp4:'video/mp4',m4v:'video/mp4',webm:'video/webm',mkv:'video/x-matroska',mov:'video/quicktime',ts:'video/mp2t',flv:'video/x-flv'};
          video={offset:start,size:written,type:types[extension]};
        }
      }
      progress({percent:100,phase:'Preparando análisis'});return {meta,view,laps,video};
    }finally{await archive.close();}
  }
  root.VertexPackageReader={read,MAX_TELEMETRY};if(typeof module!=='undefined')module.exports=root.VertexPackageReader;
})(globalThis);
