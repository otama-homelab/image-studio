import test from 'node:test';
import assert from 'node:assert/strict';
import {createImageRegistry} from '../tools/browser-library-adapter/image-registry.mjs';
const register=(registry,owner='session')=>registry.register({width:2,height:1,format:'rgb-u8',data:Uint8Array.of(10,20,30,40,50,60).buffer},owner);
test('registration consumes input buffer and copies cannot mutate registry originals',()=>{
 const registry=createImageRegistry(),bytes=Uint8Array.of(10,20,30,40,50,60);
 const asset=registry.register({width:2,height:1,format:'rgb-u8',data:bytes.buffer},'session');
 assert.equal(bytes.byteLength,0);assert.ok(Object.isFrozen(asset));assert.equal('data' in asset,false);
 const copy=registry.copy(asset.id);new Uint8Array(copy.data)[0]=255;
 assert.equal(new Uint8Array(registry.copy(asset.id).data)[0],10);
});
test('shared downstream owners keep assets alive until their last release',()=>{
 const registry=createImageRegistry(),asset=register(registry);registry.retain(asset.id,'crop');registry.retain(asset.id,'crop');
 registry.release(asset.id,'session');assert.equal(registry.get(asset.id),asset);
 assert.throws(()=>registry.release(asset.id,'print'),e=>e.code==='image-owner-mismatch');
 registry.release(asset.id,'crop');assert.throws(()=>registry.get(asset.id),e=>e.code==='image-not-found');
});
test('inference uses disposable copies and checks RGB/alpha dimensions before allocating them',()=>{
 const registry=createImageRegistry(),rgb=register(registry);
 const alpha=registry.register({width:2,height:1,format:'alpha-u8',data:Uint8Array.of(0,255).buffer},'session');
 const planes=registry.inferencePlanes(rgb.id,alpha.id);
 const moved=structuredClone(planes,{transfer:[planes.rgb.data,planes.hrAlpha.data]});
 assert.equal(planes.rgb.data.byteLength,0);assert.equal(planes.hrAlpha.data.byteLength,0);
 assert.deepEqual([...new Uint8Array(moved.rgb.data)],[10,20,30,40,50,60]);
 assert.equal(registry.copy(rgb.id).data.byteLength,6);assert.equal(registry.copy(alpha.id).data.byteLength,2);
 const wrong=registry.register({width:1,height:1,format:'alpha-u8',data:new ArrayBuffer(1)},'session');
 assert.throws(()=>registry.inferencePlanes(rgb.id,wrong.id),e=>e.code==='invalid-inference-image');
});
test('invalid assets are rejected without detaching caller data',()=>{
 const registry=createImageRegistry(),data=new ArrayBuffer(6);
 for(const invalid of [{width:0,height:1,format:'rgb-u8'},{width:2,height:1,format:'unknown'},{width:3,height:1,format:'rgb-u8'}])assert.throws(()=>registry.register({...invalid,data},'session'),e=>e.code==='invalid-image-asset');
 assert.equal(data.byteLength,6);
 assert.throws(()=>registry.register({width:2,height:1,format:'rgb-u8',data:new SharedArrayBuffer(6)},'session'),e=>e.code==='invalid-image-asset');
});
