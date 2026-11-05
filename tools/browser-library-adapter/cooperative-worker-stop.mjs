/** Protocol acknowledgement before termination. Owns neither a queue nor the caller's gate. */
export function createCooperativeWorkerStop({requestType,responseType,timeoutMs=10000}){
 if(typeof requestType!=='string'||!requestType||typeof responseType!=='string'||!responseType||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw Error('invalid-worker-stop-policy');
 return async function stop(worker,{jobId,cancel,workerId=null}){
  if(!cancel){await worker.terminate();return;}
  try{
   if(typeof jobId!=='string'||!jobId)throw Error('worker-cancel-unconfirmed');
   await new Promise((resolve,reject)=>{
    let timer;
    const cleanup=()=>{clearTimeout(timer);worker.removeEventListener('message',message);worker.removeEventListener('error',error);worker.removeEventListener('messageerror',error);};
    const error=()=>{cleanup();reject(Error('worker-cancel-unconfirmed'));};
    const message=event=>{
     const value=event.data;if(value?.jobId!==jobId||(workerId!==null&&value.workerId!==workerId))return;
     if(value.type===responseType){cleanup();resolve();}else if(value.type==='error')error();
    };
    worker.addEventListener('message',message);worker.addEventListener('error',error);worker.addEventListener('messageerror',error);
    timer=setTimeout(error,timeoutMs);
    try{worker.postMessage({type:requestType,jobId,...(workerId!==null?{workerId}:{})});}catch{error();}
   });
  }finally{await worker.terminate();}
 };
}
