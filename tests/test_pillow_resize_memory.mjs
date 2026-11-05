import test from 'node:test';
import assert from 'node:assert/strict';
import {createPillowResizeMemory} from '../tools/browser-library-adapter/pillow-resize-memory.mjs';
const image=()=>({width:2,height:2,format:'rgb-u8',data:Uint8Array.from({length:12},(_,i)=>i+1).buffer});
function setup({failAllocation=0,failFilter=false,failFree=false}={}){
 const memory=new WebAssembly.Memory({initial:1,maximum:8}),owned=new Set(),freed=[];let allocations=0,next=32,captured;
 const exports={memory,malloc(size){allocations++;if(allocations===failAllocation)return 0;memory.grow(1);const p=next;next+=size;owned.add(p);return p;},free(p){assert.ok(owned.delete(p));freed.push(p);if(failFree)throw Error('private');},pillow_resize_rgb(src,w,h,ow,oh,bounds,dst){
  captured={bytes:[...new Uint8Array(memory.buffer,src,w*h*3)],edges:Array.from({length:4},(_,i)=>new DataView(memory.buffer).getFloat32(bounds+i*4,true))};
  if(failFilter)throw Error('private pixels');memory.grow(1);new Uint8Array(memory.buffer,dst,ow*oh*3).fill(123);return 0;
 }};
 return {adapter:createPillowResizeMemory(exports),exports,owned,freed,get captured(){return captured;}};
}
test('growing module memory refreshes views; float32 edges and copied output survive freeing',()=>{
 const f=setup(),source=image(),result=f.adapter.resize(source,{width:1,height:1,box:[.1,.2,1.8,1.9]});
 assert.deepEqual([...new Uint8Array(result.data)],[123,123,123]);assert.deepEqual(f.captured.bytes,[1,2,3,4,5,6,7,8,9,10,11,12]);
 assert.deepEqual(f.captured.edges,[.1,.2,1.8,1.9].map(Math.fround));assert.equal(f.owned.size,0);assert.equal(f.freed.length,3);assert.equal(source.data.byteLength,12);
 new Uint8Array(f.exports.memory.buffer).fill(0);assert.deepEqual([...new Uint8Array(result.data)],[123,123,123]);
});
test('allocation failures and filter traps invalidate without re-entering module exports',()=>{
 for(const n of [1,2,3]){
  const f=setup({failAllocation:n});assert.throws(()=>f.adapter.resize(image(),{width:1,height:1}),e=>e.code==='resize-memory-failed');
  assert.equal(f.freed.length,0);assert.throws(()=>f.adapter.resize(image(),{width:1,height:1}),e=>e.code==='resize-module-unavailable');
 }
 const f=setup({failFilter:true});assert.throws(()=>f.adapter.resize(image(),{width:1,height:1}),e=>e.code==='resize-failed'&&e.message==='resize-failed');
 assert.equal(f.freed.length,0);assert.throws(()=>f.adapter.resize(image(),{width:1,height:1}),e=>e.code==='resize-module-unavailable');
});
test('cleanup trap stops further export calls and prevents reuse',()=>{
 const f=setup({failFree:true});assert.throws(()=>f.adapter.resize(image(),{width:1,height:1}),e=>e.code==='resize-memory-release-failed');assert.equal(f.freed.length,1);
 assert.throws(()=>f.adapter.resize(image(),{width:1,height:1}),e=>e.code==='resize-module-unavailable');
});
test('normal C error return releases pointers and allows a later request',()=>{
 const f=setup(),filter=f.exports.pillow_resize_rgb;f.exports.pillow_resize_rgb=()=>-2;
 assert.throws(()=>f.adapter.resize(image(),{width:1,height:1}),e=>e.code==='resize-failed');assert.equal(f.freed.length,3);assert.equal(f.owned.size,0);
 f.exports.pillow_resize_rgb=filter;assert.equal(f.adapter.resize(image(),{width:1,height:1}).data.byteLength,3);assert.equal(f.owned.size,0);
});
test('malloc trap after a prior allocation never calls free into damaged allocator state',()=>{
 const f=setup(),malloc=f.exports.malloc;let calls=0;f.exports.malloc=size=>{if(++calls===2)throw new WebAssembly.RuntimeError('private');return malloc(size);};
 assert.throws(()=>f.adapter.resize(image(),{width:1,height:1}),e=>e.code==='resize-failed');assert.equal(f.freed.length,0);
 assert.throws(()=>f.adapter.resize(image(),{width:1,height:1}),e=>e.code==='resize-module-unavailable');assert.equal(calls,2);
});
test('invalid images, boxes and oversized originals fail before module allocation',()=>{
 const f=setup();for(const options of [{width:0,height:1},{width:1,height:1,box:[0,0,3,2]},{width:1,height:1,box:[0,0,NaN,1]}])assert.throws(()=>f.adapter.resize(image(),options),e=>e.code==='invalid-resize-input');
 assert.throws(()=>f.adapter.resize({...image(),width:3000},{width:1,height:1}),e=>e.code==='invalid-resize-input');assert.equal(f.freed.length,0);f.adapter.close();assert.throws(()=>f.adapter.resize(image(),{width:1,height:1}),e=>e.code==='resize-module-unavailable');
});
test('bilinear is explicit and never falls back to the Lanczos export',()=>{
 const f=setup(),calls=[],lanczos=f.exports.pillow_resize_rgb;f.exports.pillow_resize_bilinear_rgb=(...args)=>{calls.push('bilinear');return lanczos(...args);};const resizer=createPillowResizeMemory(f.exports,{filter:'bilinear'});resizer.resize(image(),{width:1,height:1});assert.deepEqual(calls,['bilinear']);assert.throws(()=>createPillowResizeMemory(f.exports,{filter:'other'}),error=>error.code==='invalid-resize-filter');delete f.exports.pillow_resize_bilinear_rgb;assert.throws(()=>createPillowResizeMemory(f.exports,{filter:'bilinear'}),error=>error.code==='invalid-resize-module');
});
test('crop admits original-size fractional boxes while model resize keeps its existing bound',()=>{
 const f=setup(),source={width:2049,height:1,format:'rgb-u8',data:new ArrayBuffer(2049*3)};
 assert.throws(()=>f.adapter.resize(source,{width:1,height:1}),e=>e.code==='invalid-resize-input');assert.equal(f.owned.size,0);
 f.exports.pillow_crop_rgb=f.exports.pillow_resize_rgb;
 const crop=createPillowResizeMemory(f.exports,{filter:'crop'});
 const result=crop.resize(source,{width:2050,height:1,box:[.25,0,2048.75,1]});assert.equal(result.data.byteLength,2050*3);assert.deepEqual(f.captured.edges,[.25,0,2048.75,1]);assert.equal(f.owned.size,0);
 assert.throws(()=>crop.resize(source,{width:4097,height:1}),e=>e.code==='invalid-resize-input');
 const tooMany={width:16384,height:1465,format:'rgb-u8',data:new ArrayBuffer(0)};
 assert.throws(()=>crop.resize(tooMany,{width:1,height:1}),e=>e.code==='invalid-resize-input');
});
