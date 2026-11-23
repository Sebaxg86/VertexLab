const test=require('node:test');const assert=require('node:assert/strict');
const {connection}=require('../public/view-ui.js');
test('LIVE requires a fresh real packet and a connected stream',()=>{const state={packet:{active:true},lastPacket:100};assert.equal(connection(state,101).label,'LIVE');assert.equal(connection(state,102).label,'OFF LIVE');assert.equal(connection(state,101,false).online,false);assert.equal(connection({...state,udpError:'busy'},101).online,false);assert.equal(connection(null,101).online,false);});
test('paused packets preserve connection while instruments require active driving',()=>{const result=connection({packet:{active:false},lastPacket:100},101);assert.equal(result.online,true);assert.equal(result.active,false);assert.match(result.detail,/pausa/);});
