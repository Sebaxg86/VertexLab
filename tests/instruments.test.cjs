const test = require('node:test');
const assert = require('node:assert/strict');
const {values,duration,rpmReference,revLights} = require('../public/instruments.js');
test('old recordings do not acquire invented instrument values', () => {
  const v = values({speed:120,throttle:80});
  assert.equal(v.steer,null); assert.equal(v.total,null);
  assert.deepEqual(v.tires,Array.from({length:4},()=>({temp:null,slip:null})));
});
test('converts body accelerations to signed G and steering to input', () => {
  const v = values({steer:-127,accelX:9.80665,accelZ:-9.80665});
  assert.equal(v.steer,-1); assert.equal(v.lateral,1); assert.equal(v.longitudinal,-1);
  assert.ok(Math.abs(v.total-Math.SQRT2)<1e-12);
});
test('zero is a real measurement and slip is magnitude, not grip percentage', () => {
  const v=values({steer:0,accelX:0,accelZ:0,tireTempsC:[0,80,100,120],tireSlipCombined:[0,-1.2,.3,.4]});
  assert.equal(v.steer,0); assert.equal(v.total,0);
  assert.equal(v.tires[0].temp,0); assert.equal(v.tires[1].slip,1.2);
});
test('times switch units at sixty seconds with three decimals',()=>{
  assert.deepEqual(duration(45.1234),{text:'45.123',unit:'s'});
  assert.deepEqual(duration(60),{text:'1.000',unit:'min'});
  assert.deepEqual(duration(90),{text:'1.500',unit:'min'});
});
test('RPM lights prefer the motor limit and explicitly fall back to a measured peak',()=>{
  assert.deepEqual(rpmReference({rpm:4000,engineMaxRpm:8000},6000),{maximum:8000,engine:true,ratio:.5});
  assert.deepEqual(rpmReference({rpm:4000},6000),{maximum:6000,engine:false,ratio:2/3});
  assert.equal(rpmReference({},0).ratio,null);
});
test('RPM lights fill symmetrically from edges toward the center',()=>{
  const half=revLights(.4,3,100);
  assert.deepEqual(half.lit,[true,true,true,true,false,false,false,false,false,false,false,false,true,true,true,true]);
  assert.equal(half.shift,false);
});
test('estimated shift cue lights every bar near the RPM reference, while moving forward',()=>{
  assert.equal(revLights(.96,3,100).shift,true);
  assert.ok(revLights(.96,3,100).lit.every(Boolean));
  assert.equal(revLights(.96,0,100).shift,false);
  assert.equal(revLights(1,1,0).shift,false);
  assert.ok(revLights(null,3,100).lit.every(value=>!value));
});
test('GR86 recorded full-throttle RPM reaches blue before the reported engine maximum',()=>{const {ratio}=rpmReference({rpm:8250,engineMaxRpm:9000},8816);const lights=revLights(ratio,3,150);assert.equal(lights.shift,true);assert.ok(lights.lit.every(Boolean));assert.equal(revLights(7800/9000,3,150).shift,false);});
test('shift cue hysteresis tolerates limiter oscillations and releases after RPM drop',()=>{assert.equal(revLights(.88,3,150).shift,true);assert.equal(revLights(.87,3,150).shift,false);assert.equal(revLights(.87,3,150,true).shift,true);assert.equal(revLights(.859,3,150,true).shift,false);assert.equal(revLights(null,3,150,true).shift,false);assert.equal(revLights(.91,0,150,true).shift,false);});

test('red has a usable range before blue and each pair fades progressively',()=>{assert.equal(revLights(.79,3,100).shift,false);assert.ok(revLights(.79,3,100).levels[7]>.8);assert.ok(revLights(.8,3,100).levels.every(v=>v===1));assert.equal(revLights(.879,3,100).shift,false);assert.equal(revLights(.88,3,100).shift,true);assert.ok(revLights(.025,3,100).levels[0]<revLights(.075,3,100).levels[0]);});

test('gear changes restart a fast RPM light sweep in either direction',()=>{const {revSweep}=require('../public/instruments.js');let state=revSweep(null,{context:'live:1',gear:3,ratio:.9,animate:true},0);assert.equal(state.ratio,.9);state=revSweep(state,{context:'live:1',gear:4,ratio:.6,animate:true},100);assert.equal(state.ratio,0);assert.equal(state.active,true);state=revSweep(state,{context:'live:1',gear:4,ratio:.65,animate:true},210);assert.ok(state.ratio>0&&state.ratio<.65);state=revSweep(state,{context:'live:1',gear:4,ratio:.7,animate:true},320);assert.equal(state.ratio,.7);assert.equal(state.active,false);state=revSweep(state,{context:'live:1',gear:3,ratio:.8,animate:true},400);assert.equal(state.ratio,0);assert.equal(state.active,true);});
test('seeking paused analysis, reconnecting or changing cars never creates fake shift sweeps',()=>{const {revSweep}=require('../public/instruments.js');const initial=revSweep(null,{context:'session:false',gear:3,ratio:.6,animate:false},0);assert.equal(revSweep(initial,{context:'session:false',gear:5,ratio:.8,animate:false},50).ratio,.8);assert.equal(revSweep(initial,{context:'new-car',gear:5,ratio:.8,animate:true},50).active,false);const missing=revSweep(initial,{context:'session:false',gear:null,ratio:null,animate:true},50);assert.equal(missing.active,false);assert.equal(missing.ratio,null);});
test('G-meter point follows inertia convention: right turn left, braking up, acceleration down',()=>{
  const {gPointOffset}=require('../public/instruments.js');
  const rightTurn=gPointOffset(1.5,0,55);
  assert.ok(rightTurn.x<0&&Math.abs(rightTurn.y)<1e-9);
  const leftTurn=gPointOffset(-1.5,0,55);
  assert.ok(leftTurn.x>0);
  const braking=gPointOffset(0,-1.5,55);
  assert.ok(braking.y<0&&Math.abs(braking.x)<1e-9);
  const accelerating=gPointOffset(0,1.0,55);
  assert.ok(accelerating.y>0);
});
