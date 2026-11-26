const test=require('node:test');const assert=require('node:assert/strict');
const {connection}=require('../public/view-ui.js');
test('LIVE requires a fresh real packet and a connected stream',()=>{const state={packet:{active:true},lastPacket:100};assert.equal(connection(state,101).label,'LIVE');assert.equal(connection(state,105).label,'OFFLINE');assert.equal(connection(state,101,false).online,false);assert.equal(connection({...state,udpError:'busy'},101).online,false);assert.equal(connection(null,101).online,false);});
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

test('paused driving values freeze, resume and survive a page reload',()=>{
 const {rememberSample}=require('../public/view-ui.js');const sample={active:true,carOrdinal:1009,speed:84,rpm:6000};
 assert.equal(rememberSample(null,{packet:sample}),sample);
 assert.equal(rememberSample(sample,{packet:{active:false,carOrdinal:0,speed:0}}),sample);
 assert.equal(rememberSample(null,{lastDrivingPacket:sample}),sample);
 const resumed={...sample,speed:92};assert.equal(rememberSample(sample,{packet:resumed}),resumed);
});
test('running Forza keeps a paused session online across UDP silence, transport loss does not',()=>{
 const state={packet:{active:false},packetAge:30,gameRunning:true};
 assert.equal(connection(state,50,true,50).online,true);assert.equal(connection(state,50,true,50).active,false);
 assert.equal(connection({...state,gameRunning:false},50,true,50).online,false);
 assert.equal(connection(state,55,false,50).online,false);
});

test('LIVE asks to drive only before its first sample, and retains paused telemetry',()=>{
 const {notice,rememberSample}=require('../public/view-ui.js');
 assert.match(notice(false,null),/Abre Forza/);
 assert.match(notice(true,null),/Juega/);
 const sample=rememberSample(null,{packet:{active:true,carOrdinal:1009,speed:84}});
 assert.equal(notice(true,sample),null);
 const paused=rememberSample(sample,{packet:{active:false,carOrdinal:0}});
 assert.equal(notice(true,paused),null);
 assert.match(notice(false,paused),/Abre Forza/);
 assert.equal(notice(true,rememberSample(null,{lastDrivingPacket:sample})),null);
});
