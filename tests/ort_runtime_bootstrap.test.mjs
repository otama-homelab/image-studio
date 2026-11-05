import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOrtRuntimeBootstrap} from '../tools/browser-library-adapter/ort-runtime-bootstrap.mjs';
function fixture({f16=true,limit=1024,adapterMissing=false,requestFails=false,subgroups=false,required=1024}={}){
 let lose,destroyed=0,requests=0,devices=0,requestedFeatures;const lost=new Promise(resolve=>{lose=resolve;}),device={lost,destroy(){destroyed++;lose({reason:'destroyed',message:'private'});}},adapter={features:new Set([...(f16?['shader-f16']:[]),...(subgroups?['subgroups']:[])]),limits:{maxBufferSize:limit},async requestDevice(options){devices++;requestedFeatures=[...options.requiredFeatures];assert.deepEqual(options.requiredLimits,{maxBufferSize:required,...(required===503316480?{maxStorageBufferBindingSize:required}:{})});if(requestFails)throw Error('private');return device;}};
 const ort={env:{versions:{web:'1.31.1'},wasm:{},webgpu:{}}},policy={ort,gpu:{async requestAdapter(){requests++;return adapterMissing?null:adapter;}},origin:'https://app.invalid',runtimeAssets:{wasm:'https://app.invalid/runtime/fixed.wasm',mjs:'https://app.invalid/runtime/fixed.mjs'},requiredLimits:{maxBufferSize:required,...(required===503316480?{maxStorageBufferBindingSize:required}:{})}};
 return {ort,policy,device,lose,stats:()=>({destroyed,requests,devices}),requestedFeatures:()=>requestedFeatures,env:{backends:{onnx:{...ort.env}}}};
}
test('policy refuses runtime/URL/limit substitution before GPU calls',()=>{
 for(const alter of [p=>{p.ort.env.versions.web='other';},p=>{p.runtimeAssets.wasm='https://outside.invalid/runtime/a.wasm';},p=>{p.runtimeAssets.mjs='https://app.invalid/runtime/a.mjs?token=secret';},p=>{p.requiredLimits={arbitrary:1};}]){const f=fixture();alter(f.policy);assert.throws(()=>createOrtRuntimeBootstrap(f.policy));assert.equal(f.stats().requests,0);}
});
test('pins one-thread assets, explicitly owns device and disposes exactly once',async()=>{
 const f=fixture(),configure=createOrtRuntimeBootstrap(f.policy),notices=[],runtime=await configure(f.env,{model:'hr',precision:'float16',onDeviceLost:event=>notices.push(event)});
 assert.equal(f.ort.env.wasm.numThreads,1);assert.equal(f.ort.env.wasm.proxy,false);assert.deepEqual(f.ort.env.wasm.wasmPaths,f.policy.runtimeAssets);assert.equal(runtime.sessionOptions.executionProviders[0].device,f.device);assert.equal(runtime.sessionOptions.extra.session.disable_cpu_ep_fallback,'1');await runtime.dispose();await runtime.dispose();await Promise.resolve();assert.equal(f.stats().destroyed,1);assert.deepEqual(notices,[]);await assert.rejects(configure(f.env,{model:'hr',precision:'float16'}));assert.equal(f.stats().requests,1);
});
test('official buffer cache mode is explicit and readonly adapter metadata does not prevent disposal',async()=>{
 const f=fixture();f.policy.storageBufferCacheMode='disabled';
 const runtime=await createOrtRuntimeBootstrap(f.policy)(f.env,{model:'hr',precision:'float16'});
 assert.equal(runtime.sessionOptions.executionProviders[0].storageBufferCacheMode,'disabled');
 Object.defineProperty(f.ort.env.webgpu,'adapter',{value:f.ort.env.webgpu.adapter,writable:false,configurable:false});
 await runtime.dispose();await runtime.dispose();assert.equal(f.stats().destroyed,1);
 const bad=fixture();bad.policy.storageBufferCacheMode='invented';assert.throws(()=>createOrtRuntimeBootstrap(bad.policy));assert.equal(bad.stats().requests,0);
});
test('matte does not require shader-f16; explicit runtime still uses GPU',async()=>{
 const f=fixture({f16:false}),runtime=await createOrtRuntimeBootstrap(f.policy)(f.env,{model:'matte',precision:'float32'});assert.equal(runtime.executionProvider,'webgpu');assert.equal(runtime.sessionOptions.executionProviders[0].name,'webgpu');assert.equal(runtime.sessionOptions.executionProviders[0].preferredLayout,'NCHW');await runtime.dispose();
});
for(const [options,message] of [[{adapterMissing:true},'webgpu-unavailable'],[{f16:false},'shader-f16-unavailable'],[{limit:512},'gpu-limits-insufficient'],[{requestFails:true},'runtime-create-failed']])test('failed setup returns fixed error and cannot retry inside same owner: '+message,async()=>{
 const f=fixture(options),configure=createOrtRuntimeBootstrap(f.policy);await assert.rejects(configure(f.env,{model:'hr',precision:'float16'}),error=>error.message===message);await assert.rejects(configure(f.env,{model:'hr',precision:'float16'}));assert.equal(f.stats().requests,1);
});
test('unexpected loss sends fixed code and masks device details',async()=>{
 const f=fixture(),events=[],runtime=await createOrtRuntimeBootstrap(f.policy)(f.env,{model:'hr',precision:'float16',onDeviceLost:e=>events.push(e)});f.lose({reason:'unknown',message:'private GPU details'});await Promise.resolve();assert.deepEqual(events,[{code:'device-lost'}]);await runtime.dispose();
});
test('different backend object or precision rejects before any adapter request',async()=>{
 const f=fixture(),configure=createOrtRuntimeBootstrap(f.policy);await assert.rejects(configure({backends:{onnx:{}}},{model:'hr',precision:'float16'}));await assert.rejects(configure(f.env,{model:'hr',precision:'float32'}));assert.equal(f.stats().requests,0);
});

