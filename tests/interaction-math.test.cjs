const test=require('node:test'),assert=require('node:assert/strict');
const {hitSegments,cameraPan,scrollIndex}=require('../public/interaction-math.js');
const line=(lapId,y,t)=>({lapId,a:{x:0,y,t,d:0,row:{speed:50}},b:{x:100,y,t:t+10,d:100,row:{speed:100}}});
test('picks the actual hovered lap and interpolates session time',()=>{const hit=hitSegments([line(0,10,0),line(1,30,100)],50,29);assert.equal(hit.lapId,1);assert.equal(hit.time,105);assert.equal(hit.d,50);assert.equal(hitSegments([line(0,10,0)],50,70),null);});
test('near-overlapping paths keep a stable hovered lap until another is closer',()=>{assert.equal(hitSegments([line(0,10,0),line(1,10,100)],50,10,12,1).lapId,1);assert.equal(hitSegments([line(0,10,0),line(1,30,100)],50,10,12,1).lapId,0);});
test('camera centers the reference car at any zoom',()=>{const sample={x:30,z:40},center=[20,25],scale=200;const pan=cameraPan(sample,center,scale);assert.equal((sample.x-center[0])*scale+pan[0],0);assert.equal(-(sample.z-center[1])*scale+pan[1],0);});
test('telemetry scroll advances one row with two full cards visible',()=>{assert.equal(scrollIndex(0,100,7),1);assert.equal(scrollIndex(1,-100,7),0);assert.equal(scrollIndex(5,100,7),5);assert.equal(scrollIndex(0,-1,7),0);});
