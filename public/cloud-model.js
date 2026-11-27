/* Shared cloud sync model for VertexLab (PC local app + static web viewer). */
(function(root){
 const HEX32=/^[0-9a-f]{32}$/;
 const DRIVE_ID=/^[A-Za-z0-9_-]{8,128}$/;

 function validSessionId(id){return typeof id==='string'&&HEX32.test(id);}
 function validDriveId(id){return typeof id==='string'&&DRIVE_ID.test(id);}

 function cloudRowToLibraryItem(row){
  if(!row||!validSessionId(row.id))return null;
  return {
   id:row.id,
   name:row.name||row.car_name||'Sesión',
   carOrdinal:Number(row.car_ordinal)||0,
   carName:row.car_name||null,
   carClass:row.car_class??null,
   carPI:row.car_pi??null,
   brand:row.brand??null,
   created:Number(row.created_epoch)||0,
   ended:row.ended_epoch??null,
   duration:row.duration??null,
   version:row.version??2,
   featured:!!row.featured,
   offset:Number(row.sync_offset)||0,
   preview:row.preview??null,
   availability:{local:false,cloud:true,temporary:false},
   cloud:{
    driveFolderId:row.drive_folder_id||null,
    driveMetaFileId:row.drive_meta_file_id||null,
    driveTelemetryFileId:row.drive_telemetry_file_id||null,
    telemetrySize:Number(row.telemetry_size)||0,
    telemetryEncoding:row.telemetry_encoding||'gzip',
    driveVideoFileId:row.drive_video_file_id||null,
    videoSize:row.video_size!=null?Number(row.video_size):null,
    videoMime:row.video_mime||null,
    videoName:row.video_name||null,
    updatedAt:row.updated_at||null
   }
  };
 }

 function mergeLibrary(localItems=[],cloudItems=[]){
  const merged=new Map();
  for(const item of localItems){
   if(!item||!item.id)continue;
   merged.set(item.id,{
    ...item,
    availability:{
     local:item.availability?.local!==false,
     cloud:item.availability?.cloud===true,
     temporary:item.availability?.temporary===true
    }
   });
  }
  for(const raw of cloudItems){
   const cloudItem=raw?.availability?raw:cloudRowToLibraryItem(raw);
   if(!cloudItem||!cloudItem.id)continue;
   const existing=merged.get(cloudItem.id);
   if(!existing){
    merged.set(cloudItem.id,cloudItem);
   }else{
    merged.set(cloudItem.id,{
     ...cloudItem,
     ...existing,
     featured:existing.featured||cloudItem.featured,
     availability:{
      local:existing.availability.local,
      cloud:true,
      temporary:existing.availability.temporary
     },
     cloud:cloudItem.cloud||existing.cloud||null
    });
   }
  }
  return [...merged.values()].sort((a,b)=>(b.created||0)-(a.created||0)||String(a.id).localeCompare(String(b.id)));
 }

 function driveMediaUrl(fileId){
  if(!validDriveId(fileId))throw Error('ID de archivo de Google Drive inválido');
  return 'https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'?alt=media&acknowledgeAbuse=false';
 }

 function driveRangeRequest(fileId,start,end,accessToken){
  if(!accessToken||typeof accessToken!=='string')throw Error('Falta token de acceso de Google Drive');
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start)throw Error('Rango de bytes inválido');
  return {
   url:driveMediaUrl(fileId),
   headers:{
    Authorization:'Bearer '+accessToken,
    Range:`bytes=${start}-${end}`
   }
  };
 }

 function chunkBounds(start,end,totalSize,chunkSize=1024*1024){
  if(!Number.isSafeInteger(totalSize)||totalSize<1)throw Error('Tamaño de video inválido');
  const clampedStart=Math.max(0,Math.min(totalSize-1,Math.trunc(start)));
  const clampedEnd=Math.max(clampedStart,Math.min(totalSize-1,Math.trunc(end)));
  const maxChunk=Math.max(64*1024,Math.min(2*1024*1024,Math.trunc(chunkSize)));
  const stop=Math.min(clampedEnd,clampedStart+maxChunk-1);
  return {start:clampedStart,end:stop,length:stop-clampedStart+1};
 }

 const api={validSessionId,validDriveId,cloudRowToLibraryItem,mergeLibrary,driveMediaUrl,driveRangeRequest,chunkBounds};
 root.VertexCloudModel=api;
 if(typeof module!=='undefined')module.exports=api;
})(globalThis);