test('only explicitly pinned WASM origin may differ; MJS stays on app origin',async()=>{
 const f=fixture();f.policy.wasmOrigin='https://assets.invalid';f.policy.runtimeAssets.wasm='https://assets.invalid/runtime/ort/1.31.1/fixed.wasm';const runtime=await createOrtRuntimeBootstrap(f.policy)(f.env,{model:'hr',precision:'float16'});assert.equal(f.ort.env.wasm.wasmPaths.wasm,f.policy.runtimeAssets.wasm);await runtime.dispose();
 const bad=fixture();bad.policy.wasmOrigin='https://assets.invalid';bad.policy.runtimeAssets.mjs='https://assets.invalid/runtime/fixed.mjs';assert.throws(()=>createOrtRuntimeBootstrap(bad.policy));assert.equal(bad.stats().requests,0);
});

for(const subgroups of [true,false])test('owned device requests optional subgroups only when supported: '+subgroups,async()=>{
 const f=fixture({subgroups}),runtime=await createOrtRuntimeBootstrap(f.policy)(f.env,{model:'hr',precision:'float16'});
 assert.deepEqual(f.requestedFeatures(),subgroups?['shader-f16','subgroups']:['shader-f16']);
 await runtime.dispose();assert.equal(f.stats().destroyed,1);
 const matte=fixture({subgroups,f16:false}),other=await createOrtRuntimeBootstrap(matte.policy)(matte.env,{model:'matte',precision:'float32'});
 assert.deepEqual(matte.requestedFeatures(),[]);assert.equal(other.executionProvider,'webgpu');assert.equal(other.sessionOptions.extra.session.disable_cpu_ep_fallback,'0');await other.dispose();
});

test('official pending-dispatch window uses session extra and validates before GPU work',async()=>{
 const f=fixture();f.policy.maxNumPendingDispatches=1;
 const runtime=await createOrtRuntimeBootstrap(f.policy)(f.env,{model:'hr',precision:'float16'});
 assert.deepEqual(runtime.sessionOptions.extra,{session:{disable_cpu_ep_fallback:'1'},ep:{webgpuexecutionprovider:{maxNumPendingDispatches:'1'}}});
 await runtime.dispose();
 for(const value of [0,4097,1.5,'1',NaN]){const bad=fixture();bad.policy.maxNumPendingDispatches=value;assert.throws(()=>createOrtRuntimeBootstrap(bad.policy));assert.equal(bad.stats().requests,0);}
});

test('MODNet pins CPU-parity NCHW layout and keeps FP32 GPU-only admission without shader-f16',async()=>{
 const f=fixture({f16:false}),runtime=await createOrtRuntimeBootstrap(f.policy)(f.env,{model:'modnet',precision:'float32'});assert.equal(runtime.sessionOptions.executionProviders[0].name,'webgpu');assert.equal(runtime.sessionOptions.executionProviders[0].preferredLayout,'NCHW');assert.equal(runtime.sessionOptions.extra.session.disable_cpu_ep_fallback,'1');await runtime.dispose();assert.equal(f.stats().destroyed,1);
});

