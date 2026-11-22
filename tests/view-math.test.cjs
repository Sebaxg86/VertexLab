const test = require('node:test');
const assert = require('node:assert/strict');
const {zoomRange,anchoredPan,followRange} = require('../public/view-math.js');
test('map zoom keeps the world point under the mouse fixed, including existing pan',()=>{
  const pan=[25,-15],pointer=[180,90],center=[400,200],ratio=2;
  const world=pointer.map((value,i)=>value-center[i]-pan[i]);
  const next=anchoredPan(pan,pointer,center,ratio);
  assert.deepEqual(world.map((value,i)=>center[i]+value*ratio+next[i]),pointer);
});
test('chart wheel zoom preserves the pointer position in the distance window',()=>{
  const range=zoomRange({start:100,end:900},[0,1000],300,2);
  assert.deepEqual(range,{start:200,end:600});
  assert.equal((300-range.start)/(range.end-range.start),.25);
});
test('zoom stays within lap boundaries and zooming out restores full extent',()=>{
  const range=zoomRange(null,[0,1000],980,2);
  assert.ok(range.start>=0&&range.end<=1000);
  assert.deepEqual(zoomRange(range,[0,1000],980,.5),{start:0,end:1000});
});
test('playback follows the cursor without changing the visible span',()=>{
  const range=followRange({start:100,end:300},[0,1000],600);
  assert.deepEqual(range,{start:500,end:700});
  assert.equal(range.end-range.start,200);
});
test('follow handles lap start, lap end and the unzoomed view',()=>{
  assert.deepEqual(followRange({start:100,end:300},[0,1000],20),{start:0,end:200});
  assert.deepEqual(followRange({start:100,end:300},[0,1000],980),{start:800,end:1000});
  assert.equal(followRange(null,[0,1000],400),null);
});
