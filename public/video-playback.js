/* One outstanding play request per decoder; interrupted seeks are not fatal. */
(function(root){
 const pending=new WeakMap();
 function play(video,onError){
  if(video.ended||!video.paused||pending.has(video))return;
  const source=video.getAttribute('src');
  let result;try{result=video.play();}catch(error){onError(error);return;}
  const task=Promise.resolve(result).catch(error=>{if(error.name!=='AbortError'&&source===video.getAttribute('src'))onError(error);}).finally(()=>{if(pending.get(video)===task)pending.delete(video);});pending.set(video,task);
 }
 // The media clock can lead the image by a frame. Read the PTS submitted for composition.
 const frames=new WeakMap();
 function observe(video){
  if(frames.has(video)||typeof video.requestVideoFrameCallback!=='function')return;
  const state={time:null,source:null};frames.set(video,state);
  for(const event of ['emptied','seeking'])video.addEventListener(event,()=>{state.time=null;state.source=null;});
  function presented(now,metadata){
   state.time=Number.isFinite(metadata.mediaTime)?metadata.mediaTime:null;state.source=video.getAttribute('src');
   video.requestVideoFrameCallback(presented);
  }
  video.requestVideoFrameCallback(presented);
 }
 function presentationTime(video){
  const state=frames.get(video);
  return !video.seeking&&state&&state.source===video.getAttribute('src')&&Number.isFinite(state?.time)&&Math.abs(state.time-video.currentTime)<.25?state.time:video.currentTime;
 }
 function message(error,video){
  const code=video.error?.code;
  if(error?.name==='NotAllowedError')return 'Safari requiere iniciar el video con un toque. Pulsa Reproducir; si persiste, prueba silenciar el audio.';
  if(code===4||error?.name==='NotSupportedError')return 'Safari no admite este video o su contenedor. Usa una copia MP4 H.264 con audio AAC. La telemetría sigue disponible.';
  if(code===3)return 'Safari no pudo decodificar el video. Usa una copia MP4 H.264/AAC de menor resolución. La telemetría sigue disponible.';
  return 'No se pudo leer el video local'+(code?' (código '+code+')':'')+'. Cierra y vuelve a abrir la sesión. La telemetría sigue disponible.';
 }
 root.VertexPlayback={play,message,observe,presentationTime};if(typeof module!=='undefined')module.exports=root.VertexPlayback;
})(globalThis);