test('official free dimension override is copied from the trusted profile and rejects invalid sizes',async()=>{
 const f=fixture(),dimensions={batch_size:1,height:672,width:512};f.policy.freeDimensionOverrides=dimensions;const configure=createOrtRuntimeBootstrap(f.policy);dimensions.height=32;const runtime=await configure(f.env,{model:'modnet',precision:'float32'});assert.deepEqual(runtime.sessionOptions.freeDimensionOverrides,{batch_size:1,height:672,width:512});await runtime.dispose();
 for(const bad of [{height:0},{width:Infinity},{height:2049},[],{'private/name':1}]){const f=fixture();f.policy.freeDimensionOverrides=bad;assert.throws(()=>createOrtRuntimeBootstrap(f.policy));assert.equal(f.stats().requests,0);}
});

test('portrait FP16 weights require shader-f16 and explicit NCHW while retaining strict GPU admission',async()=>{
 const f=fixture(),runtime=await createOrtRuntimeBootstrap(f.policy)(f.env,{model:'portrait',precision:'float16'});assert.equal(runtime.sessionOptions.executionProviders[0].preferredLayout,'NCHW');assert.equal(runtime.sessionOptions.extra.session.disable_cpu_ep_fallback,'1');await runtime.dispose();
 const missing=fixture({f16:false});await assert.rejects(createOrtRuntimeBootstrap(missing.policy)(missing.env,{model:'portrait',precision:'float16'}),/shader-f16-unavailable/);
});

test('portrait CPU fallback requires an explicit trusted flag and cannot loosen HR GPU admission',async()=>{
 for(const model of ['portrait','hr']){const f=fixture();f.policy.allowPortraitCpuFallback=true;const runtime=await createOrtRuntimeBootstrap(f.policy)(f.env,{model,precision:'float16'});assert.equal(runtime.sessionOptions.extra.session.disable_cpu_ep_fallback,model==='portrait'?'0':'1');await runtime.dispose();}
 const f=fixture();f.policy.allowPortraitCpuFallback='true';assert.throws(()=>createOrtRuntimeBootstrap(f.policy));assert.equal(f.stats().requests,0);
});

test('shader storage-buffer count is requested explicitly and unsupported adapters reject before device creation',async()=>{
 for(const available of [8,9]){const f=fixture();let deviceRequests=0;f.policy.requiredLimits={maxStorageBuffersPerShaderStage:9};f.policy.gpu.requestAdapter=async()=>({features:new Set(['shader-f16']),limits:{maxStorageBuffersPerShaderStage:available},async requestDevice(options){deviceRequests++;assert.deepEqual(options.requiredLimits,{maxStorageBuffersPerShaderStage:9});return f.device;}});const configure=createOrtRuntimeBootstrap(f.policy);
 if(available===8){await assert.rejects(configure(f.env,{model:'portrait',precision:'float16'}),/gpu-limits-insufficient/);assert.equal(deviceRequests,0);}else{const runtime=await configure(f.env,{model:'portrait',precision:'float16'});await runtime.dispose();assert.equal(deviceRequests,1);}}
});


test('explicit MODNet WASM mode needs no GPU API and pins one CPU thread',async()=>{
 const f=fixture();f.policy.executionProvider='wasm';delete f.policy.gpu;delete f.policy.requiredLimits;const runtime=await createOrtRuntimeBootstrap(f.policy)(f.env,{model:'modnet',precision:'float32'});assert.equal(runtime.executionProvider,'wasm');assert.deepEqual(runtime.sessionOptions.executionProviders,['wasm']);assert.equal(f.ort.env.wasm.numThreads,1);assert.equal(f.ort.env.wasm.proxy,false);assert.deepEqual(f.ort.env.webgpu,{});assert.equal(f.stats().requests,0);await runtime.dispose();await runtime.dispose();
 for(const model of ['hr','matte']){const f=fixture();f.policy.executionProvider='wasm';delete f.policy.gpu;const runtime=await createOrtRuntimeBootstrap(f.policy)(f.env,{model,precision:model==='hr'?'float16':'float32'});assert.equal(runtime.executionProvider,'wasm');assert.deepEqual(runtime.sessionOptions.executionProviders,['wasm']);assert.equal(f.stats().requests,0);await runtime.dispose();}
});


