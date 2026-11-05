import {inferenceTransport} from './inference-input.mjs';
import {checkWorkerEvent} from './worker-event.mjs';
export class WorkerClientError extends Error {
 constructor(code){super(code);this.name='WorkerClientError';this.code=code;}
}

/** One owned Worker, one request, no queue. Worker factory is supplied by the application. */
export function createWorkerClient({createWorker,gate,onEvent=()=>{},onWorkerFailure=()=>{},stopWorker=(worker,_context)=>worker.terminate()}){
 let owner=null,active=null,prepared=null,sequence=0,stopping=null,blocked=false;
 const publish=event=>{try{onEvent(event);}catch{}};
 function stop(cancel=false){
  const previous=owner;owner=null;prepared=null;
  if(!previous)return stopping??Promise.resolve();
  for(const [type,listener] of [['message',previous.message],['error',previous.error],['messageerror',previous.error]])try{previous.worker.removeEventListener(type,listener);}catch{}
  const release=failed=>{if(failed)blocked=true;previous.lease?.release({failed});};
  let result;
  try{result=stopWorker(previous.worker,{workerId:previous.id,jobId:previous.lastJobId,cancel});}catch{release(true);return Promise.reject(new WorkerClientError('worker-stop-failed'));}
  if(!result||typeof result.then!=='function'){release(false);return Promise.resolve();}
  const done=Promise.resolve(result).then(()=>{release(false);if(stopping===done)stopping=null;},()=>{release(true);if(stopping===done)stopping=null;throw new WorkerClientError('worker-stop-failed');});
  stopping=done;return done;
 }
 function notifyFailure(workerId,code){try{onWorkerFailure(Object.freeze({workerId,code}));}catch{}}
 function fail(code){
  const pending=active,workerId=owner?.id;active=null;const done=stop(code==='aborted');
  if(workerId&&code!=='aborted')notifyFailure(workerId,code);
  done.then(()=>pending?.reject(new WorkerClientError(code)),()=>pending?.reject(new WorkerClientError('worker-stop-failed')));
  return done;
 }
 function connect(){
  const lease=gate?.tryAcquire();if(gate&&!lease)throw new WorkerClientError(gate.getState().blocked?'worker-unavailable':'worker-busy');
  let worker;try{worker=createWorker();}catch{lease?.release();throw new WorkerClientError('worker-create-failed');}
  const current={worker,lease,id:'worker-'+crypto.randomUUID()};
  current.message=message=>{
   if(owner!==current)return;
   if(!active){
    if(message.data?.type!=='error'||!current.lastJobId)return;
    const checked=checkWorkerEvent(message.data,{workerId:current.id,jobId:current.lastJobId,type:'idle'});
    if(checked.status==='accepted')fail(checked.event.code);
    else if(checked.status==='invalid')fail('invalid-worker-event');
    return;
   }
   const checked=checkWorkerEvent(message.data,active.context);
   if(checked.status==='stale')return;
   if(checked.status==='invalid'){fail('invalid-worker-event');return;}
   const event=checked.event;
   if(event.type==='progress'||event.type==='resource-state'){publish(event);return;}
   const pending=active;active=null;
   if(event.type==='prepared')prepared={model:event.model,modelVersion:event.modelVersion};
   const terminal=event.type==='error'||event.type==='disposed'||event.type==='cancelled';
   const done=terminal?stop():Promise.resolve();
   if(event.type==='error')notifyFailure(current.id,event.code);
   done.then(()=>{publish(event);if(event.type==='error')pending.reject(new WorkerClientError(event.code));else pending.resolve(event);},()=>pending.reject(new WorkerClientError('worker-stop-failed')));
  };
  current.error=()=>{if(owner===current)fail('runtime-error');};
  owner=current;
  worker.addEventListener('message',current.message);
  worker.addEventListener('error',current.error);
  worker.addEventListener('messageerror',current.error);
 }
 return Object.freeze({
  request(command,transfer=[]){
   if(blocked||gate?.getState().blocked)return Promise.reject(new WorkerClientError('worker-unavailable'));
   if(stopping)return Promise.reject(new WorkerClientError('worker-stopping'));
   if(active)return Promise.reject(new WorkerClientError('worker-busy'));
   if(!['prepare','infer','dispose','cancel'].includes(command?.type))return Promise.reject(new WorkerClientError('invalid-command'));
   if(command.type==='infer'){
    try{const transport=inferenceTransport(command);command=transport.request;transfer=transport.transfer;}
    catch{return Promise.reject(new WorkerClientError('invalid-input'));}
   }
   if(command.type==='prepare'&&prepared)return Promise.reject(new WorkerClientError('model-already-prepared'));
   if(command.type==='infer'&&(!prepared||command.key?.modelVersion!==prepared.modelVersion))return Promise.reject(new WorkerClientError('model-not-prepared'));
   if(!owner&&command.type!=='prepare')return Promise.reject(new WorkerClientError('worker-not-prepared'));
   let key,resources;
   try{
    key=command.key?{inputId:command.key.inputId,inferenceRevision:command.key.inferenceRevision,modelVersion:command.key.modelVersion}:undefined;
    resources=command.source?.mode==='library-resources'?command.source.resources.map(f=>({sha256:f.sha256,bytes:f.bytes})):[];
   }catch{return Promise.reject(new WorkerClientError('invalid-input'));}
   try{if(!owner)connect();}catch(error){return stop().then(()=>{throw new WorkerClientError(error instanceof WorkerClientError?error.code:'worker-create-failed');},()=>{throw new WorkerClientError('worker-stop-failed');});}
   const workerId=owner.id,jobId='job-'+(++sequence);owner.lastJobId=jobId;
   // Snapshot keys before postMessage; caller mutation must not change reply admission.
   const context={workerId,jobId,type:command.type,key,model:command.model,modelVersion:command.modelVersion,
    width:command.rgb?.width,height:command.rgb?.height,
    resources};
   return new Promise((resolve,reject)=>{
    active={context,resolve,reject};
    try{owner.worker.postMessage({...command,...(key?{key}:{}),workerId,jobId},transfer);}
    catch{fail('post-message-failed');}
   });
  },
  cancel(){return fail('aborted');},
  getState(){return Object.freeze({workerId:owner?.id??null,jobId:active?.context.jobId??null,busy:!!active||!!stopping,stopping:!!stopping,blocked,prepared:prepared?{...prepared}:null});},
 });
}
