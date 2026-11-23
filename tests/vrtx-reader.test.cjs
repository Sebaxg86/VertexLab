const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const zip=require('../public/vendor-zip-2.25.0.js'),hash=require('../public/vendor-sha256-4.13.0.js');
const core=require('../public/browser-core.js'),{read}=require('../public/vrtx-reader.js');
zip.configure({useWebWorkers:false});
async function fixture(change=()=>{}){
 const rows=[0,.1,.2,.3].map((t,i)=>({t,timestamp:i*100,lap:i<2?0:1,x:i,z:0,speed:120,rpm:7000}));
 const contents={
 'session.json':JSON.stringify({id:'source',name:'Synthetic reader test',created:10,ended:20,version:2,syncSegments:[{tStart:0,tEnd:.1,videoStart:0},{tStart:.2,tEnd:.3,videoStart:2}]}),
 'view.json':JSON.stringify({version:1,allMode:false,selected:[0,1],reference:1,t:.25}),
 'telemetry.jsonl':rows.map(r=>JSON.stringify(r)).join('\n'),
 'video.mp4':new Uint8Array([1,2,3,4,5,6,7,8])};
 const manifest={format:'VertexLab session',version:1,video:'video.mp4',files:{}};
 for(const [name,value] of Object.entries(contents)){const bytes=typeof value==='string'?Buffer.from(value):Buffer.from(value);manifest.files[name]={size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};}
 change(contents,manifest);
 const writer=new zip.ZipWriter(new zip.BlobWriter(),{zip64:true});
 for(const [name,value] of Object.entries({...contents,'manifest.json':JSON.stringify(manifest)}))await writer.add(name,new zip.BlobReader(new Blob([value])),{level:name==='video.mp4'?0:6});
 return writer.close();
}
test('ZIP64 packages preserve synchronized samples and expose video as a lazy byte slice',async()=>{
 const file=await fixture(),result=await read(file,{zip,hash,core});
 assert.equal(result.laps.length,2);assert.equal(result.laps[1].rows[1].rpm,7000);assert.equal(result.view.t,.25);assert.equal(result.meta.syncSegments[1].videoStart,2);
 assert.deepEqual([...new Uint8Array(await file.slice(result.video.offset,result.video.offset+result.video.size).arrayBuffer())],[1,2,3,4,5,6,7,8]);
});
test('modified payloads cannot bypass the manifest SHA-256 check',async()=>{
 const file=await fixture(contents=>{contents['video.mp4']=new Uint8Array([9,2,3,4,5,6,7,8]);});
 await assert.rejects(()=>read(file,{zip,hash,core}),/dañado/);
});
test('future versions and extra paths are rejected before publication',async()=>{
 await assert.rejects(()=>fixture((c,m)=>{m.version=9;}).then(file=>read(file,{zip,hash,core})),/Versión/);
 await assert.rejects(()=>fixture(c=>{c['../escape']='bad';}).then(file=>read(file,{zip,hash,core})),/Unsafe filename|Demasiados/);
});

test('local reads retry transient file provider failures and explain unavailable iPhone files',async()=>{
 const {readBytes}=require('../public/vrtx-reader.js');let reads=0;
 const file={slice:()=>({arrayBuffer:async()=>{if(++reads<3)throw Error('I/O Read operation failed');return new Uint8Array([1,2]).buffer;}})};
 assert.deepEqual([...await readBytes(file,0,2)],[1,2]);assert.equal(reads,3);
 await assert.rejects(()=>readBytes({slice:()=>({arrayBuffer:async()=>{throw Error('I/O Read operation failed');}})},0,2),/En mi iPhone/);
});
test('worker reads use FileReaderSync when available, without Blob streaming',async()=>{
 const {readBytes}=require('../public/vrtx-reader.js');const previous=global.FileReaderSync;
 try{global.FileReaderSync=class{readAsArrayBuffer(part){return part.bytes.buffer;}};
 assert.deepEqual([...await readBytes({slice:()=>({bytes:new Uint8Array([3,4])})},0,2)],[3,4]);
 }finally{if(previous===undefined)delete global.FileReaderSync;else global.FileReaderSync=previous;}
});
