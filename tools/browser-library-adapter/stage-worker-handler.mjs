import {stagePorts,stageFeatures,stageTiming,MAX_HR_STAGES} from './stage-tensors.mjs';
/** One session at a time; bounded reuse is opt-in and requires successful cleanup. */
export function createStageWorkerHandler({catalog,Tensor,prepareStage,postMessage,maxJobs=1}){
 if(!Number.isSafeInteger(maxJobs)||maxJobs<1||maxJobs>MAX_HR_STAGES)throw Error('invalid-stage-worker-job-limit');
 const specs=catalog.map(s=>({inputs:stagePorts(s.inputs),outputs:stagePorts(s.outputs)})),seen=new Set();let poisoned=false,active=null,finished=null;
 return async command=>{
  if(typeof command?.jobId!=='string'||!command.jobId)return;
  if(command.type==='cancel-stage'){
   if(active?.jobId===command.jobId){active.cancelled=true;active.controller.abort();}
   else if(finished?.jobId===command.jobId)postMessage(finished.failed?{type:'error',jobId:command.jobId,code:'stage-release-failed'}:{type:'stage-cancelled',jobId:command.jobId});
   return;
  }
  if(active){postMessage({type:'error',jobId:command.jobId,code:'stage-input-failed'});return;}
  const jobId=command.jobId,job={jobId,cancelled:false,controller:new AbortController(),failed:false};active=job;
  let phase='input',owner,lost=false,response,transfer=[];const tensors=new Set();
  const release=async()=>{
   let failed=false;
   for(const tensor of [...tensors].reverse())try{await tensor.dispose();}catch{failed=true;}
   tensors.clear();const previous=owner;owner=null;
   if(previous)try{await previous.dispose();}catch{failed=true;}
   if(failed){job.failed=true;throw Error('stage-release-failed');}
  };
  try{
   if(poisoned||seen.size>=maxJobs||seen.has(jobId))throw Error('stage-input-invalid');seen.add(jobId);
   const spec=specs[command.stageIndex];
   if(command.type!=='run-stage'||!Number.isSafeInteger(command.stageIndex)||!spec)throw Error('stage-input-invalid');
   const inputs=stageFeatures(command.features,spec.inputs);
   const started=performance.now();
   phase='prepare';owner=await prepareStage(command.stageIndex,{signal:job.controller.signal,onDeviceLost:()=>{lost=true;}});
   const prepared=performance.now(),detail=owner.preparationTiming,resource=owner.resourceTiming;
   if(job.cancelled)return;
   if(lost)throw Error('stage-device-lost');
   const feeds=Object.create(null);
   for(const input of inputs){const tensor=new Tensor(input.dtype,input.dtype==='float16'?new Uint16Array(input.data):new Float32Array(input.data),input.dims);tensors.add(tensor);feeds[input.name]=tensor;}
   inputs.length=0;command.features.length=0;
   phase='run';const outputs=await owner.model(feeds);const inferred=performance.now();
   for(const tensor of Object.values(outputs??{}))if(typeof tensor?.dispose==='function')tensors.add(tensor);
   if(job.cancelled)return;
   if(lost)throw Error('stage-device-lost');
   const features=[],exported=new Set();
   for(const port of spec.outputs){
    const tensor=outputs?.[port.name];
    if(tensor?.type!==port.dtype||JSON.stringify(tensor.dims)!==JSON.stringify(port.dims)||!ArrayBuffer.isView(tensor.data)||tensor.data.byteLength!==port.bytes)throw Error('stage-output-invalid');
    // ORT's CPU output is already an independent typed array, copied out of WASM.
    // Transfer its complete buffer; copy only subviews/shared or aliased storage.
    const data=tensor.data,buffer=data.buffer instanceof ArrayBuffer&&data.byteOffset===0&&data.byteLength===data.buffer.byteLength&&!exported.has(data.buffer)
     ?data.buffer:new Uint8Array(data.buffer,data.byteOffset,data.byteLength).slice().buffer;
    exported.add(buffer);features.push({name:port.name,dtype:port.dtype,dims:[...port.dims],data:buffer});
    await tensor.dispose();tensors.delete(tensor);
   }
   const exportedAt=performance.now();phase='release';await release();
   const timing=stageTiming({prepareMs:prepared-started,inferMs:inferred-prepared,exportMs:exportedAt-inferred,releaseMs:performance.now()-exportedAt,...(detail?{runtimeConfigureMs:detail.runtimeConfigureMs,modelLoadMs:detail.modelLoadMs}:{}),...(resource?{resourceReadWaitSumMs:resource.readWaitSumMs,resourceHashWorkSumMs:resource.hashWorkSumMs,resourceVerifiedBytes:resource.verifiedBytes,resourceVerifiedStreams:resource.verifiedStreams}:{})});
   response={type:'stage-result',jobId,stageIndex:command.stageIndex,features,timing};transfer=features.map(f=>f.data);
  }catch(error){
   // An unsuccessful load/run may leave backend state unusable even if disposal
   // returns. Fail closed: the caller must replace this Worker after an error.
   poisoned=true;
   let code=['stage-device-lost','stage-output-invalid','stage-release-failed'].includes(error?.message)?error.message:'stage-'+phase+'-failed';
   try{await release();}catch{code='stage-release-failed';}
   response={type:'error',jobId,code};
  }finally{
   // A cancel can arrive during asynchronous release. ACK only after every owner
   // has unwound; release failure must never masquerade as successful cancel.
   try{await release();}catch{job.failed=true;response={type:'error',jobId,code:'stage-release-failed'};}
   if(lost||job.failed)poisoned=true;
   active=null;finished={jobId,failed:job.failed};
   if(job.cancelled)postMessage(job.failed?{type:'error',jobId,code:'stage-release-failed'}:{type:'stage-cancelled',jobId});
   else if(response)postMessage(response,transfer);
  }
 };
}