test('native DeformConv lite is explicitly FP32 WASM-only and never requests a GPU',async()=>{
 const f=fixture();f.policy.executionProvider='wasm';delete f.policy.gpu;delete f.policy.requiredLimits;
 const runtime=await createOrtRuntimeBootstrap(f.policy)(f.env,{model:'lite',precision:'float32'});
 assert.equal(runtime.executionProvider,'wasm');assert.deepEqual(runtime.sessionOptions.executionProviders,['wasm']);assert.equal(f.ort.env.wasm.numThreads,1);assert.equal(f.stats().requests,0);await runtime.dispose();
 const gpu=fixture();await assert.rejects(createOrtRuntimeBootstrap(gpu.policy)(gpu.env,{model:'lite',precision:'float32'}),/invalid-runtime-policy/);assert.equal(gpu.stats().requests,0);
 const fp16=fixture();fp16.policy.executionProvider='wasm';await assert.rejects(createOrtRuntimeBootstrap(fp16.policy)(fp16.env,{model:'lite',precision:'float16'}),/invalid-runtime-policy/);
});

test('static GridSample Lite explicitly uses FP32 GPU NCHW with no CPU fallback',async()=>{
 const f=fixture({f16:false,required:503316480,limit:503316480});let requested;f.policy.gpu.requestAdapter=async()=>({features:new Set(),limits:{maxBufferSize:503316480,maxStorageBufferBindingSize:503316480},requestDevice:async options=>{requested=options;return f.device;}});f.policy.liteGraphFormat='grid-sample-static-1024';
 const runtime=await createOrtRuntimeBootstrap(f.policy)(f.env,{model:'lite',precision:'float32'});
 assert.equal(runtime.liteGraphFormat,'grid-sample-static-1024');assert.deepEqual(requested.requiredFeatures,[]);assert.deepEqual(requested.requiredLimits,{maxBufferSize:503316480,maxStorageBufferBindingSize:503316480});
 assert.equal(runtime.sessionOptions.executionProviders[0].preferredLayout,'NCHW');
 assert.equal(runtime.sessionOptions.extra.session.disable_cpu_ep_fallback,'1');
 await runtime.dispose();assert.equal(f.stats().destroyed,1);
 for(const value of [true,'native','grid-sample-static-512']){const bad=fixture();bad.policy.liteGraphFormat=value;assert.throws(()=>createOrtRuntimeBootstrap(bad.policy),/invalid-runtime-policy/);assert.equal(bad.stats().requests,0);}
});

test('static Lite insufficient declared tensor limits reject before any GPU request',async()=>{
 for(const limits of [{maxBufferSize:268435456,maxStorageBufferBindingSize:134217728},{maxBufferSize:503316480,maxStorageBufferBindingSize:503316479},{maxBufferSize:503316480}]){
  const f=fixture();f.policy.liteGraphFormat='grid-sample-static-1024';f.policy.requiredLimits=limits;
  await assert.rejects(createOrtRuntimeBootstrap(f.policy)(f.env,{model:'lite',precision:'float32'}),/gpu-limits-insufficient/);assert.equal(f.stats().requests,0);assert.equal(f.stats().devices,0);
 }
});

test('internal FP16 Lite requires shader-f16 despite FP32 external IO',async()=>{
 const f=fixture();f.policy.liteGraphFormat='grid-sample-static-1024-fp16';f.policy.requiredLimits={maxBufferSize:251658240,maxStorageBufferBindingSize:251658240};let options;
 f.policy.gpu.requestAdapter=async()=>({features:new Set(['shader-f16']),limits:{maxBufferSize:251658240,maxStorageBufferBindingSize:251658240},requestDevice:async value=>{options=value;return f.device;}});
 const runtime=await createOrtRuntimeBootstrap(f.policy)(f.env,{model:'lite',precision:'float32'});assert.deepEqual(options.requiredFeatures,['shader-f16']);assert.equal(runtime.liteGraphFormat,'grid-sample-static-1024-fp16');assert.equal(runtime.sessionOptions.extra.session.disable_cpu_ep_fallback,'1');await runtime.dispose();assert.equal(f.stats().destroyed,1);
 const bad=fixture({f16:false,limit:503316480});bad.policy.liteGraphFormat='grid-sample-static-1024-fp16';bad.policy.requiredLimits={maxBufferSize:251658240};bad.policy.gpu.requestAdapter=async()=>({features:new Set(),limits:{maxBufferSize:503316480,maxStorageBufferBindingSize:503316480},requestDevice:async()=>{throw Error('must not create');}});
 bad.policy.requiredLimits.maxStorageBufferBindingSize=251658240;await assert.rejects(createOrtRuntimeBootstrap(bad.policy)(bad.env,{model:'lite',precision:'float32'}),/shader-f16-unavailable/);assert.equal(bad.stats().devices,0);
});

