export class InputLoadError extends Error{
 constructor(code){super(code);this.name='InputLoadError';this.code=code;}
}
/** Latest selection wins. read must settle only after its owned decoder Worker has ended. */
export function createInputLoad({registry,read,tracker}){
 const owner='input-owner-'+crypto.randomUUID();let epoch=0,active=null,record=null,closed=false,blocked=false,closingPromise;
 const release=()=>{const previous=record;record=null;if(previous)registry.release(previous.image.id,owner);};
 const stopFailed=error=>{
  try{return ['png-input-worker-stop-failed','jpeg-input-worker-stop-failed'].includes(Object.getOwnPropertyDescriptor(error,'code')?.value);}catch{return false;}
 };
 const wait=async job=>{if(!job)return;job.controller.abort();job.handle?.markCancelling();await job.terminal;if(job.stopFailed)throw new InputLoadError('input-stop-failed');};
 return Object.freeze({
  async load(file){
   if(closed||blocked)throw new InputLoadError('input-unavailable');
   const ticket=++epoch;await wait(active);
   if(ticket!==epoch||closed)return {status:'superseded'};
   if(blocked)throw new InputLoadError('input-unavailable');
   let finish;const job={controller:new AbortController(),terminal:new Promise(resolve=>{finish=resolve;}),stopFailed:false};active=job;
   try{
    job.handle=tracker?.begin({kind:'decode',selectionId:'selection-'+crypto.randomUUID()});
    if(ticket!==epoch||closed||job.controller.signal.aborted){job.handle?.markCancelling();return {status:'superseded'};}
    const image=await read(file,{signal:job.controller.signal});
    if(ticket!==epoch||closed||job.controller.signal.aborted)return {status:'superseded'};
    if(image?.format!=='rgb-u8')throw new InputLoadError('input-rgb-required');
    const inputId='input-'+crypto.randomUUID();
    const adopted=registry.register(image,owner),previous=record;
    record=Object.freeze({inputId,image:adopted});
    if(previous)registry.release(previous.image.id,owner);
    return {status:'ready',input:record};
   }catch(error){
    if(stopFailed(error)){job.stopFailed=true;blocked=true;job.handle?.markCancelling();throw new InputLoadError('input-stop-failed');}
    if(ticket!==epoch||closed||job.controller.signal.aborted)return {status:'superseded'};
    throw new InputLoadError('input-load-failed');
   }finally{if(active===job)active=null;if(!job.stopFailed)job.handle?.finish();finish();}
  },
  async cancel(){epoch++;await wait(active);},
  close(){if(closingPromise)return closingPromise;closed=true;epoch++;const job=active;closingPromise=Promise.resolve().then(()=>wait(job)).finally(release);return closingPromise;},
  get(){return record;},
  getState(){return Object.freeze({busy:!!active,cancelling:!!active?.controller.signal.aborted,closed,blocked});},
 });
}
