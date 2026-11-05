/** One request per Worker. Await the stop hook before settling; native terminate alone is not a computation acknowledgement. No queue. */
export function createSingleWorkerTask({createWorker,prepare,validate,ErrorClass,prefix,requestType,responseType,errorCodes,gate,stopWorker=(worker,_job)=>worker.terminate()}){
 let active=null,closed=false,blocked=false;
 return Object.freeze({
  async run(input,{signal}={}){
   if(closed||blocked||gate?.getState().blocked)throw new ErrorClass(prefix+'-unavailable');
   if(active)throw new ErrorClass(prefix+'-busy');
   if(signal?.aborted)throw new ErrorClass('aborted');
   const payload=prepare(input);
   const lease=gate?.tryAcquire();if(gate&&!lease)throw new ErrorClass(prefix+'-busy');let worker;
   try{worker=createWorker();}catch{lease?.release();throw new ErrorClass(prefix+'-create-failed');}
   const job={worker,id:prefix+'-'+crypto.randomUUID(),settling:false,sent:false};active=job;
   return new Promise((resolve,reject)=>{
    const finish=(code,file)=>{
     if(job.settling)return job.done;job.settling=true;
     job.done=(async()=>{
     signal?.removeEventListener('abort',abort);
     for(const [type,listener] of [['message',message],['error',error],['messageerror',error]])try{worker.removeEventListener(type,listener);}catch{}
     let stopFailed=false;
     try{await stopWorker(worker,{jobId:job.id,cancel:code==='aborted'&&job.sent,code});}catch{blocked=true;stopFailed=true;code=prefix+'-stop-failed';}
     lease?.release({failed:stopFailed});
     if(active===job)active=null;
     if(code)reject(new ErrorClass(code));else resolve(file);
     })();return job.done;
    };
    const abort=()=>{void finish('aborted');},error=()=>{void finish(prefix+'-failed');};
    const message=event=>{
     if(active!==job||event.data?.jobId!==job.id)return;
     if(event.data.type==='error'){
      const code=errorCodes.includes(event.data.code)?event.data.code:prefix+'-protocol-error';void finish(code);return;
     }
     if(event.data.type!==responseType){void finish(prefix+'-protocol-error');return;}
     try{const file=validate(event.data,payload.context);void finish(null,file);}
     catch{void finish(prefix+'-protocol-error');}
    };
    job.cancel=()=>finish('aborted');
    try{worker.addEventListener('message',message);worker.addEventListener('error',error);worker.addEventListener('messageerror',error);}
    catch{void finish(prefix+'-failed');return;}
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted){abort();return;}
    try{job.sent=true;worker.postMessage({...payload.request,type:requestType,jobId:job.id},payload.transfer);}catch{void finish(prefix+'-send-failed');}
   });
  },
  async close(){closed=true;if(active)await active.cancel();},
  getState(){return Object.freeze({busy:!!active,stopping:!!active?.settling,closed,blocked});},
 });
}
