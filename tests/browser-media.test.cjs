const test=require('node:test'),assert=require('node:assert/strict');
const {range,response}=require('../public/browser-media.js');
const playback=require('../public/video-playback.js');
test('media byte ranges support suffix, explicit and open-ended requests above 2 GiB',()=>{
 assert.deepEqual(range('bytes=2800000000-',3000000000),{start:2800000000,end:2999999999,status:206});
 assert.deepEqual(range('bytes=-2',10),{start:8,end:9,status:206});
 assert.deepEqual(range('bytes=2-999',10),{start:2,end:9,status:206});
 for(const header of ['bytes=10-','bytes=4-2','bytes=-0','bytes=0-1,4-5','bogus'])assert.equal(range(header,10),null);
});
test('local media responses expose only video bytes, never surrounding ZIP data',async()=>{
 const file=new Blob([new Uint8Array([99,99,1,2,3,4,88])]),video={offset:2,size:4,type:'video/mp4'};
 const res=response(new Request('https://example.test/video',{headers:{Range:'bytes=1-2'}}),file,video);
 assert.equal(res.status,206);assert.equal(res.headers.get('Content-Range'),'bytes 1-2/4');assert.equal(res.headers.get('Content-Length'),'2');
 assert.deepEqual([...new Uint8Array(await res.arrayBuffer())],[2,3]);
 const head=response(new Request('https://example.test/video',{method:'HEAD',headers:{Range:'bytes=0-1'}}),file,video);assert.equal(await head.text(),'');assert.equal(head.headers.get('Content-Length'),'2');
 assert.equal(response(new Request('https://example.test/video',{headers:{Range:'bytes=9-'}}),file,video).status,416);
});
test('media stream reads bounded chunks rather than materializing the movie',async()=>{
 const requests=[],file={size:3000000000,slice:(start,end)=>{requests.push([start,end]);return new Blob([new Uint8Array(end-start)]);}};
 const res=response(new Request('https://example.test/video',{headers:{Range:'bytes=2800000000-2800599999'}}),file,{offset:30,size:2999999970,type:'video/mp4'});
 assert.equal((await res.arrayBuffer()).byteLength,600000);assert.ok(requests.length>=3);assert.ok(requests.every(([a,b])=>b-a<=256*1024));assert.equal(requests[0][0],2800000030);
});
test('cancelling media consumption stops further range reads',async()=>{
 let calls=0;const res=response(new Request('https://example.test/video'),{size:10000000,slice:(a,b)=>{calls++;return new Blob([new Uint8Array(b-a)]);}},{offset:0,size:10000000});
 const reader=res.body.getReader();await reader.read();await reader.cancel();const count=calls;await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,count);
});
test('one pending play request per decoder and aborted seeks do not stop playback',async()=>{
 let reject,calls=0,errors=0;const video={paused:true,getAttribute:()=>'/video',play:()=>{calls++;return new Promise((_,fail)=>{reject=fail;});}};
 playback.play(video,()=>errors++);playback.play(video,()=>errors++);assert.equal(calls,1);reject(Object.assign(Error('seek interrupted'),{name:'AbortError'}));await new Promise(resolve=>setImmediate(resolve));assert.equal(errors,0);playback.play(video,()=>errors++);assert.equal(calls,2);
 reject(Object.assign(Error('blocked'),{name:'NotAllowedError'}));await new Promise(resolve=>setImmediate(resolve));assert.equal(errors,1);
});
test('codec and decode failures have actionable messages',()=>{
 assert.match(playback.message(null,{error:{code:4}}),/H.264/);assert.match(playback.message(null,{error:{code:3}}),/resolución/);assert.match(playback.message({name:'NotAllowedError'},{}),/toque/);
});

test('media service worker recovers metadata after restart and reads through the owning page',async()=>{
 const vm=require('node:vm'),fs=require('node:fs'),{MessageChannel}=require('node:worker_threads');let reads=0;
 const client={postMessage(message,ports){reads++;assert.equal(message.type,'vertex-media-range');const bytes=new Uint8Array([99,99,1,2,3,4,88]);ports[0].postMessage({buffer:bytes.slice(message.start,message.end).buffer});ports[0].close();}};
 const self={addEventListener(){},clients:{get:async id=>{assert.equal(id,'page');return client;}}};
 const context=vm.createContext({self,importScripts(){},VertexMedia:require('../public/browser-media.js'),VertexLibrary:{record:async()=>({size:7,video:{offset:2,size:4,type:'video/mp4'}})},Map,Response,MessageChannel,setTimeout,clearTimeout,Error,Promise});
 vm.runInContext(fs.readFileSync(require.resolve('../public/media-service-worker.js'),'utf8'),context);
 const res=await context.localVideoResponse(new Request('https://example.test/__vertex_media/id/video',{headers:{Range:'bytes=1-2'}}),'id','page');
 assert.equal(res.status,206);assert.deepEqual([...new Uint8Array(await res.arrayBuffer())],[2,3]);assert.equal(reads,1);
});
