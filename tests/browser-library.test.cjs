const test=require('node:test'),assert=require('node:assert/strict');
require('../public/browser-library.js');
const library=globalThis.VertexLibrary;
test('saved copies must preserve size and the ZIP tail before publishing the library record',async()=>{
 const original=new Blob([new Uint8Array(100).fill(5)]);
 await library.verifyCopy(original,original.slice());
 await assert.rejects(()=>library.verifyCopy(original,original.slice(0,99)),/incompleta/);
 const damaged=new Uint8Array(100).fill(5);damaged[99]=0;
 await assert.rejects(()=>library.verifyCopy(original,new Blob([damaged])),/final de la copia/);
});
test('verification reads only a bounded tail above 2 GiB',async()=>{
 const size=2800000000,ranges=[],file={size,slice:start=>{ranges.push(start);return new Blob([new Uint8Array(size-start)]);}};
 await library.verifyCopy(file,file);assert.deepEqual(ranges,[size-65557,size-65557]);
});
test('reopening a truncated database copy fails before the ZIP parser',async()=>{
 await assert.rejects(()=>library.file({storage:'database',size:100,name:'test.vrtx',file:new Blob(['short'])}),/Vuelve a importar/);
});
