import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {createAlphaCommitter} from '../tools/browser-library-adapter/alpha-commit.mjs';
import {createImageRegistry} from '../tools/browser-library-adapter/image-registry.mjs';
import {createWorkerClient} from '../tools/browser-library-adapter/worker-client.mjs';
const release={model:'hr',modelVersion:'set-1',releaseId:'r1',cacheNamespace:'studio-r1',resources:[{name:'model.onnx',url:'https://assets.invalid/r1/model.onnx',sha256:'a'.repeat(64),bytes:3}]};
const prepare={type:'prepare',model:'hr',modelVersion:'set-1',source:{mode:'library-resources',releaseId:'r1',cacheNamespace:'studio-r1',resources:release.resources}};
function setup(t,crash=false){
 const adapters=[],failures=[];
 const client=createWorkerClient({onWorkerFailure:event=>failures.push(event),createWorker:()=>{
  const thread=new Worker(new URL('./fixtures/worker-protocol-thread.mjs',import.meta.url),{workerData:{release,crash},resourceLimits:{maxOldGenerationSizeMb:16}});
  const listeners=new Map();let termination;
  const adapter={
   addEventListener(type,fn){const wrapped=type==='message'?data=>fn({data}):()=>fn({});listeners.set(fn,wrapped);thread.on(type,wrapped);},
   removeEventListener(type,fn){const wrapped=listeners.get(fn);if(wrapped){thread.off(type,wrapped);listeners.delete(fn);}},
   postMessage(message,transfer){thread.postMessage(message,transfer);},
   terminate(){termination??=thread.terminate();},
   async close(){this.terminate();await termination;},
  };
  adapters.push(adapter);return adapter;
 }});
 t.after(async()=>{client.cancel();for(const adapter of adapters)await adapter.close();});
 return {client,adapters,failures};
}
function request(buffer){return {type:'infer',key:{inputId:'input-1',inferenceRevision:1,modelVersion:'set-1'},rgb:{width:2,height:1,layout:'rgb-u8-interleaved',data:buffer},refine:false};}
test('real thread transfers disposable RGB and result alpha; dispose closes its owner',{timeout:5000},async t=>{
 const f=setup(t);await f.client.request(prepare);
 const registry=createImageRegistry(),original=Uint8Array.of(10,20,30,40,50,60);
 const asset=registry.register({width:2,height:1,format:'rgb-u8',data:original.buffer},'session');
 const {rgb}=registry.inferencePlanes(asset.id),copy=rgb.data;
 const pending=f.client.request(request(copy));assert.equal(copy.byteLength,0);
 const result=await pending;assert.deepEqual([...new Uint8Array(result.alpha.data)],[10,40]);
 assert.deepEqual([...new Uint8Array(registry.copy(asset.id).data)],[10,20,30,40,50,60]);
 const alpha=registry.register({width:2,height:1,format:'alpha-u8',data:result.alpha.data},'background');
 assert.equal(result.alpha.data.byteLength,0);assert.deepEqual([...new Uint8Array(registry.copy(alpha.id).data)],[10,40]);
 registry.retain(asset.id,'crop');registry.release(asset.id,'session');assert.equal(registry.get(asset.id),asset);
 registry.release(asset.id,'crop');registry.release(alpha.id,'background');
 await f.client.request({type:'dispose'});await f.adapters[0].close();
 assert.equal(f.client.getState().workerId,null);assert.equal(f.failures.length,0);
});
test('uncaught real thread failure rejects the request and reports only a fixed error',{timeout:5000},async t=>{
 const f=setup(t,true);await f.client.request(prepare);
 await assert.rejects(f.client.request(request(new ArrayBuffer(6))),e=>e.code==='runtime-error'&&e.message==='runtime-error');
 assert.equal(f.client.getState().workerId,null);assert.equal(f.failures.length,1);
 assert.equal(f.failures[0].code,'runtime-error');assert.equal(JSON.stringify(f.failures).includes('private'),false);
 await f.adapters[0].close();
});

test('domain revision changed during real thread work prevents stale alpha registration',{timeout:5000},async t=>{
 const f=setup(t);await f.client.request(prepare);const registry=createImageRegistry();
 const input=registry.register({width:2,height:1,format:'rgb-u8',data:Uint8Array.of(10,20,30,40,50,60).buffer},'session');
 let current={rgbAssetId:input.id,key:{inputId:'input-1',inferenceRevision:1,modelVersion:'set-1'}};
 const committer=createAlphaCommitter({registry,getCurrent:()=>current});t.after(()=>committer.close());
 const pending=f.client.request(request(registry.inferencePlanes(input.id).rgb.data));
 current={...current,key:{...current.key,inferenceRevision:2}};
 const old=await pending;assert.equal(committer.commit(old).status,'stale');assert.equal(committer.get(),null);
 const latest=request(registry.inferencePlanes(input.id).rgb.data);latest.key={...current.key};
 const result=await f.client.request(latest),accepted=committer.commit(result);
 assert.equal(accepted.status,'committed');assert.equal(committer.get().status,'valid');
 assert.deepEqual([...new Uint8Array(registry.copy(accepted.image.id).data)],[10,40]);
 await f.client.request({type:'dispose'});await f.adapters[0].close();
 committer.close();registry.release(input.id,'session');
});
