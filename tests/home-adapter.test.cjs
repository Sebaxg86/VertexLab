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
