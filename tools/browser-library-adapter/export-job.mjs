import {PAPER_PIXELS as papers} from './paper-contract.mjs';
export class ExportJobError extends Error {
 constructor(code){super(code);this.name='ExportJobError';this.code=code;}
}
export function normalizeExportOptions(input){
 const {kind,paper,format='png',backgroundColor}=input??{};
 if(!['background','transparent','crop','paper'].includes(kind)||!['png','pdf'].includes(format)
  ||(format==='pdf'&&kind!=='paper')||(kind==='paper'&&!Object.hasOwn(papers,paper)))throw new ExportJobError('invalid-export-options');
 if(backgroundColor!==undefined&&(kind!=='background'||!Array.isArray(backgroundColor)||backgroundColor.length!==3||backgroundColor.some(value=>!Number.isInteger(value)||value<0||value>255)))throw new ExportJobError('invalid-export-options');
 return Object.freeze({kind,format,...(kind==='paper'?{paper}:{}),...(backgroundColor!==undefined?{backgroundColor:Object.freeze([...backgroundColor])}:{})});
}
const slot=o=>JSON.stringify([o.kind,o.format,o.paper??null]);
const same=(a,b)=>!!a&&!!b&&a.assetId===b.assetId&&a.dependencyKey===b.dependencyKey;
export const exportFilename=o=>o.format==='pdf'?`image-studio-paper-${o.paper}.pdf`:o.kind==='paper'?`image-studio-paper-${o.paper}-300dpi.png`:o.kind==='crop'?'image-studio-crop-300dpi.png':`image-studio-${o.kind}.png`;

/** One encoding job. encode must run off the UI thread in the production application. */
export function createExportJobs({registry,getCurrent,encode}){
 let active=null,blocked=false;const ready=new Map(),listeners=new Set();
 let state=Object.freeze({jobId:null,busy:false,cancelling:false,blocked:false});
 const notify=()=>{state=Object.freeze({jobId:active?.id??null,busy:!!active,cancelling:!!active?.cancelled,blocked});for(const listener of [...listeners])try{listener(state);}catch{}};
 const cancel=jobId=>{if(!active||(jobId!==undefined&&active.id!==jobId))return false;if(!active.cancelled){active.cancelled=true;active.controller.abort();notify();}return true;};
 const valid=record=>same(record.source,getCurrent(record.options));
 return Object.freeze({
  async start(input){
   if(blocked)throw new ExportJobError('export-unavailable');
   if(active)throw new ExportJobError('export-busy');
   const options=normalizeExportOptions(input),current=getCurrent(options);
   if(!current||typeof current.assetId!=='string'||typeof current.dependencyKey!=='string'||!current.dependencyKey)throw new ExportJobError('export-source-unavailable');
   const source=Object.freeze({assetId:current.assetId,dependencyKey:current.dependencyKey}),metadata=registry.get(source.assetId);
   if(metadata.format!==(options.kind==='transparent'||options.backgroundColor?'rgba-u8':'rgb-u8')
    ||(options.kind==='paper'&&(metadata.width!==papers[options.paper][0]||metadata.height!==papers[options.paper][1])))throw new ExportJobError('invalid-export-source');
   const owner='export-job-'+crypto.randomUUID(),controller=new AbortController();
   let finishTerminal;const terminal=new Promise(resolve=>{finishTerminal=resolve;});
   registry.retain(source.assetId,owner);const job={id:owner,source,options,controller,cancelled:false,terminal,stopFailed:false};active=job;notify();
   try{
    if(job.cancelled)return {status:'cancelled'};
    const image=registry.copy(source.assetId),file=await encode(image,options,{signal:controller.signal});
    if(job.cancelled)return {status:'cancelled'};
    if(!same(source,getCurrent(options)))return {status:'stale'};
    const mime=options.format==='png'?'image/png':'application/pdf';
    if(!(file?.bytes instanceof Uint8Array)||file.bytes.length===0||file.mime!==mime||file.filename!==exportFilename(options)
     ||file.width!==metadata.width||file.height!==metadata.height)throw new ExportJobError('invalid-export-result');
    const record=Object.freeze({source,options,file:Object.freeze({...file})});ready.set(slot(options),record);
    return {status:'ready',file:record.file};
   }catch(error){
    let failedStop=false;try{failedStop=Object.getOwnPropertyDescriptor(error,'code')?.value==='export-worker-stop-failed';}catch{}
    if(failedStop){job.stopFailed=true;blocked=true;throw new ExportJobError('export-stop-failed');}
    if(job.cancelled)return {status:'cancelled'};
    if(!same(source,getCurrent(options)))return {status:'stale'};
    throw new ExportJobError('export-failed');
   }finally{try{registry.release(source.assetId,owner);}finally{if(active===job)active=null;finishTerminal();notify();}}
  },
  cancel,
  async cancelAndWait(jobId){
   const job=active;if(!job||(jobId!==undefined&&job.id!==jobId)){if(blocked)throw new ExportJobError('export-unavailable');return false;}
   cancel(jobId);await job.terminal;if(job.stopFailed)throw new ExportJobError('export-stop-failed');return true;
  },
  isCurrent(jobId){return !!active&&active.id===jobId&&same(active.source,getCurrent(active.options));},
  subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
  getReady(input){const options=normalizeExportOptions(input),id=slot(options),record=ready.get(id);if(!record)return null;if(JSON.stringify(record.options.backgroundColor)!==JSON.stringify(options.backgroundColor))return null;if(!valid(record)){ready.delete(id);return null;}return record.file;},
  reconcile(){for(const [id,record] of ready)if(!valid(record))ready.delete(id);},
  clear(){if(active&&!active.cancelled){active.cancelled=true;active.controller.abort();}ready.clear();notify();},
  getState(){return state;},
 });
}
