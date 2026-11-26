const test=require('node:test'),assert=require('node:assert/strict');
const {readiness,obsState,forzaOnline}=require('../public/connect-model.js');
test('every Forza, OBS and telemetry-only combination has the requested readiness label',()=>{
 for(const [f,o,t,tone,text] of [
  [true,true,false,'green','LISTO PARA CAPTURAR'],[true,false,true,'green','LISTO PARA CAPTURAR · SIN VIDEO'],[true,true,true,'green','LISTO PARA CAPTURAR · SIN VIDEO'],
  [false,true,false,'yellow','Esperando a Forza'],[false,false,true,'yellow','Esperando a Forza'],[false,true,true,'yellow','Esperando a Forza'],
  [true,false,false,'yellow','Esperando a OBS'],[false,false,false,'gray','Desconectado']
 ])assert.deepEqual(readiness(f,o,t),{tone,text});
});
test('OBS signal gives priority to the explicit telemetry-only selection',()=>{
 assert.deepEqual(obsState(true,false),{tone:'green',text:'OBS conectado'});
 assert.deepEqual(obsState(false,false),{tone:'gray',text:'OBS desconectado'});
 for(const connected of [true,false])assert.deepEqual(obsState(connected,true),{tone:'yellow',text:'Solo telemetría'});
});
test('configured Forza status tolerates paused UDP but the first setup still requires fresh packets',()=>{
 const state={packet:{active:false},packetAge:40,gameRunning:true,connect:{forzaConnected:false}};
 assert.equal(forzaOnline(state,true),true);assert.equal(forzaOnline(state,false),false);
 assert.equal(forzaOnline({...state,gameRunning:false},true),false);
 assert.equal(forzaOnline({...state,udpError:'busy'},true),false);
 assert.equal(forzaOnline(null,true),false);
});
