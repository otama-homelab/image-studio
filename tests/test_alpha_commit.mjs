import test from 'node:test';
import assert from 'node:assert/strict';
import {createImageRegistry} from '../tools/browser-library-adapter/image-registry.mjs';
import {createAlphaCommitter} from '../tools/browser-library-adapter/alpha-commit.mjs';
const key={inputId:'input-1',inferenceRevision:1,modelVersion:'set-1'};
function setup(){
 const registry=createImageRegistry(),input=registry.register({width:2,height:1,format:'rgb-u8',data:new ArrayBuffer(6)},'session');
 let current={key:{...key},rgbAssetId:input.id};
 return {registry,input,committer:createAlphaCommitter({registry,getCurrent:()=>current}),setCurrent:v=>{current=v;},current:()=>current};
}
const result=()=>({key:{...key},alpha:{width:2,height:1,layout:'alpha-u8',data:Uint8Array.of(0,255).buffer}});
test('late domain-key results cannot register or detach their buffers',()=>{
 for(const field of ['inputId','inferenceRevision','modelVersion']){
  const f=setup(),value=result();f.setCurrent({...f.current(),key:{...key,[field]:field==='inferenceRevision'?2:'changed'}});
  assert.equal(f.committer.commit(value).status,'stale');assert.equal(value.alpha.data.byteLength,2);assert.equal(f.committer.get(),null);
 }
});
test('commit consumes accepted alpha and replacement releases only its own previous owner',()=>{
 const f=setup(),first=result(),accepted=f.committer.commit(first);assert.equal(first.alpha.data.byteLength,0);
 assert.equal(f.committer.get().status,'valid');f.registry.retain(accepted.image.id,'crop');
 const next=f.committer.commit(result());assert.notEqual(next.image.id,accepted.image.id);
 assert.equal(f.registry.get(accepted.image.id).id,accepted.image.id);
 f.registry.release(accepted.image.id,'crop');assert.throws(()=>f.registry.get(accepted.image.id),e=>e.code==='image-not-found');
 f.committer.close();assert.throws(()=>f.registry.get(next.image.id),e=>e.code==='image-not-found');
 assert.equal(f.registry.get(f.input.id),f.input);
});
test('revision change retains stale preview while a new photo discards it',()=>{
 const f=setup(),accepted=f.committer.commit(result());
 f.setCurrent({...f.current(),key:{...key,inferenceRevision:2}});assert.equal(f.committer.get().status,'stale');
 assert.equal(f.registry.get(accepted.image.id).id,accepted.image.id);
 f.setCurrent({...f.current(),key:{...key,inputId:'input-2'}});assert.equal(f.committer.get(),null);
 assert.throws(()=>f.registry.get(accepted.image.id),e=>e.code==='image-not-found');
});
test('invalid replacement preserves the prior valid alpha; closing is idempotent',()=>{
 const f=setup(),accepted=f.committer.commit(result()),bad=result();bad.alpha.data=new ArrayBuffer(1);
 assert.throws(()=>f.committer.commit(bad),e=>e.code==='invalid-alpha-result');assert.equal(f.committer.get().image.id,accepted.image.id);
 f.committer.close();f.committer.close();assert.equal(f.committer.get(),null);
 assert.throws(()=>f.committer.commit(result()),e=>e.code==='alpha-owner-closed');
});

test('background color revision leaves alpha valid and requires no new inference',()=>{
 const f=setup(),accepted=f.committer.commit(result());
 f.setCurrent({...f.current(),compositeRevision:9,backgroundColor:'#ffffff'});
 assert.equal(f.committer.get().status,'valid');assert.equal(f.committer.get().image.id,accepted.image.id);f.committer.close();
});

const withCutout=()=>({...result(),cutout:{width:2,height:1,format:'rgba-u8',data:Uint8Array.of(10,20,30,0,40,50,60,255).buffer}});
test('alpha and cutout are consumed together and released together on replacement/close',()=>{
 const f=setup(),value=withCutout(),first=f.committer.commit(value);assert.equal(value.alpha.data.byteLength,0);assert.equal(value.cutout.data.byteLength,0);assert.equal(f.committer.get().cutout.id,first.cutout.id);
 f.registry.retain(first.cutout.id,'crop');const next=f.committer.commit(withCutout());assert.throws(()=>f.registry.get(first.image.id));assert.ok(f.registry.get(first.cutout.id));f.registry.release(first.cutout.id,'crop');assert.throws(()=>f.registry.get(first.cutout.id));
 f.committer.close();assert.throws(()=>f.registry.get(next.image.id));assert.throws(()=>f.registry.get(next.cutout.id));
});
test('malformed cutout preserves old pair and does not consume either new buffer',()=>{
 const f=setup(),first=f.committer.commit(withCutout()),bad=withCutout();bad.cutout.data=new ArrayBuffer(7);assert.throws(()=>f.committer.commit(bad),error=>error.code==='invalid-cutout-result');assert.equal(bad.alpha.data.byteLength,2);assert.equal(bad.cutout.data.byteLength,7);assert.equal(f.committer.get().image.id,first.image.id);assert.equal(f.committer.get().cutout.id,first.cutout.id);
});
test('late pair is not consumed and new photo discards both old assets',()=>{
 const f=setup(),first=f.committer.commit(withCutout()),late=withCutout();f.setCurrent({...f.current(),key:{...key,inferenceRevision:2}});assert.equal(f.committer.commit(late).status,'stale');assert.equal(late.alpha.data.byteLength,2);assert.equal(late.cutout.data.byteLength,8);assert.equal(f.committer.get().status,'stale');
 f.setCurrent({...f.current(),key:{...key,inputId:'new-photo'}});assert.equal(f.committer.get(),null);assert.throws(()=>f.registry.get(first.image.id));assert.throws(()=>f.registry.get(first.cutout.id));
});
test('second registration failure rolls back new alpha and keeps the previous pair',()=>{
 const actual=createImageRegistry(),source=actual.register({width:2,height:1,format:'rgb-u8',data:new ArrayBuffer(6)},'session');let fail=false;const registered=[];
 const registry={...actual,register(image,owner){if(fail&&image.format==='rgba-u8')throw Error('registration failed');const asset=actual.register(image,owner);registered.push(asset);return asset;}};
 const committer=createAlphaCommitter({registry,getCurrent:()=>({key,rgbAssetId:source.id})}),first=committer.commit(withCutout());fail=true;assert.throws(()=>committer.commit(withCutout()));assert.equal(committer.get().cutout.id,first.cutout.id);assert.equal(committer.get().image.id,first.image.id);assert.throws(()=>actual.get(registered.at(-1).id));committer.close();
});
test('color changes keep the cutout valid; alpha-only replacement releases old cutout',()=>{
 const f=setup(),first=f.committer.commit(withCutout());f.setCurrent({...f.current(),backgroundColor:'#ffffff',compositeRevision:3});assert.equal(f.committer.get().status,'valid');assert.equal(f.committer.get().cutout.id,first.cutout.id);f.committer.commit(result());assert.equal(f.committer.get().cutout,undefined);assert.throws(()=>f.registry.get(first.cutout.id));
});
