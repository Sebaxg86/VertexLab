const test = require('node:test');
const assert = require('node:assert/strict');
const {toVideo, fromVideo} = require('../public/timeline.js');
const meta = {version:2, offset:0, syncSegments:[
  {tStart:.2, tEnd:10, videoStart:.02},
  {tStart:10.1, tEnd:20, videoStart:10.8}
]};
test('start latency is not invented footage', () => assert.equal(toVideo(meta,.1),null));
test('maps both sections using their OBS anchors', () => {
  assert.ok(Math.abs(toVideo(meta,5)-4.82)<1e-8);
  assert.ok(Math.abs(toVideo(meta,15)-15.7)<1e-8);
  assert.ok(Math.abs(fromVideo(meta,15.7)-15)<1e-8);
});
test('native video playback skips the tail before pause', () => assert.equal(fromVideo(meta,10.5),10.1));
test('manual correction applies to all sections', () => assert.ok(Math.abs(toVideo({...meta,offset:.4},15)-16.1)<1e-8));
test('legacy sessions retain offset mapping', () => {
  assert.equal(toVideo({offset:2},3),5);
  assert.equal(fromVideo({offset:2},5),3);
});


test('opening or replaying starts at the first actual synchronized image',()=>{
  const {nextPlayable}=require('../public/timeline.js');
  assert.equal(nextPlayable(meta,0,20),.2);
  assert.equal(nextPlayable(meta,10.05,20),10.1);
  assert.equal(nextPlayable(meta,5,20),5);
  assert.equal(nextPlayable(meta,21,30),null);
  assert.equal(nextPlayable({version:2,syncSegments:[]},0,20),null);
});
test('playable start respects correction, bounds and the video duration',()=>{
 const {nextPlayable}=require('../public/timeline.js');
 assert.equal(nextPlayable({offset:-2},0,20,10),2);
 assert.equal(nextPlayable({...meta,offset:-1},0,20,30),1.18);
 assert.equal(nextPlayable(meta,15,20,1),null);
});
