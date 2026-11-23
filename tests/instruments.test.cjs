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
