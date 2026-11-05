export class TrackedOperationError extends Error {
 constructor(code){super(code);this.name='TrackedOperationError';this.code=code;}
}
/** UI binding for an owned controller whose run/cancel promises include resource shutdown. */
export function createTrackedOperation({tracker,describe,run,cancelOwned,gate}){
 let active=null,blocked=false;
 const finish=job=>{if(job.ended)return;job.ended=true;if(active===job)active=null;job.handle.finish();};
 const stop=(job,userCancelled)=>{
  if(userCancelled)job.cancelled=true;
  job.handle?.markCancelling();
  if(!job.stop){
   job.stop=Promise.resolve().then(()=>job.started?cancelOwned():undefined).then(()=>{
    if(gate?.getState().blocked||gate?.getState().busy)throw new Error();
    if(job.cancelled)finish(job);
   }).catch(()=>{blocked=true;throw new TrackedOperationError('operation-stop-failed');});
   // UI may observe cancel failure before run settles. Retain metadata, without an unhandled rejection.
   void job.stop.catch(()=>{});
  }
  return job.stop;
 };
 return Object.freeze({
  async start(){
   if(blocked||gate?.getState().blocked)throw new TrackedOperationError('operation-unavailable');
   if(active||gate?.getState().busy)throw new TrackedOperationError('operation-busy');
   let descriptor;try{descriptor=describe();}catch{throw new TrackedOperationError('invalid-operation');}
   const job={handle:null,started:false,cancelled:false,stop:null,ended:false};active=job;
   try{job.handle=tracker.begin(descriptor);}catch{active=null;throw new TrackedOperationError('operation-not-started');}
   if(job.cancelled)job.handle.markCancelling();
   return Promise.resolve().then(async()=>{
    let value,failed=false;
    try{if(!job.cancelled){job.started=true;value=await run(job.handle);}}
    catch{failed=true;if(!job.cancelled)stop(job,false);}
    finally{
     if(!job.ended){
      if(!job.stop&&gate?.getState().busy){failed=true;stop(job,false);}
      if(job.stop)await job.stop;
      if(!job.ended){
       if(gate?.getState().blocked||gate?.getState().busy){blocked=true;job.handle.markCancelling();throw new TrackedOperationError('operation-stop-failed');}
       finish(job);
      }
     }
    }
    if(job.cancelled)return {status:'cancelled'};
    if(failed)throw new TrackedOperationError('operation-failed');
    return {status:'completed',value};
   });
  },
  cancel(){return active?stop(active,true):Promise.resolve();},
  getState(){return Object.freeze({busy:!!active,stopping:!!active?.stop,blocked});},
 });
}
