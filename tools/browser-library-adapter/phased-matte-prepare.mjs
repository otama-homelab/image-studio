import {createResourcePolicy,ResourcePolicyError} from './resource-policy.mjs';
import {prepareStoredModel} from './prepared-model.mjs';
const names=['phase-0.onnx','model.onnx.data','phase-1.onnx','phase-2.onnx'];
const outputs=['add_13650','relu_5','alphas'];
const invalid=()=>{throw new ResourcePolicyError('invalid-preparation-policy');};
const aborted=()=>{throw new DOMException('aborted','AbortError');};
/** Verified ViTMatte resources and three sequential official ORT sessions. */
export function createPhasedMattePreparation({library,ort,fetchImpl,cache,makeHasher,configureRuntime}){
 if(typeof library?.Tensor!=='function'||typeof ort?.Tensor!=='function'||typeof ort?.InferenceSession?.create!=='function'||typeof configureRuntime!=='function')invalid();
 return async function prepare(release,{emit=()=>{},signal,onDeviceLost=()=>{}}={}){
  if(release?.model!=='matte'||!Array.isArray(release.resources)||release.resources.length!==4)invalid();
  const files=release.resources.map(f=>Object.freeze({...f})),byName=new Map(files.map(f=>[f.name,f]));
  if(byName.size!==4||!names.every(name=>byName.has(name)))invalid();
  let policy,runtime,device,active=null,closing=null,disposed=false,failed=false,releaseFailed=false;
  const makePolicy=(signal,onEvent)=>createResourcePolicy({files,fetchImpl,cache,makeHasher,signal,onEvent});
  policy=makePolicy(signal,()=>emit({type:'resource-state',modelVersion:release.modelVersion,resources:policy.getState()}));
  const handle={
   model:inputs=>handle.runStaged(inputs),
   async runStaged({pixel_values}={},options={}){
    if(disposed||failed)throw Error('matte-phase-unavailable');
    if(active)throw Error('matte-phase-busy');
    if(options.signal?.aborted)aborted();
    const dims=pixel_values?.dims,h=dims?.[2],w=dims?.[3],pixels=pixel_values?.data;
    if(pixel_values?.type!=='float32'||!Array.isArray(dims)||dims.length!==4||dims[0]!==1||dims[1]!==4
     ||![h,w].every(n=>Number.isSafeInteger(n)&&n>=32&&n<=2016&&n%32===0)||!(pixels instanceof Float32Array)||pixels.byteLength!==16*h*w)throw Error('invalid-matte-phase-input');
    const controller=new AbortController(),abort=()=>controller.abort();options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
    const job={controller,promise:null};active=job;
    job.promise=(async()=>{
     const resources=makePolicy(controller.signal),live=new Set();let feature=null;
     async function releaseTensors(keep){
      for(const tensor of [...live].reverse())if(tensor!==keep){try{await tensor.dispose();}catch{releaseFailed=true;}finally{live.delete(tensor);}}
      if(releaseFailed)throw Error('matte-phase-release-failed');
     }
     async function read(name){
      if(controller.signal.aborted)aborted();
      const file=byName.get(name);let response=await resources.cache.match(file.url);
      if(!response){await resources.cache.put(file.url,await resources.fetch(file.url));response=await resources.cache.match(file.url);}
      if(!response)throw new ResourcePolicyError('model-resources-not-stored');
      return new Uint8Array(await response.arrayBuffer());
     }
     try{
      for(let phase=0;phase<3;phase++){
       if(controller.signal.aborted)aborted();
       let session;
       try{
        const graph=await read(`phase-${phase}.onnx`),sessionOptions={...runtime.sessionOptions};
        if(phase===0)sessionOptions.externalData=[{path:'model.onnx.data',data:await read('model.onnx.data')}];
        session=await ort.InferenceSession.create(graph,sessionOptions);sessionOptions.externalData=null;
        if(controller.signal.aborted)aborted();
        const pixelTensor=new ort.Tensor('float32',pixels,[...dims]);live.add(pixelTensor);
        const feeds={pixel_values:pixelTensor};if(feature)feeds[phase===1?'add_13650':'relu_5']=feature;
        const result=await session.run(feeds);
        for(const value of Object.values(result??{}))if(typeof value?.dispose==='function')live.add(value);
        const next=result?.[outputs[phase]],expected=phase===0?[1,768,h/16,w/16]:phase===1?[1,64,h/2,w/2]:[1,1,h,w];
        if(Object.keys(result??{}).length!==1||next?.type!=='float32'||JSON.stringify(next.dims)!==JSON.stringify(expected)
         ||device&&typeof next.getData!=='function')throw Error('invalid-matte-phase-output');
        const data=device?await next.getData():next.data;
        if(!(data instanceof Float32Array)||data.byteLength!==expected.reduce((a,b)=>a*b,4)||!data.every(Number.isFinite))throw Error('invalid-matte-phase-output');
        const boundary=device?new ort.Tensor('float32',new Float32Array(data),[...next.dims]):next;
        if(device)live.add(boundary);
        await releaseTensors(boundary);feature=boundary;
       }finally{
        if(session)try{await session.release();}catch{releaseFailed=true;}
        if(device)try{await device.queue.onSubmittedWorkDone();}catch{releaseFailed=true;}
       }
       if(releaseFailed)throw Error('matte-phase-release-failed');
      }
      if(controller.signal.aborted)aborted();
      const data=device?new Float32Array(feature.data):feature.data,shape=[...feature.dims];await releaseTensors();if(controller.signal.aborted)aborted();
      return {alphas:new library.Tensor('float32',data,shape)};
     }catch(error){failed=true;throw error;}
     finally{
      try{await releaseTensors();}finally{options.signal?.removeEventListener('abort',abort);if(active===job)active=null;}
     }
    })();
    return job.promise;
   },
   dispose(){
    if(closing)return closing;disposed=true;
    closing=(async()=>{
     const job=active;job?.controller.abort();try{await job?.promise;}catch{}
     try{await runtime?.dispose();}catch{releaseFailed=true;}
     if(releaseFailed)throw Error('matte-phase-release-failed');
    })();return closing;
   },
  };
  try{return await prepareStoredModel({policy,requiredFiles:files,signal,load:async()=>{
   for(const file of files){
    const response=await policy.cache.match(file.url);
    if(response){const reader=response.body.getReader();try{while(!(await reader.read()).done){}}finally{reader.releaseLock();}}
    else await policy.cache.put(file.url,await policy.fetch(file.url));
   }
   runtime=await configureRuntime(library.env,{model:'matte',precision:'float32',onDeviceLost:event=>{failed=true;active?.controller.abort();onDeviceLost?.(event);}});
   const providers=runtime?.sessionOptions?.executionProviders;
   if(!['wasm','webgpu'].includes(runtime?.executionProvider)||!Array.isArray(providers)||providers.length!==1)invalid();
   if(runtime.executionProvider==='wasm'){if(providers[0]!=='wasm')invalid();}
   else{
    const provider=providers[0],extra=runtime.sessionOptions.extra;
    device=provider?.device;
    if(provider?.name!=='webgpu'||provider.preferredLayout!=='NCHW'||provider.storageBufferCacheMode!=='disabled'
     ||typeof device?.queue?.onSubmittedWorkDone!=='function'||typeof device?.destroy!=='function'||typeof device?.features?.has!=='function'||device.features.has('subgroups')
     ||extra?.session?.disable_cpu_ep_fallback!=='0'||extra?.ep?.webgpuexecutionprovider?.maxNumPendingDispatches!=='1')invalid();
   }
   return handle;
  }});}catch(error){await handle.dispose();throw error;}
 };
}
