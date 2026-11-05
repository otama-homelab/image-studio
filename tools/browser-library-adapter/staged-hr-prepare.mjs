import {MAX_HR_STAGES} from './stage-tensors.mjs';
import {createResourcePolicy,ResourcePolicyError,groupResourceStates} from './resource-policy.mjs';
import {prepareStoredModel} from './prepared-model.mjs';
import {createStagedHr} from './staged-hr.mjs';
// CPU stage catalogues embed over 1000 immutable resource URLs.
export const MAX_STAGE_WORKER_SCRIPT_BYTES=2*1024*1024;
const fail=()=>{throw new ResourcePolicyError('invalid-preparation-policy');};
/** Public stage scripts bind the immutable path to their verified content descriptor. */
export function resolveStageWorker({worker,workerFile},origin){
 const url=new URL(worker,origin);
 const publicPath=url.pathname.match(/^\/assets\/([a-f0-9]{64})\/stage-worker\.js$/);
 if(url.origin!==origin||url.username||url.password||url.search||url.hash
  ||(!publicPath&&!/^\/validation-workers\/[a-f0-9]{64}\/stage-worker\.js$/.test(url.pathname)))throw Error('invalid-stage-worker');
 if(workerFile&&(new URL(workerFile.url,origin).href!==url.href||!Number.isSafeInteger(workerFile.bytes)||workerFile.bytes<1||workerFile.bytes>MAX_STAGE_WORKER_SCRIPT_BYTES||!/^[a-f0-9]{64}$/.test(workerFile.sha256)))throw Error('invalid-stage-worker');
 if(publicPath&&(!workerFile||workerFile.sha256!==publicPath[1]))throw Error('invalid-stage-worker');
 return url;
}
/** Retain the existing HR processor/postprocessor; only replace its callable model. */
export function createStagedHrPreparation({library,stages,createWorker,fetchImpl,cache,makeHasher,workerScript,onStage=()=>{},cancellationProtocol,workerLifetime='per-stage',maxStagesPerWorker}){
 if(!['per-stage','per-run'].includes(workerLifetime)||(workerLifetime==='per-run'&&(cancellationProtocol!=='cooperative-stage-cancel-v1'||stages?.length>MAX_HR_STAGES)))fail();
 if(maxStagesPerWorker!==undefined&&(!Number.isSafeInteger(maxStagesPerWorker)||maxStagesPerWorker<1||maxStagesPerWorker>Math.min(MAX_HR_STAGES,stages?.length??0)||(workerLifetime==='per-stage'&&maxStagesPerWorker!==1)))fail();
 if(workerScript&&(!['prepare','close','createWorker'].every(key=>typeof workerScript[key]==='function')))fail();
 if(typeof library?.Tensor!=='function'||typeof createWorker!=='function'||!Array.isArray(stages)||!stages.length)fail();
 const expected=stages.flatMap((stage,index)=>stage.release.resources.map(file=>({...file,name:`stage-${String(index).padStart(3,'0')}/${file.name}`})));
 if(JSON.stringify(stages[0].inputs)!==JSON.stringify([{name:'pixels',dtype:'float16',dims:[1,3,2048,2048]}])
  ||JSON.stringify(stages.at(-1).outputs)!==JSON.stringify([{name:'alpha',dtype:'float32',dims:[1,1,2048,2048]}]))fail();
 return async function prepare(release,{emit=()=>{},signal}={}){
  if(release.model!=='hr'||release.resources.length!==expected.length||!expected.every(file=>release.resources.some(other=>['name','url','bytes','sha256'].every(key=>file[key]===other[key]))))fail();
  let policy;
  policy=createResourcePolicy({files:release.resources,fetchImpl,cache,makeHasher,signal,onEvent:()=>{
   emit({type:'resource-state',modelVersion:release.modelVersion,resources:groupResourceStates(policy.getState())});
  }});
  const runner=createStagedHr({catalog:stages,createWorker,onStage,cancellationProtocol,workerLifetime,maxStagesPerWorker});
  let disposed=false;
  const handle={
   async model(inputs){return handle.runStaged(inputs);},
   async runStaged({pixels}={},options={}){
    if(disposed||pixels?.type!=='float16'||JSON.stringify(pixels.dims)!=='[1,3,2048,2048]'||!ArrayBuffer.isView(pixels.data)||pixels.data.BYTES_PER_ELEMENT!==2||pixels.data.byteLength!==25165824)throw Error('invalid-hr-fp16');
    const data=pixels.data,buffer=data.buffer instanceof ArrayBuffer&&data.byteOffset===0&&data.byteLength===data.buffer.byteLength?data.buffer:data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);
    const result=await runner.run([{name:'pixels',dtype:'float16',dims:[1,3,2048,2048],data:buffer}],options);
    return {alpha:new library.Tensor('float32',new Float32Array(result[0].data),[1,1,2048,2048])};
   },
   async dispose(){disposed=true;try{await runner.close();}finally{if(workerScript)await workerScript.close();}},
  };
  try{if(workerScript)await workerScript.prepare();return await prepareStoredModel({policy,signal,requiredFiles:release.resources,load:async()=>{
   // Drain cached streams through the existing checksum policy. Network streams
   // go directly to CacheStorage, with no cloned unread tee or whole-file buffer.
   for(const file of release.resources){
    const response=await policy.cache.match(file.url);
    if(response){const reader=response.body.getReader();try{while(!(await reader.read()).done){}}finally{reader.releaseLock();}}
    else await policy.cache.put(file.url,await policy.fetch(file.url));
   }
   return handle;
  }});}catch(error){await handle.dispose();throw error;}
 };
}
