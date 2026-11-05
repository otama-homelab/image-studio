import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createPhasedMattePreparation} from '../tools/browser-library-adapter/phased-matte-prepare.mjs';
function fixture({waitRun,waitCreate,tensorReleaseFailure=false,invalidOutput=false,releaseFailure=false,runFailure=false,quota=false,backend='wasm',mutateRuntime=()=>{},queueFailure=false,nonFinite=false}={}){
 const stored=new Map(),payload=new Map(),order=[],live=new Set();let creates=0,owners=0;
 const resources=['phase-0.onnx','model.onnx.data','phase-1.onnx','phase-2.onnx'].map((name,index)=>{
  const data=Uint8Array.of([1,9,2,3][index]),url='https://fixture.invalid/matte/'+name;payload.set(url,data);
  return {name,url,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};
 });
 class NativeTensor{constructor(type,data,dims){Object.assign(this,{type,data,dims,location:'cpu'});live.add(this);}async getData(){return this.data;}dispose(){live.delete(this);if(this.invalidateOnDispose)this.data.fill(NaN);if(tensorReleaseFailure)throw Error('native-tensor-release-failed');}}
 class Tensor{constructor(type,data,dims){Object.assign(this,{type,data,dims});}dispose(){this.data=null;}}
 const ort={Tensor:NativeTensor,InferenceSession:{async create(bytes,options){
  const phase=new Uint8Array(bytes)[0]-1;creates++;order.push('create'+phase);assert.equal(backend==='webgpu'?options.executionProviders[0].name:options.executionProviders[0],backend);assert.equal(options.externalData?.length??0,phase===0?1:0);if(waitCreate)await waitCreate(phase);
  return {async run(feeds){
   order.push('run'+phase);assert.deepEqual(Object.keys(feeds).sort(),phase===0?['pixel_values']:phase===1?['add_13650','pixel_values']:['pixel_values','relu_5']);
   if(waitRun)await waitRun(phase);if(runFailure&&phase===1)throw Error('native-run-failed');
   const h=feeds.pixel_values.dims[2],w=feeds.pixel_values.dims[3],dims=phase===0?[1,768,h/16,w/16]:phase===1?[1,64,h/2,w/2]:[1,1,h,w],name=['add_13650','relu_5','alphas'][phase];
   if(phase>0)assert(feeds[phase===1?'add_13650':'relu_5'].data.every(Number.isFinite));
   const next=new NativeTensor('float32',new Float32Array(dims.reduce((a,b)=>a*b,1)).fill(nonFinite?NaN:.5),invalidOutput?[1,1,1,1]:dims);
   if(backend==='webgpu'){next.location='gpu-buffer';next.invalidateOnDispose=true;next.getData=async()=>{order.push('readback'+phase);return next.data;};}
   return {[name]:next};
  },async release(){order.push('release'+phase);if(releaseFailure&&phase===0)throw Error('native-release-failed');}};
 }}};
 const cache={async match(url){return stored.has(url)?new Response(stored.get(url)):undefined;},async put(url,response){if(quota)throw new DOMException('quota','QuotaExceededError');stored.set(url,new Uint8Array(await response.arrayBuffer()));}};
 const device={features:new Set(),queue:{async onSubmittedWorkDone(){order.push('queue');if(queueFailure)throw Error('queue-failed');}},destroy(){}};
 const prepare=createPhasedMattePreparation({library:{Tensor,env:{}},ort,cache,fetchImpl:async url=>new Response(payload.get(url)),makeHasher:()=>{const h=createHash('sha256');return {update:b=>h.update(b),digestHex:()=>h.digest('hex')};},configureRuntime:async()=>{owners++;const runtime={executionProvider:backend,sessionOptions:{executionProviders:backend==='wasm'?['wasm']:[{name:'webgpu',device,preferredLayout:'NCHW',storageBufferCacheMode:'disabled'}],...(backend==='webgpu'?{extra:{session:{disable_cpu_ep_fallback:'0'},ep:{webgpuexecutionprovider:{maxNumPendingDispatches:'1'}}}}:{})},async dispose(){order.push('owner-dispose');}};mutateRuntime(runtime);return runtime;}});
 const release={model:'matte',modelVersion:'test',resources};
 const pixels=new Tensor('float32',new Float32Array(1*4*32*64).fill(.25),[1,4,32,64]);
 return {prepare,release,pixels,stored,order,live,stats:()=>({creates,owners}),resources};
}
test('verified assets gate preparation, then three native sessions run/release sequentially without consuming processor pixels',async()=>{
 const f=fixture(),handle=await f.prepare(f.release);assert.deepEqual(f.stats(),{creates:0,owners:1});assert.equal(f.stored.size,4);
 const result=await handle.runStaged({pixel_values:f.pixels});assert.deepEqual(result.alphas.dims,[1,1,32,64]);assert.equal(result.alphas.data[0],.5);assert.equal(f.pixels.data[0],.25);
 assert.deepEqual(f.order,['create0','run0','release0','create1','run1','release1','create2','run2','release2']);assert.equal(f.live.size,0);
 await handle.dispose();await handle.dispose();assert.equal(f.order.filter(x=>x==='owner-dispose').length,1);
 await assert.rejects(handle.runStaged({pixel_values:f.pixels}),/unavailable/);
});
test('cancellation during native run waits for release and prevents the next phase',async()=>{
 let started,finish;const entered=new Promise(r=>started=r),waiting=new Promise(r=>finish=r);
 const f=fixture({waitRun:async phase=>{if(phase===0){started();await waiting;}}}),handle=await f.prepare(f.release),controller=new AbortController();
 const run=handle.runStaged({pixel_values:f.pixels},{signal:controller.signal});await entered;controller.abort();finish();await assert.rejects(run,/aborted/);
 assert.equal(f.stats().creates,1);assert.equal(f.live.size,0);assert.ok(f.order.includes('release0'));await handle.dispose();
});
test('dispose waits for an active native run and blocks new work',async()=>{
 let started,finish;const entered=new Promise(r=>started=r),waiting=new Promise(r=>finish=r);
 const f=fixture({waitRun:async()=>{started();await waiting;}}),handle=await f.prepare(f.release);
 const run=handle.runStaged({pixel_values:f.pixels});await entered;const rejected=assert.rejects(run,/aborted/);let finished=false;const closing=handle.dispose().then(()=>finished=true);await Promise.resolve();assert.equal(finished,false);finish();await rejected;await closing;assert.equal(f.stats().creates,1);assert.equal(f.live.size,0);
});
test('failed native run releases its session/tensors and cannot start later phases',async()=>{
 const f=fixture({runFailure:true}),handle=await f.prepare(f.release);await assert.rejects(handle.runStaged({pixel_values:f.pixels}),/native-run-failed/);assert.equal(f.stats().creates,2);assert.equal(f.live.size,0);assert.ok(f.order.includes('release1'));await handle.dispose();
});
test('failed session release poisons the owner and cleanup never claims success',async()=>{
 const f=fixture({releaseFailure:true}),handle=await f.prepare(f.release);await assert.rejects(handle.runStaged({pixel_values:f.pixels}),/release/);assert.equal(f.stats().creates,1);assert.equal(f.live.size,0);await assert.rejects(handle.dispose(),/release/);assert.ok(f.order.includes('owner-dispose'));
});
test('corrupt cached graph is refused before creating a session and quota cannot prepare',async()=>{
 const f=fixture(),handle=await f.prepare(f.release);f.stored.set(f.resources[0].url,Uint8Array.of(99));await assert.rejects(handle.runStaged({pixel_values:f.pixels}),/checksum/);assert.equal(f.stats().creates,0);await handle.dispose();
 const quota=fixture({quota:true});await assert.rejects(quota.prepare(quota.release));assert.equal(quota.stats().creates,0);
});
test('invalid roles/resources and unpadded, oversized or wrong-type tensors never start native inference',async()=>{
 const f=fixture();await assert.rejects(f.prepare({...f.release,model:'hr'}));await assert.rejects(f.prepare({...f.release,resources:f.resources.slice(1)}));const handle=await f.prepare(f.release);
 for(const pixel_values of [{...f.pixels,type:'float16'},{...f.pixels,dims:[1,4,31,64]},{...f.pixels,dims:[1,4,2048,2048]}])await assert.rejects(handle.runStaged({pixel_values}));
 assert.equal(f.stats().creates,0);await handle.dispose();
});
test('cancel during native session creation releases the session without starting inference',async()=>{
 let entered,finish;const started=new Promise(resolve=>entered=resolve),waiting=new Promise(resolve=>finish=resolve);
 const f=fixture({waitCreate:async()=>{entered();await waiting;}}),handle=await f.prepare(f.release),controller=new AbortController();
 const run=handle.runStaged({pixel_values:f.pixels},{signal:controller.signal});await started;controller.abort();finish();
 await assert.rejects(run,/aborted/);assert.equal(f.stats().creates,1);assert.ok(!f.order.includes('run0'));assert.ok(f.order.includes('release0'));assert.equal(f.live.size,0);await handle.dispose();
});
test('malformed native output is rejected and released before the next session',async()=>{
 const f=fixture({invalidOutput:true}),handle=await f.prepare(f.release);
 await assert.rejects(handle.runStaged({pixel_values:f.pixels}),/invalid-matte-phase-output/);
 assert.equal(f.stats().creates,1);assert.equal(f.live.size,0);assert.ok(f.order.includes('release0'));await handle.dispose();
});
test('tensor release failure blocks reuse and disposal reports failure after owner cleanup',async()=>{
 const f=fixture({tensorReleaseFailure:true}),handle=await f.prepare(f.release);
 await assert.rejects(handle.runStaged({pixel_values:f.pixels}),/release/);assert.equal(f.stats().creates,1);assert.ok(f.order.includes('release0'));
 await assert.rejects(handle.runStaged({pixel_values:f.pixels}),/unavailable/);await assert.rejects(handle.dispose(),/release/);assert.ok(f.order.includes('owner-dispose'));
});
test('concurrent inference is refused while the original run still completes successfully',async()=>{
 let entered,finish;const started=new Promise(resolve=>entered=resolve),waiting=new Promise(resolve=>finish=resolve);
 const f=fixture({waitRun:async phase=>{if(phase===0){entered();await waiting;}}}),handle=await f.prepare(f.release);
 const run=handle.runStaged({pixel_values:f.pixels});await started;
 await assert.rejects(handle.runStaged({pixel_values:f.pixels}),/busy/);finish();const result=await run;
 assert.deepEqual(result.alphas.dims,[1,1,32,64]);assert.equal(f.stats().creates,3);assert.equal(f.live.size,0);await handle.dispose();
});
test('a later cached phase corrupted after preparation is refused without leaking the completed session',async()=>{
 const f=fixture(),handle=await f.prepare(f.release);f.stored.set(f.resources[2].url,Uint8Array.of(99));
 await assert.rejects(handle.runStaged({pixel_values:f.pixels}),/checksum/);assert.equal(f.stats().creates,1);assert.ok(f.order.includes('release0'));assert.equal(f.live.size,0);await handle.dispose();
});
test('GPU phases read back owned CPU seams and wait for release and queue before advancing',async()=>{
 const f=fixture({backend:'webgpu'}),handle=await f.prepare(f.release),result=await handle.runStaged({pixel_values:f.pixels});
 assert.deepEqual(result.alphas.dims,[1,1,32,64]);assert(result.alphas.data.every(v=>v===.5));assert(f.pixels.data.every(v=>v===.25));assert.equal(f.live.size,0);
 for(let phase=0;phase<2;phase++){const released=f.order.indexOf('release'+phase),next=f.order.indexOf('create'+(phase+1));assert(released>=0&&f.order.indexOf('queue',released)>released&&f.order.indexOf('queue',released)<next);}
 await handle.dispose();
});
test('GPU backend/profile mismatches are rejected before any session',async()=>{
 for(const mutateRuntime of [r=>{r.executionProvider='wasm';},r=>{r.sessionOptions.executionProviders=['wasm'];},r=>{r.sessionOptions.executionProviders[0].preferredLayout='NHWC';},r=>{r.sessionOptions.extra.ep.webgpuexecutionprovider.maxNumPendingDispatches='16';},r=>{r.sessionOptions.executionProviders[0].device.features.add('subgroups');}]){
  const f=fixture({backend:'webgpu',mutateRuntime});await assert.rejects(f.prepare(f.release));assert.equal(f.stats().creates,0);assert(f.order.includes('owner-dispose'));
 }
});
for(const failure of ['releaseFailure','tensorReleaseFailure','queueFailure'])test('GPU '+failure+' poisons ownership before the next phase',async()=>{
 const f=fixture({backend:'webgpu',[failure]:true}),handle=await f.prepare(f.release);await assert.rejects(handle.runStaged({pixel_values:f.pixels}));assert.equal(f.stats().creates,1);await assert.rejects(handle.runStaged({pixel_values:f.pixels}),/unavailable/);await assert.rejects(handle.dispose());assert(f.order.includes('owner-dispose'));
});
test('nonfinite GPU output rejects before a seam is passed onward',async()=>{
 const f=fixture({backend:'webgpu',nonFinite:true}),handle=await f.prepare(f.release);await assert.rejects(handle.runStaged({pixel_values:f.pixels}),/invalid-matte-phase-output/);assert.equal(f.stats().creates,1);await handle.dispose();
});
test('GPU cancellation waits for session/queue release and cannot reuse the handle',async()=>{
 let entered,finish;const started=new Promise(r=>entered=r),waiting=new Promise(r=>finish=r);const f=fixture({backend:'webgpu',waitRun:async phase=>{if(phase===0){entered();await waiting;}}});
 const handle=await f.prepare(f.release),controller=new AbortController(),run=handle.runStaged({pixel_values:f.pixels},{signal:controller.signal});await started;controller.abort();finish();await assert.rejects(run,/aborted/);assert.equal(f.stats().creates,1);assert(f.order.includes('release0')&&f.order.includes('queue'));await assert.rejects(handle.runStaged({pixel_values:f.pixels}),/unavailable/);await handle.dispose();
});
