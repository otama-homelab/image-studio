/** Candidate worker: preparation only by default; optional explicit HR/matte inference. */
import {env,PreTrainedModel,VitMatteForImageMatting,RawImage,ImageProcessor,Tensor,interpolate,VitMatteImageProcessor} from 'transformers-candidate';
import * as ort from 'ort-candidate';
import hashLibrary from 'hash-candidate';
import {Unzip} from 'fflate-candidate';
import policy from 'model-runtime-policy';
import hrResizeBytes from 'hr-resize-artifact';
import {createHrInference} from './hr-inference.mjs';
import {createPillowResizeRuntime} from './pillow-resize-runtime.mjs';
import {workerFailure} from './worker-failure.mjs';
import {createWorkerHandler} from './worker-handler.mjs';
import {createTransformersPreparation} from './transformers-prepare.mjs';
import {createOrtRuntimeBootstrap} from './ort-runtime-bootstrap.mjs';
import {createVitMatteInference} from './vitmatte-inference.mjs';
import {makeHashWasmFactory} from './hash-wasm-factory.mjs';
import {createVerifiedWorkerScript} from './verified-worker-script.mjs';
import {MAX_STAGE_WORKER_SCRIPT_BYTES,resolveStageWorker,createStagedHrPreparation} from './staged-hr-prepare.mjs';
import {createPhasedMattePreparation} from './phased-matte-prepare.mjs';
import {createPortraitInference,createLiteInference} from './birefnet-inference.mjs';
import {createModnetInference} from './modnet-inference.mjs';
import {createRvmInference} from './rvm-inference.mjs';
import {createRvmPreparation} from './rvm-prepare.mjs';
import {storeModelArchive} from './model-archive.mjs';
import {groupResourceStates} from './resource-policy.mjs';
const library={env,PreTrainedModel,VitMatteForImageMatting,RawImage,ImageProcessor,Tensor,interpolate,VitMatteImageProcessor};
const makeHasher=makeHashWasmFactory(hashLibrary.createSHA256);
let reportStage=null;
const matteInference=policy.enableMatteInference===true?createVitMatteInference({...library,processorConfig:policy.matteProcessor}):null;
const hrInference=policy.enableHrInference===true?createHrInference({...library,createBilinearResizer:()=>createPillowResizeRuntime(hrResizeBytes,{maxMemoryBytes:policy.hrResizeMaxMemoryBytes,filter:'bilinear',growthImport:'foreground_memory_grow'})}):null;
const modnetInference=policy.enableModnetInference===true?createModnetInference({...library,processorConfig:policy.modnetProcessor,createBilinearResizer:()=>createPillowResizeRuntime(hrResizeBytes,{maxMemoryBytes:policy.modnetResizeMaxMemoryBytes,filter:'bilinear',growthImport:'foreground_memory_grow'})}):null;
const rvmInference=policy.enableRvmInference===true?createRvmInference({Tensor:ort.Tensor,createBilinearResizer:()=>createPillowResizeRuntime(hrResizeBytes,{maxMemoryBytes:policy.rvmResizeMaxMemoryBytes,filter:'bilinear',growthImport:'foreground_memory_grow'})}):null;
const portraitInference=policy.enablePortraitInference===true?createPortraitInference({...library,createBilinearResizer:()=>createPillowResizeRuntime(hrResizeBytes,{maxMemoryBytes:policy.portraitResizeMaxMemoryBytes,filter:'bilinear',growthImport:'foreground_memory_grow'})}):null;
const liteInference=policy.enableLiteInference===true?createLiteInference({...library,inputSize:policy.liteInputSize,createBilinearResizer:()=>createPillowResizeRuntime(hrResizeBytes,{maxMemoryBytes:policy.liteResizeMaxMemoryBytes,filter:'bilinear',growthImport:'foreground_memory_grow'})}):null;
const handle=createWorkerHandler({
 trustedModels:policy.models,
 onRuntimeFailure(error,context){
  if(policy.scope!=='local-validation-only-not-approved-for-distribution'||policy.recordLocalInferenceErrors!==true||context.phase!=='infer')return;
  const message=error&&typeof error==='object'?Object.getOwnPropertyDescriptor(error,'message')?.value:error;
  console.error('[image-studio-local-model-infer] '+context.model+' '+(['string','number'].includes(typeof message)?String(message).slice(0,2048):'inference-exception'));
 },
 async prepare(release,hooks){
  const profile=policy.profiles[release.model];
  if(!profile||!self.caches)throw Error('runtime-policy-unavailable');
  const cache=await self.caches.open(release.cacheNamespace);
  if(release.archive)await storeModelArchive({archive:release.archive,files:release.resources,fetchImpl:self.fetch.bind(self),cache,makeHasher,Unzip,signal:hooks.signal,
   onState:states=>hooks.emit({type:'resource-state',modelVersion:release.modelVersion,resources:groupResourceStates(states)})});
  if(release.model==='hr'&&policy.stagedHr){
   const workerUrl=resolveStageWorker(policy.stagedHr,self.location.origin);
   const file=policy.stagedHr.workerFile?{...policy.stagedHr.workerFile,url:workerUrl.href}:null;
   const workerScript=file?createVerifiedWorkerScript({file,fetchImpl:self.fetch.bind(self),makeHasher,WorkerClass:Worker,maxScriptBytes:MAX_STAGE_WORKER_SCRIPT_BYTES,signal:hooks.signal}):null;
   return createStagedHrPreparation({library,stages:policy.stagedHr.stages,workerLifetime:policy.stagedHr.workerLifetime??'per-stage',maxStagesPerWorker:policy.stagedHr.maxStagesPerWorker,cancellationProtocol:policy.stagedHr.cancellationProtocol,...(workerScript?{workerScript}:{}),createWorker:()=>workerScript?workerScript.createWorker():new Worker(workerUrl),fetchImpl:self.fetch.bind(self),cache,makeHasher,onStage:event=>reportStage?.(event)})(release,hooks);
  }
  const configureRuntime=createOrtRuntimeBootstrap({ort,gpu:navigator.gpu,origin:self.location.origin,wasmOrigin:policy.wasmOrigin,runtimeAssets:policy.runtimeAssets,requiredLimits:profile.requiredLimits,executionProvider:profile.executionProvider,numThreads:profile.numThreads,liteGraphFormat:policy.liteGraphFormat,storageBufferCacheMode:profile.storageBufferCacheMode,maxNumPendingDispatches:profile.maxNumPendingDispatches,allowPortraitCpuFallback:policy.allowPortraitCpuFallback===true,freeDimensionOverrides:profile.freeDimensionOverrides});
  if(release.model==='rvm'){
   if(!rvmInference||profile.executionProvider!=='wasm')throw Error('invalid-rvm-backend');
   return createRvmPreparation({ort,env:library.env,fetchImpl:self.fetch.bind(self),cache,makeHasher,configureRuntime})(release,hooks);
  }
  if(release.model==='matte'&&policy.phasedMatte===true){
   if(!['wasm','webgpu'].includes(profile.executionProvider))throw Error('invalid-phased-matte-backend');
   return createPhasedMattePreparation({library,ort,fetchImpl:self.fetch.bind(self),cache,makeHasher,configureRuntime})(release,hooks);
  }
  return createTransformersPreparation({library,localModelPath:policy.localModelPath,fetchImpl:globalThis.fetch.bind(globalThis),cache,makeHasher,configureRuntime,
   onLoadFailure:error=>{
    // Only local candidate preparation, before infer receives any photograph pixels.
    if(policy.scope!=='local-validation-only-not-approved-for-distribution'||policy.recordLocalLoadErrors!==true)return;
    const message=error&&typeof error==='object'?Object.getOwnPropertyDescriptor(error,'message')?.value:undefined;
    console.error('[image-studio-local-model-load] '+(typeof message==='string'?message.slice(0,2048):'model-loader-exception'));
   }})(release,hooks);
 },
 infer:async(handle,request,release,{emit,signal})=>{
  const infer={hr:hrInference,matte:matteInference,modnet:modnetInference,rvm:rvmInference,portrait:portraitInference,lite:liteInference}[release.model];
  if(!infer)throw Error('inference-not-configured');
  const started=performance.now();
  if(release.model==='hr'&&policy.stagedHr)reportStage=event=>emit({type:'progress',phase:'hr',elapsedMs:performance.now()-started,completedStages:event.index+(event.phase==='complete'?1:0),totalStages:event.count,...(event.timing?{stageTiming:event.timing}:{})});
  try{return await infer(handle,request,release,{signal});}finally{reportStage=null;}
 },
 postMessage:(event,transfer)=>self.postMessage(event,transfer),
});
self.addEventListener('message',event=>{
 const command=event.data;
 if(command?.type==='infer'&&!matteInference&&!hrInference&&!modnetInference&&!portraitInference&&!liteInference&&!rvmInference){
  self.postMessage(workerFailure({workerId:command.workerId,jobId:command.jobId},'unsupported-model'));return;
 }
 void handle(command);
});
