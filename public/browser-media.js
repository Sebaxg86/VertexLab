/* Local video delivery with HTTP byte ranges; no video bytes reach the network. */
(function(root){
  function range(header,size){
    if(!Number.isSafeInteger(size)||size<1)return null;
    if(!header)return {start:0,end:size-1,status:200};
    const match=/^bytes=(\d*)-(\d*)$/.exec(header);if(!match||(!match[1]&&!match[2]))return null;
    let start,end;
    if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<1)return null;start=Math.max(0,size-suffix);end=size-1;}
    else{start=Number(match[1]);end=match[2]?Math.min(size-1,Number(match[2])):size-1;}
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return null;
    return {start,end,status:206};
  }
  function response(request,file,video){
    if(!video||!Number.isSafeInteger(video.offset)||!Number.isSafeInteger(video.size)||video.offset<0||video.size<1||video.offset+video.size>file.size)return new Response('Invalid local video',{status:422});
    const part=range(request.headers.get('Range'),video.size);
    const headers={'Accept-Ranges':'bytes','Content-Type':video.type||'video/mp4','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    if(!part)return new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${video.size}`}});
    const length=part.end-part.start+1;headers['Content-Length']=String(length);
    if(part.status===206)headers['Content-Range']=`bytes ${part.start}-${part.end}/${video.size}`;
    let cursor=part.start,cancelled=false;
    const stream=request.method==='HEAD'?null:new ReadableStream({
      async pull(controller){
        if(cancelled)return;
        if(cursor>part.end){controller.close();return;}
        try{const end=Math.min(part.end+1,cursor+256*1024),buffer=await file.slice(video.offset+cursor,video.offset+end).arrayBuffer();if(cancelled)return;if(buffer.byteLength!==end-cursor)throw Error('Incomplete media range');cursor=end;controller.enqueue(new Uint8Array(buffer));}
        catch(error){if(!cancelled)controller.error(error);}
      },cancel(){cancelled=true;}
    });
    return new Response(stream,{status:part.status,headers});
  }
  function cloudResponse(request,video,fetchRange){
    if(!video||!Number.isSafeInteger(video.size)||video.size<1||typeof fetchRange!=='function')return new Response('Invalid cloud video',{status:422});
    const part=range(request.headers.get('Range'),video.size);
    const headers={'Accept-Ranges':'bytes','Content-Type':video.type||'video/mp4','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    if(!part)return new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${video.size}`}});
    const length=part.end-part.start+1;headers['Content-Length']=String(length);
    if(part.status===206)headers['Content-Range']=`bytes ${part.start}-${part.end}/${video.size}`;
    let cursor=part.start,cancelled=false;
    const chunkSize=2*1024*1024;
    const stream=request.method==='HEAD'?null:new ReadableStream({
      async pull(controller){
        if(cancelled)return;
        if(cursor>part.end){controller.close();return;}
        try{
          const end=Math.min(part.end,cursor+chunkSize-1);
          const buffer=await fetchRange(cursor,end);
          if(cancelled)return;
          const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
          if(bytes.byteLength!==end-cursor+1)throw Error('Incomplete cloud media range');
          cursor=end+1;
          controller.enqueue(bytes);
        }catch(error){if(!cancelled)controller.error(error);}
      },cancel(){cancelled=true;}
    });
    return new Response(stream,{status:part.status,headers});
  }
  root.VertexMedia={range,response,cloudResponse};if(typeof module!=='undefined')module.exports=root.VertexMedia;
})(globalThis);
