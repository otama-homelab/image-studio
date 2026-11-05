import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {resolveStageWorker,createStagedHrPreparation} from '../tools/browser-library-adapter/staged-hr-prepare.mjs';
import {createStageWorkerHandler} from '../tools/browser-library-adapter/stage-worker-handler.mjs';
import {checkWorkerEvent} from '../tools/browser-library-adapter/worker-event.mjs';
const port=(name,dtype,dims)=>({name,dtype,dims});
function fixture({warm=false,corrupt=false,quota=false,verifiedScript=false,scriptFailure=false,workerLifetime}={}){
 const bytes=Uint8Array.of(1,2,3),sha256=createHash('sha256').update(bytes).digest('hex'),order=[],events=[],stored=new Map();let workers=0,network=0;
 const stages=[{inputs:[port('pixels','float16',[1,3,2048,2048])],outputs:[port('hidden','float32',[2])]},{inputs:[port('hidden','float32',[2])],outputs:[port('alpha','float32',[1,1,2048,2048])]}].map((s,i)=>({...s,release:{resources:[{name:'config.json',url:`https://assets.invalid/stage-${i}/config.json`,bytes:3,sha256}]}}));
 const release={model:'hr',modelVersion:'set',resources:stages.flatMap((s,i)=>s.release.resources.map(f=>({...f,name:`stage-${String(i).padStart(3,'0')}/${f.name}`})))};
 if(warm)for(const f of release.resources)stored.set(f.url,new Response(corrupt?Uint8Array.of(3,2,1):bytes));
 class Tensor{constructor(type,data,dims){Object.assign(this,{type,data,dims});}dispose(){this.data=null;}}
 const createWorker=()=>{
  workers++;const listeners=new Map();let dead=false;
  const handler=createStageWorkerHandler({catalog:stages,Tensor,maxJobs:workerLifetime==='per-run'?stages.length:1,prepareStage:async index=>({async model(){order.push('model:'+index);return index===0?{hidden:new Tensor('float32',Float32Array.of(1,2),[2])}:{alpha:new Tensor('float32',new Float32Array(2048*2048).fill(.5),[1,1,2048,2048])};},async dispose(){order.push('dispose:'+index);}}),postMessage:(event,transfer=[])=>{const copy=structuredClone(event,{transfer});queueMicrotask(()=>{if(!dead)listeners.get('message')?.({data:copy});});}});
  return {addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type),postMessage:(command,transfer)=>{const copy=structuredClone(command,{transfer});queueMicrotask(()=>void handler(copy));},terminate(){dead=true;order.push('stop');}};
 };
 const workerScript=verifiedScript?{async prepare(){order.push('script-ready');if(scriptFailure)throw Error('private');},async close(){order.push('script-close');},createWorker}:undefined;
 const prepare=createStagedHrPreparation({library:{Tensor},stages,...(workerLifetime?{workerLifetime,cancellationProtocol:'cooperative-stage-cancel-v1'}:{}),createWorker,workerScript,fetchImpl:async()=>{network++;return new Response(bytes);},cache:{async match(url){return stored.get(url)?.clone();},async put(url,response){if(quota)throw new DOMException('quota','QuotaExceededError');stored.set(url,new Response(await response.arrayBuffer()));}},makeHasher:()=>{const hash=createHash('sha256');return {update:b=>hash.update(b),digestHex:()=>hash.digest('hex')};}});
 return {prepare,release,events,order,workers:()=>workers,network:()=>network,stored,options:{emit:event=>events.push(event)}};
}
test('main HR model contract preloads every alias then returns a library Tensor through disposable stages',async()=>{
 const f=fixture(),handle=await f.prepare(f.release,f.options);assert.equal(f.workers(),0);assert.equal(f.network(),2);assert.equal(f.stored.size,2);
 const context={type:'prepare',workerId:'w',jobId:'j',modelVersion:'set',resources:f.release.resources};
 for(const e of f.events)assert.equal(checkWorkerEvent({...e,workerId:'w',jobId:'j'},context).status,'accepted');
 assert.equal(f.events.at(-1).resources.length,1);assert.equal(f.events.at(-1).resources[0].stored,true);
 const data=new Uint16Array(3*2048*2048),result=await handle.model({pixels:{type:'float16',dims:[1,3,2048,2048],data}});
 assert.equal(data.byteLength,0);assert.equal(result.alpha.type,'float32');assert.deepEqual(result.alpha.dims,[1,1,2048,2048]);assert.equal(result.alpha.data[400],.5);
 assert.deepEqual(f.order,['model:0','dispose:0','stop','model:1','dispose:1','stop']);
 await handle.dispose();await assert.rejects(handle.model(),/invalid-hr-fp16/);
});
test('warm cache is drained and verified without network or GPU preparation',async()=>{
 const f=fixture({warm:true}),handle=await f.prepare(f.release,f.options);assert.equal(f.network(),0);assert.equal(f.workers(),0);assert.equal(f.events.at(-1).resources[0].cacheVerified,true);await handle.dispose();
});
for(const options of [{warm:true,corrupt:true},{quota:true}])test('corrupt or unstored stage resources never publish a prepared model '+JSON.stringify(options),async()=>{
 const f=fixture(options);await assert.rejects(f.prepare(f.release,f.options));assert.equal(f.workers(),0);
});
test('untrusted stage mapping is refused before model download',async()=>{
 const f=fixture();f.release.resources[1].url='https://assets.invalid/other';await assert.rejects(f.prepare(f.release),e=>e.code==='invalid-preparation-policy');assert.equal(f.network(),0);assert.equal(f.workers(),0);
});

