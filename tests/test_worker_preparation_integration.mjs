import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createTransformersPreparation} from '../tools/browser-library-adapter/transformers-prepare.mjs';
import {createWorkerHandler} from '../tools/browser-library-adapter/worker-handler.mjs';
const base='https://assets.invalid/releases/r1/';
function setup(quota){
 const payloads=new Map(),order=[],events=[],stored=new Map();
 const resources=['config.json','onnx/model_fp16.onnx','onnx/model.onnx.data'].map((name,i)=>{
  const bytes=Uint8Array.of(i+1,i+2,i+3),url=base+'hr/'+name;payloads.set(url,bytes);
  return {name,url,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 });
 const release={model:'hr',modelVersion:'set-1',releaseId:'r1',cacheNamespace:'studio-r1',resources};
 const env={},Model={async from_pretrained(){
  for(const file of resources){
   const response=await env.fetch(file.url);
   try{await env.customCache.put(file.url,response.clone());}catch{}
   await response.arrayBuffer();
  }
  return {async dispose(){order.push('model-release');}};
 }};
 const prepare=createTransformersPreparation({library:{env,PreTrainedModel:Model},localModelPath:base,
  fetchImpl:async url=>new Response(payloads.get(url)),cache:{async match(){},async put(url,response){if(quota)throw new DOMException('private quota cause','QuotaExceededError');stored.set(url,await response.arrayBuffer());}},
  makeHasher:()=>{const h=createHash('sha256');return {update:b=>h.update(b),digestHex:()=>h.digest('hex')};},
  configureRuntime:async()=>({async dispose(){order.push('runtime-release');}})});
 const handle=createWorkerHandler({trustedModels:[release],prepare,infer:async wrapper=>{
  assert.ok(wrapper.model);return {width:2,height:1,layout:'alpha-u8',data:Uint8Array.of(0,255).buffer};
 },postMessage:e=>events.push(e)});
 return {handle,events,order,stored,command:{type:'prepare',workerId:'worker-1',jobId:'job-1',model:'hr',modelVersion:'set-1',source:{mode:'library-resources',releaseId:'r1',cacheNamespace:'studio-r1',resources}}};
}
test('receiver and preparation factory publish prepared only after all three resources are stored',{timeout:1000},async()=>{
 const f=setup(false);await f.handle(f.command);
 assert.equal(f.events.at(-1).type,'prepared');assert.equal(f.stored.size,3);
 const state=f.events.filter(e=>e.type==='resource-state').at(-1);
 assert.equal(state.resources.length,3);assert.ok(state.resources.every(s=>s.stored&&s.networkVerified&&s.lastError===null));
 await f.handle({type:'infer',workerId:'worker-1',jobId:'job-2',key:{inputId:'input-1',inferenceRevision:1,modelVersion:'set-1'},rgb:{width:2,height:1,layout:'rgb-u8-interleaved',data:new ArrayBuffer(6)},refine:false});
 assert.equal(f.events.at(-1).type,'result');
 await f.handle({type:'dispose',workerId:'worker-1',jobId:'job-3'});assert.equal(f.events.at(-1).type,'disposed');
 assert.deepEqual(f.order,['model-release','runtime-release']);
});
test('quota keeps its final resource cause, releases handles and never publishes prepared',{timeout:1000},async()=>{
 const f=setup(true);await f.handle(f.command);
 assert.equal(f.events.some(e=>e.type==='prepared'),false);assert.equal(f.events.at(-1).type,'error');
 assert.equal(JSON.stringify(f.events).includes('private'),false);
 const states=f.events.filter(e=>e.type==='resource-state').at(-1).resources;
 assert.ok(states.every(s=>s.networkVerified&&!s.stored&&s.lastError==='cache-quota-exceeded'));
 assert.deepEqual(f.order,['model-release','runtime-release']);
});
