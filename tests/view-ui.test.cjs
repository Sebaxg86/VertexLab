const test=require('node:test');const assert=require('node:assert/strict');
const {connection}=require('../public/view-ui.js');
test('LIVE requires a fresh real packet and a connected stream',()=>{const state={packet:{active:true},lastPacket:100};assert.equal(connection(state,101).label,'LIVE');assert.equal(connection(state,105).label,'OFF LIVE');assert.equal(connection(state,101,false).online,false);assert.equal(connection({...state,udpError:'busy'},101).online,false);assert.equal(connection(null,101).online,false);});
test('paused packets preserve connection while instruments require active driving',()=>{const result=connection({packet:{active:false},lastPacket:100},101);assert.equal(result.online,true);assert.equal(result.active,false);assert.match(result.detail,/pausa/);});

test('clock skew and millisecond rounding cannot reject a fresh packet',()=>{assert.equal(connection({packet:{active:true},lastPacket:100.0009},100).online,true);const state={packet:{active:true},lastPacket:9999999999,packetAge:.015};assert.equal(connection(state,10,true,10).active,true);assert.equal(connection(state,16,true,10).online,false);});
test('brief transport reconnects keep LIVE and readings stable, but a real outage expires',()=>{const state={packet:{active:true},packetAge:.02};assert.equal(connection(state,10.4,false,10).online,true);assert.equal(connection(state,10.4,false,10).active,true);assert.equal(connection(state,12.1,false,10).online,false);});
test('UDP gaps clear current readings before the connection grace period ends',()=>{const state={packet:{active:true},packetAge:2.5};const result=connection(state,10,true,10);assert.equal(result.online,true);assert.equal(result.active,false);assert.match(result.detail,/interrumpida/);assert.equal(connection({...state,packetAge:5},10,true,10).online,false);});

test('zero car IDs retain the last valid model',()=>{
 const {rememberCar}=require('../public/view-ui.js');const car={ordinal:1009,name:'Toyota GR86'};
 assert.deepEqual(rememberCar(car,{packet:{carOrdinal:0},carName:'Vehicle #0'}),car);
 assert.deepEqual(rememberCar(null,{packet:{carOrdinal:0},lastKnownCar:car}),car);
 assert.equal(rememberCar(car,{packet:{carOrdinal:1006},carName:'Porsche'}).name,'Porsche');
});
