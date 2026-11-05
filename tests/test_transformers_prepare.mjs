import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createTransformersPreparation} from '../tools/browser-library-adapter/transformers-prepare.mjs';
const base='https://assets.invalid/releases/r1/';
function fixture(role='hr',{quota=false,loadFailure=false,disposeFailure=false,provider,runtimeProvider,onLoadFailure,portraitCpu=false,external=true,onConfigure,onLoaded,liteGraphFormat,now}={}){
 const bytes=Uint8Array.of(1,2,3),sha256=createHash('sha256').update(bytes).digest('hex'),stored=new Map(),events=[],order=[],calls=[];
 const release={model:role,modelVersion:'set-1',resources:['config.json','onnx/'+(['hr','portrait'].includes(role)?'model_fp16.onnx':'model.onnx'),...(external?['onnx/model.onnx.data']:[])].map(name=>({name,url:base+role+'/'+name,bytes:3,sha256}))};
 const env={},Model={async from_pretrained(id,options){
  calls.push({id,options});assert.equal(env.logLevel,50);assert.equal(env.allowRemoteModels,false);
  if(loadFailure)throw Error('private load payload');
  for(const file of release.resources){
   let response=await env.customCache.match(file.url);
   if(!response){response=await env.fetch(file.url);try{await env.customCache.put(file.url,response.clone());}catch{/* published library can return uncached bytes */}}
   await response.arrayBuffer();
  }
  onLoaded?.();return {kind:role,async dispose(){order.push('model');if(disposeFailure)throw Error('private release payload');}};
 }};
 const prepare=createTransformersPreparation({library:{env,PreTrainedModel:Model,VitMatteForImageMatting:Model},localModelPath:base,onLoadFailure,now,
  fetchImpl:async()=>new Response(bytes),cache:{async match(url){return stored.get(url)?.clone();},async put(url,response){if(quota)throw new DOMException('private quota payload','QuotaExceededError');stored.set(url,new Response(await response.arrayBuffer()));}},
  makeHasher:()=>{const hash=createHash('sha256');return {update:b=>hash.update(b),digestHex:()=>hash.digest('hex')};},
  configureRuntime:async()=>{onConfigure?.();return {executionProvider:runtimeProvider,liteGraphFormat,sessionOptions:{...(provider?{executionProviders:[provider]}:{}),extra:{session:{disable_cpu_ep_fallback:portraitCpu?'0':'incorrect'}}},async dispose(){order.push('runtime');}};}});
 return {prepare,release,events,order,calls,env};
}
test('fixed roles use explicit API options and dispose model then runtime exactly once',async()=>{
 for(const role of ['hr','matte','modnet','portrait']){
  const f=fixture(role),handle=await f.prepare(f.release,{emit:e=>f.events.push(e)});
  assert.equal(handle.model.kind,role);const options=f.calls[0].options;
  assert.equal(options.device,'webgpu');assert.equal(options.dtype,['hr','portrait'].includes(role)?'fp16':'fp32');
  assert.equal(options.session_options.extra.session.disable_cpu_ep_fallback,role==='matte'?'0':'1');
  assert.deepEqual(options.session_options.externalData,[{path:'model.onnx.data',data:'onnx/model.onnx.data'}]);
  assert.ok(f.events.every(e=>e.type==='resource-state'&&!JSON.stringify(e).includes('https:')));
  await handle.dispose();await handle.dispose();assert.deepEqual(f.order,['model','runtime']);
 }
});
test('uncached handles returned after quota failure are released before rejection',{timeout:1000},async()=>{
 const f=fixture('hr',{quota:true});
 await assert.rejects(f.prepare(f.release),e=>e.code==='model-resources-not-stored');assert.deepEqual(f.order,['model','runtime']);
});
test('load failure releases runtime and model dispose failure still releases runtime',async()=>{
 const failed=fixture('hr',{loadFailure:true});
 await assert.rejects(failed.prepare(failed.release),e=>e.code==='model-load-failed');assert.deepEqual(failed.order,['runtime']);
 const disposed=fixture('hr',{disposeFailure:true}),handle=await disposed.prepare(disposed.release);
 await assert.rejects(handle.dispose());assert.deepEqual(disposed.order,['model','runtime']);
});
test('optional local load diagnostics cannot alter the fixed failure or prevent runtime disposal',async()=>{
 for(const throwHook of [false,true]){
  const messages=[],f=fixture('hr',{loadFailure:true,onLoadFailure:error=>{messages.push(error.message);if(throwHook)throw Error('diagnostic failure');}});
  await assert.rejects(f.prepare(f.release),error=>error.code==='model-load-failed'&&!error.message.includes('private load payload'));
  assert.deepEqual(messages,['private load payload']);assert.deepEqual(f.order,['runtime']);
 }
});
test('wrong distribution paths are refused before configuring runtime or loading',async()=>{
 const f=fixture();f.release.resources[1].url=base+'hr/onnx/wrong.onnx';
 await assert.rejects(f.prepare(f.release),e=>e.code==='invalid-preparation-policy');assert.equal(f.calls.length,0);assert.deepEqual(f.order,[]);
});

test('runtime cannot substitute a CPU-only execution provider',async()=>{
 const f=fixture('hr',{provider:'cpu'});
 await assert.rejects(f.prepare(f.release),e=>e.code==='model-load-failed');assert.equal(f.calls.length,0);assert.deepEqual(f.order,['runtime']);
});


