const test=require('node:test'),assert=require('node:assert/strict');
const {analyze,metadata,preview}=require('../public/browser-core.js');
function row(t,lap,x,extra={}){return {t,lap,x,z:0,timestamp:t*1000,speed:100,lapTime:t,...extra};}
test('browser lap processing preserves measured values and breaks gaps exactly',()=>{
 const rows=[row(0,0,0),row(.1,0,5),row(.2,1,0),row(.3,1,3),row(2,1,4),row(2.1,2,0)];
 const saved=JSON.stringify(rows),laps=analyze(rows);
 assert.equal(JSON.stringify(rows),saved);assert.deepEqual(laps.map(l=>l.id),[0,1,2]);
 assert.equal(laps[0].rows[1].d,5);assert.equal(laps[1].rows[1].d,3);
 assert.equal(laps[1].rows[2].gap,true);assert.equal(laps[1].rows[2].d,3);assert.equal(laps[1].partial,true);
 assert.equal(laps[1].rows[1].speed,100);
});
test('timestamp resets split laps while resume duplicates keep the same session clock',()=>{
 const laps=analyze([row(0,0,0),row(.1,0,1),row(.1,0,2,{breakBefore:true}),row(.2,0,3,{timestamp:0})]);
 assert.equal(laps.length,2);assert.equal(laps[0].rows[2].gap,true);assert.equal(laps[0].rows[2].d,1);
});
test('malformed samples and untrusted synchronization are rejected',()=>{
 assert.throws(()=>analyze([row(1,0,0),row(0,0,0)]),/ordenada/);
 assert.throws(()=>analyze([row(0,0,NaN)]),/inválida/);
 assert.throws(()=>metadata({name:'test',created:1,version:2,syncSegments:[{tStart:2,tEnd:1,videoStart:0}]}),/Sincronización/);
});
test('browser library previews prefer the second lap and keep free-session gaps',()=>{
 const laps=analyze([row(0,0,0),row(.1,0,10),row(.2,1,0),row(.3,1,20)]);
 assert.equal(preview(laps,{automatic:true}).recordedLap,2);
 const free=analyze([row(0,0,0,{lapTime:0}),row(.1,0,10,{lapTime:0}),row(.2,1,1000,{lapTime:0}),row(.3,1,1010,{lapTime:0})]);
 const route=preview(free,{automatic:false});assert.equal(route.source,'session');assert.equal((route.path.match(/M/g)||[]).length,2);
});
test('complete first and final closed-circuit laps are marked complete while aborted final laps stay partial',()=>{
 const mk=(lap,baseT,finish=true)=>(finish?[[0,0],[80,0],[80,80],[0,80],[2,1]]:[[0,0],[80,0]]).map(([x,z],k)=>({t:baseT+k*.5,timestamp:(baseT+k*.5)*1000,lap,x,z,speed:100,lapTime:k*10}));
 const full=analyze([...mk(0,0),...mk(1,3),...mk(2,6)]);
 assert.deepEqual(full.map(l=>l.partial),[false,false,false]);
 const aborted=analyze([...mk(0,0),...mk(1,3,false)]);
 assert.deepEqual(aborted.map(l=>l.partial),[false,true]);
});
