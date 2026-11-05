import {validateLibraryPreparation} from './preparation-source.mjs';
import {inferenceTransport} from './inference-input.mjs';
import {workerFailure} from './worker-failure.mjs';
import {checkWorkerEvent} from './worker-event.mjs';

/** Library-resources candidate receiver. Callbacks supply existing model/image operations. */
export function createWorkerHandler({trustedModels,prepare,infer,postMessage,onRuntimeFailure=()=>{}}){
 let model=null,release=null,busy=false,failed=false,releasing=false,lastEnvelope=null,cancelling=false,cancelEnvelope=null,controller=null,disposeFailed=false;
 const onDeviceLost=()=>{if(failed||releasing||cancelling)return;failed=true;if(lastEnvelope)postMessage(workerFailure(lastEnvelope,'device-lost'));};
 return async function handle(command){
  if(!command||typeof command.workerId!=='string'||!command.workerId||typeof command.jobId!=='string'||!command.jobId)return;
  const envelope={workerId:command.workerId,jobId:command.jobId};
  const finishCancel=async()=>{
   releasing=true;const previous=model;model=null;release=null;
   try{if(disposeFailed)throw Error('dispose-failed');if(previous){if(typeof previous.dispose!=='function')throw Error('invalid-model-handle');await previous.dispose();}postMessage({...cancelEnvelope,type:'cancelled'});}
   catch{disposeFailed=true;postMessage(workerFailure(cancelEnvelope,'runtime-error'));}
   finally{failed=true;releasing=false;}
  };
  if(command.type==='cancel'){
   if(cancelling||!lastEnvelope||envelope.workerId!==lastEnvelope.workerId||(busy&&envelope.jobId!==lastEnvelope.jobId))return;
   cancelling=true;cancelEnvelope=envelope;controller?.abort();
   if(!busy){busy=true;try{await finishCancel();}finally{busy=false;}}
   return;
  }
  const error=code=>{failed=true;if(!cancelling)postMessage(workerFailure(envelope,code));};
  if(failed||busy){error('runtime-error');return;}
  lastEnvelope=envelope;busy=true;controller=new AbortController();
  try{
   if(command.type==='prepare'){
    if(model){error('unsupported-model');return;}
    const trusted=trustedModels.find(t=>t.model===command.model&&t.modelVersion===command.modelVersion);
    try{release=validateLibraryPreparation(command,trusted);}catch{error('unsupported-model');return;}
    const context={...envelope,type:'prepare',model:release.model,modelVersion:release.modelVersion,resources:release.resources};
    const emit=payload=>{
     if(cancelling)return;
     if(failed||!['progress','resource-state'].includes(payload?.type))throw Error('invalid-preparation-event');
     const checked=checkWorkerEvent({...envelope,...payload},context);
     if(checked.status!=='accepted')throw Error('invalid-preparation-event');
     postMessage(checked.event);
    };
    // prepare must use the stored-resource gate; only current successful handles return here.
    model=await prepare(release,{emit,onDeviceLost,signal:controller.signal});
    if(cancelling)return;
    if(failed){if(model?.dispose)await model.dispose();model=null;error('runtime-error');return;}
    if(!model||typeof model.dispose!=='function')throw Error('invalid-model-handle');
    postMessage({...envelope,type:'prepared',model:release.model,modelVersion:release.modelVersion});
   }else if(command.type==='infer'){
    if(!model||command.key?.modelVersion!==release.modelVersion){error('unsupported-model');return;}
    let request;
    try{request=inferenceTransport(command).request;}catch{error('invalid-input');return;}
    if(release.model==='matte'&&(!request.refine||!request.hrAlpha)){error('invalid-input');return;}
    const context={...envelope,type:'infer',key:request.key,width:request.rgb.width,height:request.rgb.height};
    const emit=payload=>{
     if(cancelling)return;
     if(failed||payload?.type!=='progress')throw Error('invalid-inference-event');
     const checked=checkWorkerEvent({...envelope,...payload},context);
     if(checked.status!=='accepted')throw Error('invalid-inference-event');
     postMessage(checked.event);
    };
    const alpha=await infer(model,request,release,{emit,signal:controller.signal});
    if(cancelling)return;
    if(failed){error('runtime-error');return;}
    const checked=checkWorkerEvent({...envelope,type:'result',key:request.key,alpha},
     context);
    if(checked.status!=='accepted'){error('invalid-result');return;}
    postMessage(checked.event,[checked.event.alpha.data]);
   }else if(command.type==='dispose'){
    releasing=true;const previous=model;model=null;release=null;
    try{if(previous)await previous.dispose();}catch{disposeFailed=true;throw Error('dispose-failed');}
    if(!cancelling)postMessage({...envelope,type:'disposed'});failed=true;
   }else error('invalid-input');
  }catch(cause){
   try{onRuntimeFailure(cause,{phase:command.type,model:release?.model});}catch{}
   error('runtime-error');
  }
  finally{if(cancelling&&cancelEnvelope)await finishCancel();busy=false;}
 };
}
