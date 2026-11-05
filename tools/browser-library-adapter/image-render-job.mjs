export class ImageRenderJobError extends Error {
 constructor(code){super(code);this.name='ImageRenderJobError';this.code=code;}
}
/** Domain ownership around resize/paper clients. prepare returns canonical scalar options/output dimensions. */
export function createImageRenderJob({registry,getCurrent,prepare,render}){
 const owner='render-result-'+crypto.randomUUID();let active=null,record=null,closed=false,blocked=false;
 const clear=()=>{if(record)registry.release(record.image.id,owner);record=null;};
 const snapshot=()=>{
  const c=getCurrent();if(!c)return null;
  if(typeof c.assetId!=='string'||!c.assetId||typeof c.dependencyKey!=='string'||!c.dependencyKey)throw new ImageRenderJobError('invalid-render-source');
  const metadata=registry.get(c.assetId);if(metadata.format!=='rgb-u8')throw new ImageRenderJobError('invalid-render-source');
  const prepared=structuredClone(prepare(c.settings,metadata)),signature=JSON.stringify(prepared);
  if(!prepared?.options||![prepared.output?.width,prepared.output?.height].every(n=>Number.isSafeInteger(n)&&n>0))throw new ImageRenderJobError('invalid-render-options');
  return {assetId:c.assetId,dependencyKey:c.dependencyKey,available:c.available!==false,prepared,signature};
 };
 const same=(a,b)=>!!a&&!!b&&a.available&&b.available&&a.assetId===b.assetId&&a.dependencyKey===b.dependencyKey&&a.signature===b.signature;
 const latest=()=>{try{return snapshot();}catch{return null;}};
 const current=job=>{const now=latest();return active===job&&!job.cancelled&&!closed&&same(job.source,now);};
 const cancel=()=>{const job=active;if(job&&!job.cancelled){job.cancelled=true;job.controller.abort();}return job?.done??Promise.resolve();};
 return Object.freeze({
  async start(){
   if(closed)throw new ImageRenderJobError('render-owner-closed');
   if(blocked)throw new ImageRenderJobError('render-unavailable');
   if(active)throw new ImageRenderJobError('render-busy');
   let source;try{source=snapshot();}catch{throw new ImageRenderJobError('invalid-render-source');}
   if(!source||!source.available)throw new ImageRenderJobError('invalid-render-source');
   const job={source,id:'render-job-'+crypto.randomUUID(),controller:new AbortController(),cancelled:false,done:null};
   registry.retain(source.assetId,job.id);active=job;
   job.done=Promise.resolve().then(async()=>{
    try{
     if(job.cancelled||closed)return {status:'cancelled'};
     const image=await render(registry.copy(source.assetId),source.prepared.options,{signal:job.controller.signal});
     if(job.cancelled||closed)return {status:'cancelled'};
     if(!current(job))return {status:'stale'};
     if(image?.format!=='rgb-u8'||image.width!==source.prepared.output.width||image.height!==source.prepared.output.height)throw new ImageRenderJobError('invalid-render-result');
     const adopted=registry.register(image,owner),previous=record;
     record={image:adopted,source};if(previous)registry.release(previous.image.id,owner);
     return {status:'ready',image:adopted};
    }catch(error){
     let stopFailed=false;
     try{stopFailed=['resize-worker-stop-failed','paper-worker-stop-failed'].includes(Object.getOwnPropertyDescriptor(error,'code')?.value);}catch{}
     if(stopFailed){blocked=true;throw new ImageRenderJobError('render-stop-failed');}
     if(job.cancelled||closed)return {status:'cancelled'};
     if(!current(job))return {status:'stale'};
     throw new ImageRenderJobError('render-failed');
    }finally{registry.release(source.assetId,job.id);if(active===job)active=null;}
   });
   return job.done;
  },
  cancel,
  reconcile(){const now=latest();if(record&&(!now||record.source.assetId!==now.assetId))clear();if(active&&!same(active.source,now))void cancel().catch(()=>{});},
  get(){const now=latest();if(record&&(!now||record.source.assetId!==now.assetId))clear();return record?Object.freeze({image:record.image,status:same(record.source,now)?'valid':'stale'}):null;},
  async close(){closed=true;clear();await cancel();},
  getState(){return Object.freeze({busy:!!active,cancelling:!!active?.cancelled,closed,blocked});},
 });
}
