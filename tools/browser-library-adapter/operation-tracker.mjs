export class OperationTrackerError extends Error {
 constructor(code){super(code);this.name='OperationTrackerError';this.code=code;}
}
const nonempty=value=>typeof value==='string'&&value.length>0;
/** UI metadata only. Owners must finish after their resource shutdown, never use this as a Worker terminator. */
export function createOperationTracker({createId=()=>crypto.randomUUID()}={}){
 let active=null;const listeners=new Set();
 const publish=()=>{for(const listener of [...listeners])try{listener(active?.state??null);}catch{}};
 return Object.freeze({
  begin(descriptor){
   if(active)throw new OperationTrackerError('operation-busy');
   let detail;
   if(descriptor?.kind==='inference'){
    const key=descriptor.key;
    if(!nonempty(key?.inputId)||!nonempty(key?.modelVersion)||!Number.isSafeInteger(key?.inferenceRevision)||key.inferenceRevision<0)throw new OperationTrackerError('invalid-operation');
    detail={kind:'inference',workerId:null,key:Object.freeze({inputId:key.inputId,inferenceRevision:key.inferenceRevision,modelVersion:key.modelVersion})};
   }else if(descriptor?.kind==='decode'&&nonempty(descriptor.selectionId)){
    detail={kind:'decode',selectionId:descriptor.selectionId};
   }else if(['resize','paper','export'].includes(descriptor?.kind)&&nonempty(descriptor.sourceAssetId)&&nonempty(descriptor.dependencyKey)){
    detail={kind:descriptor.kind,sourceAssetId:descriptor.sourceAssetId,dependencyKey:descriptor.dependencyKey};
   }else throw new OperationTrackerError('invalid-operation');
   let operationId;try{operationId=createId();}catch{throw new OperationTrackerError('operation-id-unavailable');}
   if(!nonempty(operationId))throw new OperationTrackerError('operation-id-unavailable');
   const token={state:Object.freeze({operationId,...detail,phase:'running'})};active=token;publish();
   return Object.freeze({
    operationId,
    isCurrent(){return active===token&&token.state.phase==='running';},
    setWorker(workerId){
     if(active!==token||token.state.kind!=='inference'||token.state.phase!=='running')return false;
     if(workerId!==null&&!nonempty(workerId))throw new OperationTrackerError('invalid-worker-id');
     if(token.state.workerId===workerId)return true;
     token.state=Object.freeze({...token.state,workerId});publish();return true;
    },
    markCancelling(){
     if(active!==token)return false;
     if(token.state.phase!=='cancelling'){token.state=Object.freeze({...token.state,phase:'cancelling'});publish();}return true;
    },
    finish(){if(active!==token)return false;active=null;publish();return true;},
   });
  },
  getSnapshot(){return active?.state??null;},
  subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
 });
}
