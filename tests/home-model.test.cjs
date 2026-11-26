const test=require('node:test'),assert=require('node:assert/strict');
const {page,windowRange,availability,actions}=require('../public/home-model.js');
test('library pages are deterministic, bounded and retain actual storage state',()=>{
 const items=Array.from({length:105},(_,i)=>({id:String(i),created:i,availability:{local:true,cloud:false}}));
 const first=page(items,0,12),second=page(items,first.nextOffset,12);
 assert.equal(first.total,105);assert.equal(first.items.length,12);assert.equal(first.items[0].id,'104');
 assert.equal(second.items[0].id,'92');assert.equal(new Set([...first.items,...second.items].map(i=>i.id)).size,24);
 assert.equal(page(items,96,12).nextOffset,null);assert.equal(page(items,1000,12).items.length,0);
 assert.equal(page(items,0,100000).items.length,48);assert.equal(items[0].id,'0');
});
test('ten thousand sessions keep only a viewport and overscan in the DOM',()=>{
 for(const scroll of [0,1120,560000,1119000]){
  const range=windowRange(10000,scroll,800);
  assert.ok(range.end-range.start<=15);assert.ok(range.start>=0);assert.ok(range.end<=10000);
  assert.equal(range.top+(range.end-range.start)*112+range.bottom,1120000);
 }
 assert.deepEqual(windowRange(0,0,800),{start:0,end:0,top:0,bottom:0});
});
test('local, synchronized and cloud-only badges represent separate availability',()=>{
 assert.deepEqual(availability({}),{local:true,cloud:false,temporary:false});
 assert.deepEqual(availability({availability:{local:true,cloud:true}}),{local:true,cloud:true,temporary:false});
 assert.deepEqual(availability({availability:{local:false,cloud:true}}),{local:false,cloud:true,temporary:false});
});
test('cloud actions are scaffolding and never enable unsupported cloud deletion',()=>{
 const local=actions({id:'a'},null);assert.equal(local.find(a=>a.key==='delete-local').enabled,true);assert.equal(local.find(a=>a.key==='sync').enabled,false);
 assert.equal(actions({id:'a'},'a').find(a=>a.key==='delete-all').enabled,false);
 const cloud=actions({id:'a',featured:true,availability:{local:false,cloud:true}},null);
 assert.equal(cloud[0].label,'Quitar favorito');assert.ok(!cloud.some(a=>a.key==='delete-local'));
 assert.equal(cloud.find(a=>a.key==='download').enabled,false);assert.equal(cloud.find(a=>a.key==='delete-all').enabled,false);
});

test('library scrolling settles on a whole row at the top, except at the strict bottom bound',()=>{
 const {snapTop}=require('../public/home-model.js');
 assert.equal(snapTop(151,1000),112);assert.equal(snapTop(180,1000),224);
 assert.equal(snapTop(1000,1000),1000);assert.equal(snapTop(-1,1000),0);assert.equal(snapTop(50,50),50);
 for(let i=0;i<2000;i+=17)assert.equal(i>=1866?snapTop(i,1867):snapTop(i,1867)%112,i>=1866?1867:0);
});
