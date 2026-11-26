const test=require('node:test'),assert=require('node:assert/strict');
const {entries,bundleName}=require('../public/library-transfer.js');
const file=(filename,size=1)=>({filename,uncompressedSize:size,directory:false});
test('batch name follows local calendar and includes the zip extension',()=>{assert.equal(bundleName(new Date(2026,0,2,0,1)),'VRTX-Sessions-2026-01-02.zip');});
test('nested VRTX packages are supported, unsafe or ambiguous bundles are rejected',()=>{
 assert.equal(entries([{filename:'sessions/',directory:true},file('sessions/one.vrtx'),file('two.vrtx')]).length,2);
 for(const items of [[],[file('../one.vrtx')],[file('/one.vrtx')],[file('C:/one.vrtx')],[file('one.vrtx'),file('ONE.vrtx')],[file('one.txt')],[{...file('one.vrtx'),encrypted:true}],[file('one.vrtx',256*1024**3+1)]])assert.throws(()=>entries(items));
});
test('ZIP writer preserves packaged sessions without recompressing their video',async()=>{
 const zip=require('../public/vendor-zip-2.25.0.js');zip.configure({useWebWorkers:false});
 const writer=new zip.ZipWriter(new zip.BlobWriter('application/zip'),{zip64:true,level:0});
 await writer.add('001-session.vrtx',new zip.BlobReader(new Blob(['original package'])),{level:0});
 await writer.add('002-session.vrtx',new zip.BlobReader(new Blob(['another package'])),{level:0});
 const blob=await writer.close(),reader=new zip.ZipReader(new zip.BlobReader(blob));
 try{const files=entries(await reader.getEntries());assert.equal(files.length,2);assert.equal(await files[0].getData(new zip.TextWriter()),'original package');assert.equal(await files[1].getData(new zip.TextWriter()),'another package');}finally{await reader.close();}
});
