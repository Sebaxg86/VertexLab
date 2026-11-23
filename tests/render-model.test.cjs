const test=require('node:test'),assert=require('node:assert/strict');
const {reduce,mapData,extent,segments}=require('../public/render-model.js');
test('pixel reduction preserves narrow spikes and source order without changing recordings',()=>{
 const rows=Array.from({length:10000},(_,i)=>({t:i/100,y:i===501?100:i===502?-70:0}));
 const result=reduce(rows,'t','y',0,100,100);
 assert.ok(result.length<=404);assert.ok(result.includes(rows[501]));assert.ok(result.includes(rows[502]));
 assert.ok(result.every((r,i)=>!i||r.t>=result[i-1].t));assert.equal(rows.length,10000);
});
test('zoom includes neighbours and never removes discontinuities or missing readings',()=>{
 const rows=Array.from({length:100},(_,i)=>({t:i,y:i,gap:i===50}));rows[51].y=null;
 const result=reduce(rows,'t','y',49,52,1);
 assert.equal(result[0],rows[48]);assert.equal(result.at(-1),rows[52]);assert.ok(result.includes(rows[50]));assert.ok(result.includes(rows[51]));
});
test('map bounds reuse immutable session rows and invalidate on selection changes',()=>{
 const a={rows:[{x:1,z:2},{x:4,z:8}]},b={rows:[{x:-5,z:20}]};
 const first=mapData([a]);assert.equal(first,mapData([a]));assert.equal(first.xmax,4);
 assert.equal(mapData([a,b]).xmin,-5);assert.equal(mapData([b]).zmax,20);
});

test('spatial lookup returns crossing segments, skips gaps and is independent of previous viewport',()=>{
 const rows=[{x:0,z:0},{x:150,z:0},{x:300,z:0,gap:true},{x:350,z:0}];
 assert.deepEqual(segments(rows,{xmin:90,xmax:110,zmin:-1,zmax:1}).map(s=>s.index),[1]);
 assert.deepEqual(segments(rows,{xmin:310,xmax:320,zmin:-1,zmax:1}).map(s=>s.index),[3]);
 assert.deepEqual(segments(rows,{xmin:900,xmax:910,zmin:900,zmax:910}),[]);
});
test('visible extrema include neighbours without scanning offscreen signals',()=>{const rows=Array.from({length:1000},(_,i)=>({t:i,y:i===500?10000:i}));assert.deepEqual(extent(rows,'t','y',10,20),[0,20]);});
