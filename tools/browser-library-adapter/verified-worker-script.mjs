import {createResourcePolicy} from './resource-policy.mjs';
export class WorkerScriptError extends Error{
 constructor(code){super(code);this.name='WorkerScriptError';this.code=code;}
}
/** Own one hash-verified standalone classic Worker script and all Workers created from it. */
export function createVerifiedWorkerScript({file,fetchImpl,makeHasher,WorkerClass,urlApi=URL,BlobClass=Blob,maxScriptBytes=1024*1024,signal=null}){
 if(!Number.isSafeInteger(maxScriptBytes)||maxScriptBytes<1||!file||file.bytes>maxScriptBytes||typeof WorkerClass!=='function')throw new WorkerScriptError('invalid-worker-script');
 const descriptor=Object.freeze({url:file.url,bytes:file.bytes,sha256:file.sha256});
 const abort=new AbortController();
 // Script assets use the browser HTTP cache; these model customCache hooks are intentionally unused.
 const policy=createResourcePolicy({files:[descriptor],fetchImpl,makeHasher,signal:signal?AbortSignal.any([abort.signal,signal]):abort.signal,cache:{async match(){return undefined;},async put(){throw Error('script-cache-unused');}}});
 let url=null,preparing=null,closing=null,closed=false,blocked=false;const workers=new Set();
 const revoke=()=>{if(url&&closed&&!workers.size){urlApi.revokeObjectURL(url);url=null;}};
 const stop=record=>{
  if(record.terminal)return record.terminal;
  record.terminal=Promise.resolve().then(()=>record.worker.terminate()).then(()=>{workers.delete(record);revoke();},()=>{blocked=true;throw new WorkerScriptError('worker-script-stop-failed');});
  return record.terminal;
 };
 return Object.freeze({
  prepare(){
   if(closed||blocked)return Promise.reject(new WorkerScriptError('worker-script-unavailable'));
   if(url)return Promise.resolve();if(preparing)return preparing;
   preparing=Promise.resolve().then(async()=>{
    try{
     const response=await policy.fetch(descriptor.url),bytes=await response.arrayBuffer();
     if(closed||signal?.aborted)throw Error();
     if(bytes.byteLength!==descriptor.bytes)throw Error();
     url=urlApi.createObjectURL(new BlobClass([bytes],{type:'text/javascript'}));
    }catch{throw new WorkerScriptError(closed?'worker-script-unavailable':'worker-script-prepare-failed');}
    finally{preparing=null;}
   });return preparing;
  },
  createWorker(){
   if(closed||blocked)throw new WorkerScriptError('worker-script-unavailable');
   if(!url)throw new WorkerScriptError('worker-script-not-ready');
   let worker;try{worker=new WorkerClass(url);}catch{throw new WorkerScriptError('worker-script-create-failed');}
   const record={worker,terminal:null};workers.add(record);
   return Object.freeze({addEventListener:worker.addEventListener.bind(worker),removeEventListener:worker.removeEventListener.bind(worker),postMessage:worker.postMessage.bind(worker),terminate:()=>stop(record)});
  },
  close(){
   if(closing)return closing;closed=true;abort.abort();
   closing=Promise.resolve().then(async()=>{
    if(preparing)try{await preparing;}catch{}
    let failed=false;for(const record of [...workers])try{await stop(record);}catch{failed=true;}
    if(failed)throw new WorkerScriptError('worker-script-stop-failed');revoke();
   });return closing;
  },
  getState(){return Object.freeze({ready:!!url,preparing:!!preparing,closed,blocked,workers:workers.size});},
 });
}
