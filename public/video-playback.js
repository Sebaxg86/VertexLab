/* One outstanding play request per decoder; interrupted seeks are not fatal. */
(function(root){
 const pending=new WeakMap();
 function play(video,onError){
  if(!video.paused||pending.has(video))return;
  const source=video.getAttribute('src');
  let result;try{result=video.play();}catch(error){onError(error);return;}
  const task=Promise.resolve(result).catch(error=>{if(error.name!=='AbortError'&&source===video.getAttribute('src'))onError(error);}).finally(()=>{if(pending.get(video)===task)pending.delete(video);});pending.set(video,task);
 }
 function message(error,video){
  const code=video.error?.code;
  if(error?.name==='NotAllowedError')return 'Safari requiere iniciar el video con un toque. Pulsa Reproducir; si persiste, prueba silenciar el audio.';
  if(code===4||error?.name==='NotSupportedError')return 'Safari no admite este video o su contenedor. Usa una copia MP4 H.264 con audio AAC. La telemetría sigue disponible.';
  if(code===3)return 'Safari no pudo decodificar el video. Usa una copia MP4 H.264/AAC de menor resolución. La telemetría sigue disponible.';
  return 'No se pudo leer el video local'+(code?' (código '+code+')':'')+'. Cierra y vuelve a abrir la sesión. La telemetría sigue disponible.';
 }
 root.VertexPlayback={play,message};if(typeof module!=='undefined')module.exports=root.VertexPlayback;
})(globalThis);
