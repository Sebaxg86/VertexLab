/* Read-only presentation states; capture authorization remains on the service. */
(function(root){
 function readiness(forza,obs,only){
  if(forza&&(obs||only))return {tone:'green',text:only?'LISTO PARA CAPTURAR · SIN VIDEO':'LISTO PARA CAPTURAR'};
  if(!forza&&(obs||only))return {tone:'yellow',text:'Esperando a Forza'};
  if(forza)return {tone:'yellow',text:'Esperando a OBS'};
  return {tone:'gray',text:'Desconectado'};
 }
 function obsState(connected,only){return only?{tone:'yellow',text:'Solo telemetría'}:connected?{tone:'green',text:'OBS conectado'}:{tone:'gray',text:'OBS desconectado'};}
 function forzaOnline(state,quick){
  if(!quick)return !!state?.connect?.forzaConnected;
  return !!(state?.packet&&!state.udpError&&(state.gameRunning===true||(Number.isFinite(state.packetAge)&&state.packetAge<5)));
 }
 const api={readiness,obsState,forzaOnline};root.VertexConnectModel=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
