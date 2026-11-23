importScripts('browser-library.js','browser-media.js');
const localMedia=new Map();
self.addEventListener('message',event=>{
  if(event.data?.type==='vertex-media'){
    const {id,video,size}=event.data;
    if(!/^[a-f0-9]{32}$/.test(id)||!Number.isSafeInteger(size)||size<1||!video){event.ports[0]?.postMessage({ok:false});return;}
    localMedia.set(id,{size,video,clientId:event.source?.id});event.ports[0]?.postMessage({ok:true});
  }
  if(event.data?.type==='vertex-media-release')localMedia.delete(event.data.id);
});
async function localVideoResponse(request,id,clientId){
  try{
    let source=localMedia.get(id);
    if(!source){const record=await VertexLibrary.record(id);if(!record?.video)return new Response('Reopen this session in VertexLab',{status:410});source={size:record.size,video:record.video};}
    const client=await self.clients.get(clientId||source.clientId);
    if(!client)return new Response('Reopen this session in VertexLab',{status:410});
    const file={size:source.size,slice(start,end){return {arrayBuffer:()=>new Promise((resolve,reject)=>{
      const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();reject(Error('Local media read timed out'));},30000);
      channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();event.data.error?reject(Error(event.data.error)):resolve(event.data.buffer);};
      client.postMessage({type:'vertex-media-range',id,start,end},[channel.port2]);
    })};}};
    return VertexMedia.response(request,file,source.video);
  }catch{return new Response('Local video unavailable; reopen the session',{status:503});}
}
