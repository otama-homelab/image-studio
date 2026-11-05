import {liteGraphProfile} from './lite-graph-profile.mjs';
/** Worker-local owner for the pinned public ORT Web API. Never called on import. */
export function createOrtRuntimeBootstrap({ort,gpu,origin,runtimeAssets,requiredLimits,wasmOrigin=origin,storageBufferCacheMode,maxNumPendingDispatches,freeDimensionOverrides,allowPortraitCpuFallback=false,executionProvider='webgpu',liteGraphFormat,numThreads=1}){
 const invalid=()=>{throw Error('invalid-runtime-policy');};
 const liteGraph=liteGraphProfile(liteGraphFormat);if(liteGraphFormat!==undefined&&!liteGraph)invalid();
 if(![1,2].includes(numThreads)||(executionProvider!=='wasm'&&numThreads!==1))invalid();
 if(typeof allowPortraitCpuFallback!=='boolean'||!['webgpu','wasm'].includes(executionProvider))invalid();
 if(ort?.env?.versions?.web!=='1.31.1'||!ort.env.wasm||!ort.env.webgpu||(executionProvider==='webgpu'&&typeof gpu?.requestAdapter!=='function'))invalid();
 if(storageBufferCacheMode!==undefined&&!['disabled','lazyRelease','simple','bucket'].includes(storageBufferCacheMode))invalid();
 if(maxNumPendingDispatches!==undefined&&(!Number.isSafeInteger(maxNumPendingDispatches)||maxNumPendingDispatches<1||maxNumPendingDispatches>4096))invalid();
 if(freeDimensionOverrides!==undefined&&(!freeDimensionOverrides||typeof freeDimensionOverrides!=='object'||Array.isArray(freeDimensionOverrides)||!Object.keys(freeDimensionOverrides).length
  ||Object.entries(freeDimensionOverrides).some(([name,n])=>!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name)||!Number.isSafeInteger(n)||n<1||n>2048)))invalid();
 const dimensions=freeDimensionOverrides?Object.freeze({...freeDimensionOverrides}):null;
 const base=new URL(origin),wasmBase=new URL(wasmOrigin);if(base.origin!==origin||wasmBase.origin!==wasmOrigin||(base.protocol==='https:'&&wasmBase.protocol!=='https:'))invalid();
 const assets={};
 for(const name of ['wasm','mjs']){
  let url;try{url=new URL(runtimeAssets?.[name],base);}catch{invalid();}
  const hub=url.origin==='https://huggingface.co';
  const allowedPath=hub
   ?name==='wasm'&&/^\/[\w.-]+\/[\w.-]+\/resolve\/[a-f0-9]{40}\/runtime\/ort\/1\.31\.1\/[a-f0-9]{64}\/ort-wasm-simd-threaded\.asyncify\.wasm$/.test(url.pathname)
   :url.pathname.startsWith('/runtime/');
  if(url.origin!==(name==='wasm'?wasmOrigin:origin)||!allowedPath||url.search||url.hash||url.username||url.password||!url.pathname.endsWith('.'+name))invalid();
  assets[name]=url.href;
 }
 const allowed=['maxStorageBuffersPerShaderStage','maxBufferSize','maxStorageBufferBindingSize','maxComputeWorkgroupStorageSize','maxComputeInvocationsPerWorkgroup','maxComputeWorkgroupSizeX','maxComputeWorkgroupSizeY','maxComputeWorkgroupSizeZ'];
 requiredLimits??=executionProvider==='wasm'?{}:null;
 if(!requiredLimits||(executionProvider==='webgpu'&&!Object.keys(requiredLimits).length)||Object.entries(requiredLimits).some(([key,value])=>!allowed.includes(key)||!Number.isSafeInteger(value)||value<1))invalid();
 const limits=Object.freeze({...requiredLimits});let used=false;
 return async function configureRuntime(env,{onDeviceLost=()=>{},model,precision}={}){
  if(used||env?.backends?.onnx?.wasm!==ort.env.wasm||env?.backends?.onnx?.webgpu!==ort.env.webgpu||!['hr','matte','modnet','portrait','lite'].includes(model)||(model==='lite'&&executionProvider!=='wasm'&&!liteGraph)||precision!==(['hr','portrait'].includes(model)?'float16':'float32')||typeof onDeviceLost!=='function')invalid();used=true;
  // Each pinned static Lite format has a known tensor minimum. This is only a minimum,
  // not a bound on unknown shapes, workspace or total device memory.
  if(model==='lite'&&executionProvider==='webgpu'&&(limits.maxBufferSize<liteGraph.knownTensorBytes||limits.maxStorageBufferBindingSize<liteGraph.knownTensorBytes||limits.maxBufferSize===undefined||limits.maxStorageBufferBindingSize===undefined))throw Error('gpu-limits-insufficient');
  if(executionProvider==='wasm'){
   if(!['modnet','lite','hr','matte'].includes(model))invalid();
   ort.env.logLevel='fatal';ort.env.debug=false;ort.env.wasm.numThreads=numThreads===2&&globalThis.crossOriginIsolated===true&&typeof SharedArrayBuffer==='function'?2:1;ort.env.wasm.proxy=false;ort.env.wasm.wasmPaths={...assets};
   return Object.freeze({executionProvider:'wasm',sessionOptions:{executionProviders:['wasm'],...(model==='hr'?{enableCpuMemArena:false,enableMemPattern:false,graphOptimizationLevel:'disabled',executionMode:'sequential'}:{}),...(dimensions?{freeDimensionOverrides:{...dimensions}}:{}),extra:{session:{disable_cpu_ep_fallback:'0'}}},dispose:async()=>{}});
  }
  const needsF16=precision==='float16'||(model==='lite'&&liteGraph?.shaderF16===true);
  let adapter,device,closed=false;
  const dispose=async()=>{if(closed)return;closed=true;const owned=device;device=null;
   try{const descriptor=Object.getOwnPropertyDescriptor(ort.env.webgpu,'adapter');if(descriptor?.value===adapter&&descriptor.writable)ort.env.webgpu.adapter=undefined;}
   finally{if(owned)await owned.destroy();}
  };
  try{
   adapter=await gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw Error('webgpu-unavailable');
   if(needsF16&&!adapter.features.has('shader-f16'))throw Error('shader-f16-unavailable');
   if(Object.entries(limits).some(([key,value])=>!Number.isFinite(adapter.limits[key])||adapter.limits[key]<value))throw Error('gpu-limits-insufficient');
   // Match ORT's optional subgroup capability without requiring it on unsupported devices.
   const requiredFeatures=needsF16?['shader-f16']:[];
   if(model!=='matte'&&adapter.features.has('subgroups'))requiredFeatures.push('subgroups');
   device=await adapter.requestDevice({requiredLimits:{...limits},requiredFeatures});
   const owned=device;
   const notifyLost=()=>{if(!closed)try{onDeviceLost({code:'device-lost'});}catch{}};
   void owned.lost.then(notifyLost,notifyLost);
   ort.env.logLevel='fatal';ort.env.debug=false;ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;ort.env.wasm.wasmPaths={...assets};ort.env.webgpu.adapter=adapter;ort.env.webgpu.profiling={mode:'off'};
   // MODNet: omitting layout produced incorrect raw alpha on the pinned native
   // runtime/NVIDIA; explicit NCHW matches CPU (2026-11-02 stage-parity evidence).
   return Object.freeze({executionProvider:'webgpu',...(model==='lite'?{liteGraphFormat}:{}),sessionOptions:{executionProviders:[{name:'webgpu',device:owned,...(['matte','modnet','portrait','lite'].includes(model)?{preferredLayout:'NCHW'}:{}),...(storageBufferCacheMode?{storageBufferCacheMode}:{})}],...(dimensions?{freeDimensionOverrides:{...dimensions}}:{}),extra:{session:{disable_cpu_ep_fallback:model==='matte'||(model==='portrait'&&allowPortraitCpuFallback)?'0':'1'},...(maxNumPendingDispatches===undefined?{}:{ep:{webgpuexecutionprovider:{maxNumPendingDispatches:String(maxNumPendingDispatches)}}})}},dispose});
  }catch(error){await dispose();throw Error(['webgpu-unavailable','shader-f16-unavailable','gpu-limits-insufficient'].includes(error?.message)?error.message:'runtime-create-failed');}
 };
}
