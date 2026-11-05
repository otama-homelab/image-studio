const same=(a,b)=>!!a&&!!b&&a.inputId===b.inputId&&a.inferenceRevision===b.inferenceRevision&&a.modelVersion===b.modelVersion;
export class InferenceOperationError extends Error {
 constructor(code){super(code);this.name='InferenceOperationError';this.code=code;}
}

/** Explicit intent barrier around the whole HR/refinement pipeline, not a model executor. */
export function createInferenceOperation({execute,cancelOwned,getCurrent,committer,gate}){
 let active=null,stopping=false,blocked=false,stopPromise;
 function cancel(){
  const previous=active;active=null;
  if(stopping)return stopPromise;
  stopping=true;
  stopPromise=(async()=>{
   try{await cancelOwned();}catch{blocked=true;throw new InferenceOperationError('operation-stop-failed');}
   finally{stopping=false;previous?.lease?.release({failed:blocked});}
  })();
  return stopPromise;
 }
 return Object.freeze({
  cancel,
  async start(){
   if(blocked||gate?.getState().blocked)throw new InferenceOperationError('operation-unavailable');
   if(stopping)throw new InferenceOperationError('operation-stopping');
   if(active)throw new InferenceOperationError('operation-busy');
   let current;try{current=getCurrent();}catch{throw new InferenceOperationError('invalid-input');}
   if(!current?.key||typeof current.refine!=='boolean'||typeof current.rgbAssetId!=='string'||!current.rgbAssetId
    ||typeof current.key.inputId!=='string'||!current.key.inputId||typeof current.key.modelVersion!=='string'||!current.key.modelVersion
    ||!Number.isSafeInteger(current.key.inferenceRevision)||current.key.inferenceRevision<0)throw new InferenceOperationError('invalid-input');
   const context=Object.freeze({key:Object.freeze({inputId:current.key.inputId,inferenceRevision:current.key.inferenceRevision,modelVersion:current.key.modelVersion}),rgbAssetId:current.rgbAssetId,refine:current.refine});
   const lease=gate?.tryAcquire();if(gate&&!lease)throw new InferenceOperationError('operation-busy');
   const workerGate=lease?.createChildGate();
   const token={context,lease};active=token;
   const isCurrent=()=>{
    let latest;try{latest=getCurrent();}catch{return false;}return active===token&&!!latest&&same(context.key,latest.key)&&context.rgbAssetId===latest.rgbAssetId&&context.refine===latest.refine;
   };
   let stoppingOwn=false;
   try{
    const result=await execute(context,{isCurrent,workerGate});
    if(active!==token)return {status:'cancelled'};
    if(!isCurrent()){stoppingOwn=true;await cancel();return {status:'stale'};}
    if(workerGate?.getState().busy)throw new InferenceOperationError('operation-resources-active');
    return committer.commit(result);
   }catch{
    if(stoppingOwn)throw new InferenceOperationError('operation-stop-failed');
    if(active!==token)return {status:'cancelled'};
    const stale=!isCurrent();await cancel();if(stale)return {status:'stale'};throw new InferenceOperationError('runtime-error');
   }finally{if(active===token)active=null;if(!stopping)lease?.release({failed:blocked});}
  },
  getState(){return Object.freeze({running:!!active,stopping,blocked});},
 });
}
