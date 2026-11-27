importScripts('browser-library.js','browser-media.js');
const localMedia=new Map();
const cloudMedia=new Map();
self.addEventListener('message',event=>{
  if(event.data?.type==='vertex-media'){
    const {id,video,size}=event.data;
    if(!/^[a-f0-9]{32}$/.test(id)||!Number.isSafeInteger(size)||size<1||!video){event.ports[0]?.postMessage({ok:false});return;}
    cloudMedia.delete(id);
    localMedia.set(id,{size,video,clientId:event.source?.id});event.ports[0]?.postMessage({ok:true});
  }
  if(event.data?.type==='vertex-cloud-media'){
    const {id,fileId,size,mime}=event.data;
    if(!/^[a-f0-9]{32}$/.test(id)||!/^[A-Za-z0-9_-]{8,128}$/.test(fileId||'')||!Number.isSafeInteger(size)||size<1){event.ports[0]?.postMessage({ok:false});return;}
    localMedia.delete(id);
    cloudMedia.set(id,{fileId,size,type:mime||'video/mp4',clientId:event.source?.id});event.ports[0]?.postMessage({ok:true});
  }
  if(event.data?.type==='vertex-media-release'){localMedia.delete(event.data.id);cloudMedia.delete(event.data.id);}
});
async function localVideoResponse(request,id,clientId){
  try{
    const cloud=cloudMedia.get(id);
    if(cloud){
      const client=await self.clients.get(clientId||cloud.clientId);
      if(!client)return new Response('Reopen this cloud session in VertexLab',{status:410});
      return VertexMedia.cloudResponse(request,{size:cloud.size,type:cloud.type},(start,end)=>new Promise((resolve,reject)=>{
        const channel=new MessageChannel();const timer=setTimeout(()=>{channel.port1.close();reject(Error('Cloud media read timed out'));},30000);
        channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();event.data.error?reject(Error(event.data.error)):resolve(event.data.buffer);};
        client.postMessage({type:'vertex-cloud-media-range',id,fileId:cloud.fileId,start,end,size:cloud.size},[channel.port2]);
      }));
    }
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
  }catch{return new Response('Video unavailable; reopen the session',{status:503});}
}
