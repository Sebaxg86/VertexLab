const test=require('node:test'),assert=require('node:assert/strict');
const Cloud=require('../public/cloud-model.js');
const Home=require('../public/home-model.js');
const Media=require('../public/browser-media.js');

const ID_A='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ID_B='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const ID_C='cccccccccccccccccccccccccccccccc';

test('mergeLibrary combines local and cloud sessions by id without duplicating entries',()=>{
 const local=[
  {id:ID_A,name:'Local only',created:100,featured:false,availability:{local:true,cloud:false}},
  {id:ID_B,name:'Both',created:200,featured:false,availability:{local:true,cloud:false}}
 ];
 const cloud=[
  {id:ID_B,name:'Both',car_ordinal:12,created_epoch:200,featured:true,drive_folder_id:'folder_bbbbbb',drive_meta_file_id:'meta_bbbbbbbb',drive_telemetry_file_id:'tel_bbbbbbbbb',drive_video_file_id:'vid_bbbbbbbbb',video_size:123456,video_mime:'video/mp4'},
  {id:ID_C,name:'Cloud only',car_ordinal:99,created_epoch:300,featured:false,drive_folder_id:'folder_cccccc',drive_meta_file_id:'meta_cccccccc',drive_telemetry_file_id:'tel_ccccccccc',drive_video_file_id:'vid_ccccccccc',video_size:987654,video_mime:'video/mp4'}
 ];
 const merged=Cloud.mergeLibrary(local,cloud);
 assert.equal(merged.length,3);
 assert.deepEqual(merged.map(i=>i.id),[ID_C,ID_B,ID_A]);
 assert.deepEqual(merged[0].availability,{local:false,cloud:true,temporary:false});
 assert.deepEqual(merged[1].availability,{local:true,cloud:true,temporary:false});
 assert.equal(merged[1].featured,true);
 assert.equal(merged[1].cloud.driveVideoFileId,'vid_bbbbbbbbb');
 assert.deepEqual(merged[2].availability,{local:true,cloud:false,temporary:false});
});

test('home actions enable Drive sync, download and cloud delete only when Drive is connected',()=>{
 const localOnly={id:ID_A,availability:{local:true,cloud:false}};
 const cloudOnly={id:ID_C,availability:{local:false,cloud:true}};
 const both={id:ID_B,availability:{local:true,cloud:true}};

 assert.equal(Home.actions(localOnly,null,{connected:true}).find(a=>a.key==='sync').enabled,true);
 assert.equal(Home.actions(localOnly,ID_A,{connected:true}).find(a=>a.key==='sync').enabled,false);
 assert.equal(Home.actions(both,null,{connected:true}).some(a=>a.key==='sync'),false);
 assert.equal(Home.actions(cloudOnly,null,{connected:true}).find(a=>a.key==='download').enabled,true);
 assert.equal(Home.actions(cloudOnly,null,{connected:true}).find(a=>a.key==='delete-cloud').enabled,true);
 assert.equal(Home.actions(cloudOnly,null,{connected:true}).find(a=>a.key==='delete-all').enabled,true);
 assert.equal(Home.actions(cloudOnly,null,{connected:false}).find(a=>a.key==='download').enabled,false);
});

test('driveRangeRequest validates file ids, tokens and byte ranges',()=>{
 const req=Cloud.driveRangeRequest('1AbCdEfGhIjKlMnOp',1024,2047,'ya29.token');
 assert.equal(req.url,'https://www.googleapis.com/drive/v3/files/1AbCdEfGhIjKlMnOp?alt=media&acknowledgeAbuse=false');
 assert.equal(req.headers.Authorization,'Bearer ya29.token');
 assert.equal(req.headers.Range,'bytes=1024-2047');
 assert.throws(()=>Cloud.driveRangeRequest('../bad',0,10,'tok'));
 assert.throws(()=>Cloud.driveRangeRequest('1AbCdEfGhIjKlMnOp',10,5,'tok'));
 assert.throws(()=>Cloud.driveRangeRequest('1AbCdEfGhIjKlMnOp',0,10,''));
});

test('cloudResponse streams HTTP 206 byte ranges on demand without reading the full video',async()=>{
 const total=3*1024*1024;
 const calls=[];
 const fetchRange=async(start,end)=>{
  calls.push([start,end]);
  const out=new Uint8Array(end-start+1);
  for(let i=0;i<out.length;i++)out[i]=(start+i)%251;
  return out;
 };
 const head=Media.cloudResponse(new Request('https://example.test/__vertex_media/'+ID_C+'/video',{method:'HEAD'}),{size:total,type:'video/mp4'},fetchRange);
 assert.equal(head.status,200);
 assert.equal(head.headers.get('Content-Length'),String(total));
 assert.equal(calls.length,0);

 const partial=Media.cloudResponse(new Request('https://example.test/__vertex_media/'+ID_C+'/video',{headers:{Range:'bytes=100-1099'}}),{size:total,type:'video/mp4'},fetchRange);
 assert.equal(partial.status,206);
 assert.equal(partial.headers.get('Content-Range'),`bytes 100-1099/${total}`);
 const data=new Uint8Array(await partial.arrayBuffer());
 assert.equal(data.length,1000);
 assert.equal(data[0],100%251);
 assert.equal(data[999],1099%251);
 assert.deepEqual(calls,[[100,1099]]);

 const bad=Media.cloudResponse(new Request('https://example.test/__vertex_media/'+ID_C+'/video',{headers:{Range:`bytes=${total}-${total+10}`}}),{size:total,type:'video/mp4'},fetchRange);
 assert.equal(bad.status,416);

 // Open-ended range on a large video caps to a 4 MiB 206 window
 const large=100*1024*1024;
 const windowed=Media.cloudResponse(new Request('https://example.test/__vertex_media/'+ID_C+'/video',{headers:{Range:'bytes=0-'}}),{size:large,type:'video/mp4'},fetchRange);
 assert.equal(windowed.status,206);
 assert.equal(windowed.headers.get('Content-Range'),`bytes 0-${4*1024*1024-1}/${large}`);
 assert.equal(windowed.headers.get('Content-Length'),String(4*1024*1024));
});

test('cloud-client initializes cleanly with default public Supabase and Google OAuth config',()=>{
 require('../public/cloud-client.js');
 assert.ok(globalThis.VertexCloud);
 const st=globalThis.VertexCloud.state();
 assert.equal(st.configured,true);
 assert.equal(st.signedIn,false);
 assert.equal(st.driveConnected,false);
 assert.ok(st.googleClientId&&st.googleClientId.endsWith('.apps.googleusercontent.com'));
});
