const test = require('node:test');
const assert = require('node:assert/strict');
const {values} = require('../public/instruments.js');
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