test('HR CPU uses sequential execution without retained arena or memory patterns',async()=>{
 const f=fixture();f.policy.executionProvider='wasm';const r=await createOrtRuntimeBootstrap(f.policy)(f.env,{model:'hr',precision:'float16'});assert.equal(r.sessionOptions.enableCpuMemArena,false);assert.equal(r.sessionOptions.enableMemPattern,false);assert.equal(r.sessionOptions.graphOptimizationLevel,'disabled');assert.equal(r.sessionOptions.executionMode,'sequential');await r.dispose();
});


test('two CPU threads require an explicit request and cross-origin isolation, with a one-thread fallback',async()=>{
 const saved=Object.getOwnPropertyDescriptor(globalThis,'crossOriginIsolated');
 try{
  for(const isolated of [false,true]){
   Object.defineProperty(globalThis,'crossOriginIsolated',{configurable:true,value:isolated});
   const f=fixture();f.policy.executionProvider='wasm';f.policy.numThreads=2;delete f.policy.gpu;
   const r=await createOrtRuntimeBootstrap(f.policy)(f.env,{model:'hr',precision:'float16'});
   assert.equal(f.ort.env.wasm.numThreads,isolated?2:1);assert.equal(f.stats().requests,0);await r.dispose();
  }
  for(const numThreads of [0,3,'2',NaN]){const f=fixture();f.policy.executionProvider='wasm';f.policy.numThreads=numThreads;assert.throws(()=>createOrtRuntimeBootstrap(f.policy),/invalid-runtime-policy/);}
  const gpu=fixture();gpu.policy.numThreads=2;assert.throws(()=>createOrtRuntimeBootstrap(gpu.policy),/invalid-runtime-policy/);assert.equal(gpu.stats().requests,0);
 }finally{if(saved)Object.defineProperty(globalThis,'crossOriginIsolated',saved);else delete globalThis.crossOriginIsolated;}
});


test('runtime paths work unchanged on preview and production while Hub WASM stays commit-pinned',async()=>{
 const wasm='https://huggingface.co/otama/image-studio-browser-models/resolve/'+ 'a'.repeat(40)+'/runtime/ort/1.31.1/'+ 'b'.repeat(64)+'/ort-wasm-simd-threaded.asyncify.wasm';
 for(const origin of ['https://image-studio.otama-playground.com','https://preview.image-studio.pages.dev']){
  const f=fixture();f.policy.origin=origin;f.policy.wasmOrigin='https://huggingface.co';f.policy.runtimeAssets={mjs:'/runtime/ort/1.31.1/fixed.mjs',wasm};
  const runtime=await createOrtRuntimeBootstrap(f.policy)(f.env,{model:'hr',precision:'float16'});
  assert.deepEqual(f.ort.env.wasm.wasmPaths,{mjs:origin+f.policy.runtimeAssets.mjs,wasm});await runtime.dispose();
 }
 for(const url of [wasm.replace('a'.repeat(40),'main'),wasm.replace('a'.repeat(40),'v1.0.0'),wasm.replace('a'.repeat(40),'a'.repeat(39)),wasm.replace('/resolve/','/blob/'),wasm.replace('/runtime/','/unreviewed/'),wasm.replace('/1.31.1/','/other/'),wasm+'?download=true',wasm+'#x',wasm.replace('https://','https://user:secret@'),wasm.replace('huggingface.co','outside.invalid'),'https://huggingface.co/runtime/fixed.wasm']){
  const f=fixture();f.policy.wasmOrigin='https://huggingface.co';f.policy.runtimeAssets.wasm=url;
  assert.throws(()=>createOrtRuntimeBootstrap(f.policy),/invalid-runtime-policy/);assert.equal(f.stats().requests,0);
 }
 const bad=fixture();bad.policy.wasmOrigin='https://huggingface.co';bad.policy.runtimeAssets={wasm,mjs:wasm.replace('.wasm','.mjs')};assert.throws(()=>createOrtRuntimeBootstrap(bad.policy));
});
