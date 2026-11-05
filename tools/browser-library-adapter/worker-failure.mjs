/** Fixed D03 failure events. The envelope must come from the main-thread operation registry. */
const retryableCodes=new Map([
 ['gpu-unavailable',false],['device-lost',true],['allocation-failed',true],
 ['unsupported-model',false],['invalid-input',false],['invalid-result',true],['runtime-error',true],
]);

/** Never classify arbitrary thrown objects by their message, name, stack or custom fields. */
export function workerFailure(envelope,code='runtime-error'){
 const selected=typeof code==='string'&&retryableCodes.has(code)?code:'runtime-error';
 return {workerId:envelope.workerId,jobId:envelope.jobId,type:'error',code:selected,retryable:retryableCodes.get(selected)};
}

/** Keep exception payloads inside the Worker; only the fixed event crosses the boundary. */
export async function runWorkerOperation(envelope,operation){
 try{return {ok:true,value:await operation()};}
 catch{return {ok:false,event:workerFailure(envelope)};}
}