test('verified child script is prepared and its owner closes after staged model disposal',async()=>{
 const f=fixture({verifiedScript:true});const handle=await f.prepare(f.release,f.options);assert.equal(f.order[0],'script-ready');assert.equal(f.workers(),0);await handle.dispose();assert.equal(f.order.at(-1),'script-close');
});
test('script verification and model-cache failures both close the script owner before rejecting',async()=>{
 for(const options of [{verifiedScript:true,scriptFailure:true},{verifiedScript:true,quota:true}]){
  const f=fixture(options);await assert.rejects(f.prepare(f.release,f.options));assert.equal(f.workers(),0);assert.equal(f.order.at(-1),'script-close');if(options.scriptFailure)assert.equal(f.network(),0);
 }
});
test('parent inference signal reaches staged runner before any child is created',async()=>{
 const f=fixture(),handle=await f.prepare(f.release,f.options),controller=new AbortController();controller.abort();
 const data=new Uint16Array(3*2048*2048);
 await assert.rejects(handle.runStaged({pixels:{type:'float16',dims:[1,3,2048,2048],data}},{signal:controller.signal}),e=>e.code==='aborted');
 assert.equal(f.workers(),0);assert.equal(data.byteLength,25165824);await handle.dispose();
});

test('explicit per-run preparation passes one-worker lifetime through real model contract',async()=>{
 const f=fixture({workerLifetime:'per-run'}),handle=await f.prepare(f.release,f.options);const result=await handle.model({pixels:{type:'float16',dims:[1,3,2048,2048],data:new Uint16Array(3*2048*2048)}});assert.equal(result.alpha.data[400],.5);assert.equal(f.workers(),1);assert.deepEqual(f.order,['model:0','dispose:0','model:1','dispose:1','stop']);await handle.dispose();
});
test('unknown preparation worker lifetime is rejected rather than silently using defaults',()=>{
 assert.throws(()=>fixture({workerLifetime:'pool'}),e=>e.code==='invalid-preparation-policy');
});

test('stage Worker accepts immutable public assets only with a matching verified descriptor',()=>{
 const origin='https://preview.image-studio.pages.dev',hash='a'.repeat(64);
 const worker=origin+'/assets/'+hash+'/stage-worker.js';
 const workerFile={url:worker,bytes:123,sha256:hash};
 assert.equal(resolveStageWorker({worker,workerFile},origin).href,worker);
 assert.equal(resolveStageWorker({worker,workerFile:{...workerFile,bytes:2*1024*1024}},origin).href,worker);
 const privateWorker=origin+'/validation-workers/'+hash+'/stage-worker.js';
 assert.equal(resolveStageWorker({worker:privateWorker},origin).href,privateWorker);
 for(const policy of [{worker},{worker,workerFile:{...workerFile,sha256:'b'.repeat(64)}},{worker,workerFile:{...workerFile,bytes:0}},{worker,workerFile:{...workerFile,bytes:2*1024*1024+1}},{worker,workerFile:{...workerFile,sha256:undefined}},{worker,workerFile:{...workerFile,url:privateWorker}}])assert.throws(()=>resolveStageWorker(policy,origin));
 for(const url of [worker+'?x=1',worker+'#x',worker.replace(origin,'https://other.invalid'),worker.replace('/assets/','/arbitrary/'),worker.replace(hash,'latest'),worker.replace('https://','https://user:pass@')])assert.throws(()=>resolveStageWorker({worker:url,workerFile:{...workerFile,url}},origin));
});


test('the same relative child Worker descriptor resolves on preview and production without changing its hash',()=>{
 const hash='a'.repeat(64),worker='/assets/'+hash+'/stage-worker.js';
 for(const origin of ['https://preview.image-studio.pages.dev','https://image-studio.otama-playground.com']){
  const workerFile={url:worker,bytes:123,sha256:hash};
  assert.equal(resolveStageWorker({worker,workerFile},origin).href,origin+worker);
  assert.equal(resolveStageWorker({worker,workerFile:{...workerFile,url:origin+worker}},origin).href,origin+worker);
  assert.throws(()=>resolveStageWorker({worker,workerFile:{...workerFile,url:'https://outside.invalid'+worker}},origin));
 }
});