test('a verified self-contained graph needs no dummy external file or automatic weight discovery',async()=>{
 const f=fixture('hr',{external:false}),handle=await f.prepare(f.release);
 assert.equal(f.release.resources.length,2);
 assert.equal(f.calls[0].options.use_external_data_format,false);
 assert.deepEqual(f.calls[0].options.session_options.externalData,[]);
 await handle.dispose();assert.deepEqual(f.order,['model','runtime']);
});

test('portrait preserves only the trusted runtime request for CPU fallback, while HR cannot be loosened',async()=>{
 for(const role of ['portrait','hr']){const f=fixture(role,{portraitCpu:true});const handle=await f.prepare(f.release);assert.equal(f.calls[0].options.session_options.extra.session.disable_cpu_ep_fallback,role==='portrait'?'0':'1');await handle.dispose();}
});

test('explicit MODNet WASM mode uses the published CPU provider and cannot silently downgrade other profiles',async()=>{
 const f=fixture('modnet',{runtimeProvider:'wasm',provider:'wasm',external:false}),handle=await f.prepare(f.release);const options=f.calls[0].options;assert.equal(options.device,'wasm');assert.equal(options.dtype,'fp32');assert.equal(options.session_options.extra.session.disable_cpu_ep_fallback,'0');await handle.dispose();
 for(const options of [{role:'portrait',runtimeProvider:'wasm'},{role:'modnet',runtimeProvider:undefined}]){const f=fixture(options.role,{provider:'wasm',runtimeProvider:options.runtimeProvider});await assert.rejects(f.prepare(f.release),/model-load-failed/);assert.equal(f.calls.length,0);assert.deepEqual(f.order,['runtime']);}
});


test('native lite requires an explicit WASM owner and uses the self-contained FP32 model',async()=>{
 const f=fixture('lite',{runtimeProvider:'wasm',provider:'wasm',external:false}),handle=await f.prepare(f.release);
 assert.equal(f.calls[0].id,'lite');assert.equal(f.calls[0].options.device,'wasm');assert.equal(f.calls[0].options.dtype,'fp32');assert.deepEqual(f.calls[0].options.session_options.externalData,[]);await handle.dispose();
 for(const runtimeProvider of [undefined,'webgpu']){const bad=fixture('lite',{runtimeProvider});await assert.rejects(bad.prepare(bad.release),/model-load-failed/);assert.equal(bad.calls.length,0);assert.deepEqual(bad.order,['runtime']);}
});

test('abort before runtime, during runtime creation, and after loading cannot publish a model or leak its owner',async()=>{
 const early=new AbortController();early.abort();const a=fixture();await assert.rejects(a.prepare(a.release,{signal:early.signal}),e=>e.code==='aborted');assert.deepEqual(a.order,[]);assert.equal(a.calls.length,0);
 const during=new AbortController(),b=fixture('hr',{onConfigure:()=>during.abort()});await assert.rejects(b.prepare(b.release,{signal:during.signal}),e=>e.code==='aborted');assert.deepEqual(b.order,['runtime']);assert.equal(b.calls.length,0);
 const late=new AbortController(),c=fixture('hr',{onLoaded:()=>late.abort()});await assert.rejects(c.prepare(c.release,{signal:late.signal}),e=>e.code==='aborted');assert.deepEqual(c.order,['model','runtime']);
});

test('static GridSample Lite requires explicit runtime graph marker for GPU',async()=>{
 const f=fixture('lite',{runtimeProvider:'webgpu',provider:'webgpu',external:false,liteGraphFormat:'grid-sample-static-1024'});
 const handle=await f.prepare(f.release);assert.equal(f.calls[0].options.device,'webgpu');assert.equal(f.calls[0].options.dtype,'fp32');assert.equal(f.calls[0].options.session_options.extra.session.disable_cpu_ep_fallback,'1');await handle.dispose();assert.deepEqual(f.order,['model','runtime']);
 const bad=fixture('lite',{runtimeProvider:'webgpu',external:false,liteGraphFormat:'native'});await assert.rejects(bad.prepare(bad.release),/model-load-failed/);assert.equal(bad.calls.length,0);
});

test('FP16-internal Lite keeps explicit FP32 model IO preparation',async()=>{
 const f=fixture('lite',{runtimeProvider:'webgpu',provider:'webgpu',external:false,liteGraphFormat:'grid-sample-static-1024-fp16'});const handle=await f.prepare(f.release);assert.equal(f.calls[0].options.dtype,'fp32');assert.equal(f.calls[0].options.device,'webgpu');assert.equal(f.calls[0].options.session_options.extra.session.disable_cpu_ep_fallback,'1');await handle.dispose();
});

test('preparation separates runtime configuration from library load with numeric metadata only',async()=>{
 let clock=0;const f=fixture('hr',{now:()=>clock,onConfigure:()=>{clock+=11;},onLoaded:()=>{clock+=37;}});
 const handle=await f.prepare(f.release);assert.deepEqual(handle.preparationTiming,{runtimeConfigureMs:11,modelLoadMs:37});assert.ok(Object.isFrozen(handle.preparationTiming));await handle.dispose();assert.deepEqual(f.order,['model','runtime']);
});

test('explicit HR and ViTMatte CPU owners keep model precision and pin WASM without GPU fallback',async()=>{
 for(const role of ['hr','matte']){const f=fixture(role,{runtimeProvider:'wasm',provider:'wasm'}),handle=await f.prepare(f.release);assert.equal(f.calls[0].options.device,'wasm');assert.equal(f.calls[0].options.dtype,role==='hr'?'fp16':'fp32');assert.equal(f.calls[0].options.session_options.extra.session.disable_cpu_ep_fallback,'0');await handle.dispose();assert.deepEqual(f.order,['model','runtime']);}
});
