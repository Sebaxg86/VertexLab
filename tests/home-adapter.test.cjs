const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const model=require('../public/home-model.js');
function adapter({failRemove=false,failUpdate=false}={}){
 const record={id:'a'.repeat(32),meta:{id:'a'.repeat(32),created:1,name:'Saved fixture'},preview:{path:'M0,0 L1,1'}};
 const calls=[];
 const context={document:{body:{dataset:{mode:'viewer'}}},navigator:{userAgent:'test',platform:'test'},URLSearchParams,
  VertexHomeModel:model,VertexLibrary:{records:async()=>[record],update:async value=>{calls.push(['update',value]);if(failUpdate)throw Error('write failed');},remove:async id=>{calls.push(['remove',id]);if(failRemove)throw Error('permission denied');}},
  chartLayers:new Map(),chartSegments:new Map(),RaceRender:{mapData:()=>[]}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../public/browser-runtime.js'),'utf8'),context);
 return {api:context.VertexBrowser.request,calls,id:record.id};
}
test('browser home lists and favorites unopened archives without loading video or telemetry',async()=>{
 const {api,calls,id}=adapter();const page=await api('library?offset=0&limit=12');
 assert.equal(page.total,1);assert.equal(page.items[0].availability.local,true);assert.equal(page.items[0].availability.cloud,false);
 assert.equal((await api('feature/'+id,{featured:true})).featured,true);assert.equal(calls[0][0],'update');
 assert.equal((await api('library?offset=0&limit=12')).items[0].featured,true);
});
test('failed favorite persistence leaves the library metadata unchanged',async()=>{
 const {api,id}=adapter({failUpdate:true});await assert.rejects(()=>api('feature/'+id,{featured:true}),/write failed/);
 assert.equal((await api('library?offset=0&limit=12')).items[0].featured,undefined);
});
test('deleting a local archive requires confirmation and preserves the catalog on file failure',async()=>{
 const {api,calls,id}=adapter({failRemove:true});
 await assert.rejects(()=>api('delete/'+id,{removeLocal:true}),/Confirma/);assert.equal(calls.length,0);
 await assert.rejects(()=>api('delete/'+id,{confirm:true,removeLocal:true}),/permission denied/);
 assert.equal((await api('library?offset=0&limit=12')).total,1);
});
test('successful local deletion removes the managed copy and its home listing',async()=>{
 const {api,calls,id}=adapter();await api('delete/'+id,{confirm:true,removeLocal:true});
 assert.deepEqual(calls[0],['remove',id]);assert.equal((await api('library?offset=0&limit=12')).total,0);
});
test('guest viewer shows read-only Safety Car DEMO and hides it once signed in',async()=>{
 const zlib=require('node:zlib');
 const core=require('../public/browser-core.js');
 const DEMO_ID='0000000000000000000000000000de01';
 let signedIn=false;
 const demoMeta={id:DEMO_ID,name:'Safety Car DEMO',carOrdinal:4265,carClass:7,carPI:999,created:1795859619,ended:1795859780,duration:10,version:2,syncSegments:[{tStart:0,tEnd:10,videoStart:0}],videoUrl:'https://vertexlab.racing/demo/safety-car-demo.mp4'};
 const sampleRows=[
  {t:0,x:0,z:0,speed:100,distance:0,lapTime:0,raceTime:0,lap:0,timestamp:1000,rpm:5000,gear:3,throttle:100,brake:0,carOrdinal:4265,carClass:7,carPI:999,breakBefore:false},
  {t:5,x:100,z:0,speed:120,distance:100,lapTime:5,raceTime:5,lap:0,timestamp:6000,rpm:6000,gear:4,throttle:100,brake:0,carOrdinal:4265,carClass:7,carPI:999,breakBefore:false}
 ];
 const gzBytes=zlib.gzipSync(Buffer.from(sampleRows.map(r=>JSON.stringify(r)).join('\n')+'\n','utf8'));
 const fetched=[];
 const fakeFetch=async url=>{
  const s=String(url);fetched.push(s);
  if(s.endsWith('cars.json'))return {ok:true,json:async()=>({'4265':'2021 Mercedes-AMG GT Black Series'})};
  if(s.endsWith('car-brands.json'))return {ok:true,json:async()=>({'4265':{name:'Mercedes-AMG',logo:'brand-mercedes-amg.png'}})};
  if(s.endsWith('safety-car-demo.meta.json'))return {ok:true,json:async()=>demoMeta};
  if(s.endsWith('safety-car-demo.jsonl.gz'))return {ok:true,arrayBuffer:async()=>gzBytes.buffer.slice(gzBytes.byteOffset,gzBytes.byteOffset+gzBytes.byteLength)};
  return {ok:false,status:404};
 };
 const context={document:{body:{dataset:{mode:'viewer'}},baseURI:'https://app.vertexlab.racing/'},navigator:{userAgent:'test',platform:'test'},
  URL,URLSearchParams,fetch:fakeFetch,Blob,Response,DecompressionStream,TextDecoder,Uint8Array,
  VertexHomeModel:model,VertexBrowserCore:core,VertexCloud:{state:()=>({signedIn}),cachedSessions:()=>[]},
  VertexLibrary:{records:async()=>[],update:async()=>{},remove:async()=>{}},
  chartLayers:new Map(),chartSegments:new Map(),RaceRender:{mapData:()=>[]}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../public/browser-runtime.js'),'utf8'),context);
 const {request,prepareVideo,videoURL}=context.VertexBrowser;

 // Guest sees Safety Car DEMO in library WITHOUT fetching demo telemetry or video yet.
 const guestPage=await request('library?offset=0&limit=12');
 assert.equal(guestPage.total,1);
 assert.equal(guestPage.items[0].id,DEMO_ID);
 assert.equal(guestPage.items[0].name,'Safety Car DEMO');
 assert.equal(guestPage.items[0].demo,true);
 assert.ok(!fetched.some(u=>u.includes('/demo/')));

 // Opening demo fetches meta + gz telemetry and prepares direct HTTPS video URL.
 const opened=await request('sessions/'+DEMO_ID);
 assert.equal(opened.meta.name,'Safety Car DEMO');
 assert.equal(opened.meta.demo,true);
 assert.equal(opened.laps.length,1);
 await prepareVideo(DEMO_ID);
 assert.equal(videoURL(DEMO_ID),'https://vertexlab.racing/demo/safety-car-demo.mp4');

 // Demo is read-only for feature mutations.
 await assert.rejects(()=>request('feature/'+DEMO_ID,{featured:true}),/solo lectura/);

 // Once signed in, demo disappears from library completely.
 signedIn=true;
 const signedInPage=await request('library?offset=0&limit=12');
 assert.equal(signedInPage.total,0);
});
