import {liteGraphProfile} from './lite-graph-profile.mjs';
import {createResourcePolicy,ResourcePolicyError} from './resource-policy.mjs';
import {prepareStoredModel} from './prepared-model.mjs';

/** Bind existing Transformers.js APIs to the fixed resource policy and runtime owner. */
export function createTransformersPreparation({library,localModelPath,fetchImpl,cache,makeHasher,configureRuntime,onLoadFailure=()=>{},now=()=>performance.now()}){
 const base=new URL(localModelPath);
 if(base.href!==localModelPath||!localModelPath.endsWith('/')||base.search||base.hash||base.username||base.password
  ||typeof configureRuntime!=='function')throw new ResourcePolicyError('invalid-preparation-policy');
 return async function prepare(release,{emit=()=>{},onDeviceLost=()=>{},signal}={}){
  const role=release.model;
  if(!['hr','matte','modnet','portrait','lite'].includes(role))throw new ResourcePolicyError('invalid-preparation-policy');
  const external=release.resources.length===3;
  const paths=['config.json','onnx/'+(['hr','portrait'].includes(role)?'model_fp16.onnx':'model.onnx'),...(external?['onnx/model.onnx.data']:[])];
  if(release.resources.length!==paths.length||!paths.every(path=>release.resources.some(f=>f.url===localModelPath+role+'/'+path)))throw new ResourcePolicyError('invalid-preparation-policy');
  let policy;
  policy=createResourcePolicy({files:release.resources,fetchImpl,cache,makeHasher,signal,onEvent:()=>emit({type:'resource-state',modelVersion:release.modelVersion,resources:policy.getState()})});
  const env=library.env;
  env.logLevel=50;env.allowRemoteModels=false;env.allowLocalModels=true;env.localModelPath=localModelPath;
  env.useWasmCache=false;env.useFS=false;env.useFSCache=false;env.useBrowserCache=false;env.useCustomCache=true;
  env.experimental_useCrossOriginStorage=false;env.fetch=policy.fetch;env.customCache=policy.cache;
  // Runtime bootstrap must pin WASM/MJS URLs and own its device; this factory does not fetch runtime assets.
  if(signal?.aborted)throw new ResourcePolicyError('aborted');
  const runtimeStarted=now();
  const runtime=await configureRuntime(env,{onDeviceLost,model:role,precision:['hr','portrait'].includes(role)?'float16':'float32'});
  const runtimeConfigureMs=now()-runtimeStarted;
  if(!runtime||typeof runtime.dispose!=='function')throw new ResourcePolicyError('invalid-runtime-owner');
  if(signal?.aborted){await runtime.dispose();throw new ResourcePolicyError('aborted');}
  const Class=role==='matte'?library.VitMatteForImageMatting:library.PreTrainedModel;
  return prepareStoredModel({policy,signal,requiredFiles:release.resources,load:async()=>{
   const loadStarted=now();let model;
   try{
    const supplied=runtime.sessionOptions??{},provider=runtime.executionProvider??'webgpu';
    if(!['webgpu','wasm'].includes(provider)||(provider==='wasm'&&!['modnet','lite','hr','matte'].includes(role))||(role==='lite'&&provider!=='wasm'&&!liteGraphProfile(runtime.liteGraphFormat)))throw Error('invalid-runtime-provider');
    if(supplied.executionProviders!==undefined&&(!Array.isArray(supplied.executionProviders)||supplied.executionProviders.length!==1
     ||(typeof supplied.executionProviders[0]==='string'?supplied.executionProviders[0]:supplied.executionProviders[0]?.name)!==provider))throw Error('invalid-runtime-provider');
    model=await Class.from_pretrained(role,{device:provider,dtype:['hr','portrait'].includes(role)?'fp16':'fp32',model_file_name:'model',subfolder:'onnx',local_files_only:true,use_external_data_format:false,
     session_options:{...supplied,externalData:external?[{path:'model.onnx.data',data:'onnx/model.onnx.data'}]:[],
      extra:{...supplied.extra,session:{...supplied.extra?.session,disable_cpu_ep_fallback:provider==='wasm'||role==='matte'||(role==='portrait'&&supplied.extra?.session?.disable_cpu_ep_fallback==='0')?'0':'1'}}}});
    if(!model||typeof model.dispose!=='function')throw Error('invalid-model-handle');
   }catch(error){try{onLoadFailure(error);}catch{}await runtime.dispose();throw new ResourcePolicyError('model-load-failed');}
   let disposal;
   return {model,preparationTiming:Object.freeze({runtimeConfigureMs,modelLoadMs:now()-loadStarted}),resourceTiming:policy.getTiming(),dispose(){return disposal??=(async()=>{try{await model.dispose();}finally{await runtime.dispose();}})();}};
  }});
 };
}
