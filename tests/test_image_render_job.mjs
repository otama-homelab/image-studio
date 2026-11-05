import test from 'node:test';
import assert from 'node:assert/strict';
import {createImageRegistry} from '../tools/browser-library-adapter/image-registry.mjs';
import {createImageRenderJob} from '../tools/browser-library-adapter/image-render-job.mjs';
const deferred=()=>{let resolve,reject;return {promise:new Promise((a,b)=>{resolve=a;reject=b;}),resolve:v=>resolve(v),reject:e=>reject(e)};};
const pixel=()=>({width:1,height:1,format:'rgb-u8',data:Uint8Array.of(1,2,3).buffer});
function setup(){
 const registry=createImageRegistry(),source=registry.register(pixel(),'session'),work=deferred();let key='revision-1',width=1,available=true,signal,calls=0;
 const job=createImageRenderJob({registry,getCurrent:()=>({assetId:source.id,dependencyKey:key,available,settings:{width}}),prepare:s=>({options:{width:s.width,height:1},output:{width:s.width,height:1}}),render:(_,__,hooks)=>{calls++;signal=hooks.signal;return work.promise;}});
 return {registry,source,work,job,makeUnavailable:()=>{available=false;},changeKey:()=>{key='revision-2';},changeSetting:()=>{width=2;},get signal(){return signal;},get calls(){return calls;}};
}
test('completed image is owned by job, metadata only, released on close',async()=>{
 const f=setup(),pending=f.job.start();await Promise.resolve();f.work.resolve(pixel());const result=await pending;
 assert.equal(result.status,'ready');assert.equal(f.job.get().status,'valid');assert.equal('data' in result.image,false);
 await f.job.close();assert.throws(()=>f.registry.get(result.image.id),e=>e.code==='image-not-found');assert.ok(f.registry.get(f.source.id));
});
test('changed dependency or effective settings discard result before registry adoption',async()=>{
 for(const mutate of ['changeKey','changeSetting']){
  const f=setup(),pending=f.job.start();await Promise.resolve();f[mutate]();const output=pixel();f.work.resolve(output);
  assert.deepEqual(await pending,{status:'stale'});assert.equal(output.data.byteLength,3);assert.equal(f.job.get(),null);await f.job.close();
 }
});
test('cancel waits for renderer terminal state and retains source pin until then',async()=>{
 const f=setup(),pending=f.job.start();await Promise.resolve();f.registry.release(f.source.id,'session');const cancelled=f.job.cancel();
 assert.equal(f.signal.aborted,true);assert.equal(f.job.getState().busy,true);assert.ok(f.registry.get(f.source.id));
 await assert.rejects(f.job.start(),e=>e.code==='render-busy');f.work.resolve(pixel());await cancelled;assert.deepEqual(await pending,{status:'cancelled'});assert.equal(f.job.getState().busy,false);assert.throws(()=>f.registry.get(f.source.id));await f.job.close();
});
test('synchronous cancel prevents copy/render; renderer failures expose fixed codes',async()=>{
 const f=setup(),pending=f.job.start();const cancelled=f.job.cancel();await cancelled;assert.deepEqual(await pending,{status:'cancelled'});assert.equal(f.calls,0);await f.job.close();
 const g=setup(),failed=g.job.start();await Promise.resolve();g.work.reject(Error('private pixels'));await assert.rejects(failed,e=>e.code==='render-failed'&&e.message==='render-failed');await g.job.close();
});
test('close during rendering ignores late result and waits for terminal completion',async()=>{
 const f=setup(),pending=f.job.start();await Promise.resolve();let stopped=false;const closed=f.job.close().then(()=>{stopped=true;});
 await Promise.resolve();assert.equal(stopped,false);f.work.resolve(pixel());await closed;assert.deepEqual(await pending,{status:'cancelled'});assert.equal(f.job.get(),null);await f.job.close();
});

test('unavailable upstream keeps stale preview but prevents re-rendering from old pixels',async()=>{
 const f=setup(),pending=f.job.start();await Promise.resolve();f.work.resolve(pixel());const result=await pending;
 f.makeUnavailable();assert.equal(f.job.get().status,'stale');assert.equal(f.job.get().image.id,result.image.id);
 await assert.rejects(f.job.start(),e=>e.code==='invalid-render-source');assert.equal(f.calls,1);await f.job.close();
});
test('closing the render owner preserves an image retained by the print stage',async()=>{
 const f=setup(),pending=f.job.start();await Promise.resolve();f.work.resolve(pixel());const result=await pending;
 f.registry.retain(result.image.id,'print-input');await f.job.close();assert.equal(f.registry.get(result.image.id),result.image);
 f.registry.release(result.image.id,'print-input');assert.throws(()=>f.registry.get(result.image.id),e=>e.code==='image-not-found');
});

for(const code of ['resize-worker-stop-failed','paper-worker-stop-failed']){
 test(code+' survives cancellation and blocks reuse',async()=>{
  const f=setup(),pending=f.job.start();await Promise.resolve();
  const cancelled=f.job.cancel();
  const failure=Object.assign(new Error('private implementation detail'),{code});
  const rejected=assert.rejects(pending,e=>e.code==='render-stop-failed'&&e.message==='render-stop-failed');
  const cancellation=assert.rejects(cancelled,e=>e.code==='render-stop-failed');
  f.work.reject(failure);await rejected;await cancellation;
  assert.equal(f.job.getState().blocked,true);assert.equal(f.job.getState().busy,false);
  assert.equal(f.job.get(),null);assert.ok(f.registry.get(f.source.id));
  await assert.rejects(f.job.start(),e=>e.code==='render-unavailable');await f.job.close();
 });
}
test('reconcile consumes shutdown rejection while preserving blocked state',async()=>{
 const f=setup(),pending=f.job.start();await Promise.resolve();
 f.changeKey();f.job.reconcile();
 const rejected=assert.rejects(pending,e=>e.code==='render-stop-failed');
 f.work.reject(Object.assign(Error('private'),{code:'resize-worker-stop-failed'}));
 await rejected;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.job.getState().blocked,true);await f.job.close();
});
