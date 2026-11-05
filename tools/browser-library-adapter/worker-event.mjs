import {workerFailure} from './worker-failure.mjs';
import {stageTiming,MAX_HR_STAGES} from './stage-tensors.mjs';
const phases=new Set(['initializing','hr','trimap','matte','releasing']);
const resourceCodes=new Set(['resource-not-allowed','method-not-allowed','invalid-response','unexpected-response-url','transport-failed','resource-rate-limited','resource-access-denied','stream-failed','hash-init-failed','invalid-hasher','bytes-mismatch','bytes-overflow','checksum-mismatch','cache-read-failed','cache-write-failed','cache-quota-exceeded','cache-body-not-consumed','aborted']);
const invalid=()=>({status:'invalid',code:'invalid-worker-event'});

/** Validate before updating UI/registry. active is owned by the main-thread operation registry. */
export function checkWorkerEvent(event,active){
 if(!active||!event||event.workerId!==active.workerId||event.jobId!==active.jobId)return {status:'stale'};
 const envelope={workerId:active.workerId,jobId:active.jobId};let payload;
 switch(event.type){
  case 'result':{
   const key=event.key,expected=active.key,alpha=event.alpha;
   if(active.type!=='infer'||!key||!expected)return invalid();
   if(key.inputId!==expected.inputId||key.inferenceRevision!==expected.inferenceRevision||key.modelVersion!==expected.modelVersion)return {status:'stale'};
   if(!alpha||alpha.layout!=='alpha-u8'||!Number.isInteger(active.width)||!Number.isInteger(active.height)
    ||active.width<1||active.height<1||active.width>2000||active.height>2000
    ||alpha.width!==active.width||alpha.height!==active.height||!(alpha.data instanceof ArrayBuffer)
    ||alpha.data.byteLength!==active.width*active.height)return invalid();
   payload={type:'result',key:{inputId:expected.inputId,inferenceRevision:expected.inferenceRevision,modelVersion:expected.modelVersion},
    alpha:{width:active.width,height:active.height,layout:'alpha-u8',data:alpha.data}};break;
  }
  case 'prepared':
   if(active.type!=='prepare'||event.modelVersion!==active.modelVersion||event.model!==active.model)return invalid();
   payload={type:'prepared',modelVersion:active.modelVersion,model:active.model};break;
  case 'resource-state':{
   if(active.type!=='prepare'||event.modelVersion!==active.modelVersion||!Array.isArray(event.resources)||!Array.isArray(active.resources))return invalid();
   const resources=[],seen=new Set();
   for(const state of event.resources){
    if(!state||!active.resources.some(f=>f.sha256===state.sha256&&f.bytes===state.bytes))return invalid();
    const id=state.sha256+':'+state.bytes;if(seen.has(id))return invalid();seen.add(id);
    if(['networkVerified','cacheVerified','stored'].some(k=>typeof state[k]!=='boolean')||!(state.lastError===null||resourceCodes.has(state.lastError)))return invalid();
    resources.push({sha256:state.sha256,bytes:state.bytes,networkVerified:state.networkVerified,cacheVerified:state.cacheVerified,stored:state.stored,lastError:state.lastError});
   }
   payload={type:'resource-state',modelVersion:active.modelVersion,resources};break;
  }
  case 'progress':
   if(!phases.has(event.phase)||!Number.isFinite(event.elapsedMs)||event.elapsedMs<0)return invalid();
   payload={type:'progress',phase:event.phase,elapsedMs:event.elapsedMs};
   if(event.completedStages!==undefined||event.totalStages!==undefined){
    if(active.type!=='infer'||event.phase!=='hr'||!Number.isSafeInteger(event.totalStages)||event.totalStages<1||event.totalStages>MAX_HR_STAGES
     ||!Number.isSafeInteger(event.completedStages)||event.completedStages<0||event.completedStages>event.totalStages)return invalid();
    Object.assign(payload,{completedStages:event.completedStages,totalStages:event.totalStages});
   }
   if(event.stageTiming!==undefined){
    if(payload.completedStages===undefined)return invalid();
    try{payload.stageTiming=stageTiming(event.stageTiming);}catch{return invalid();}
   }
   break;
  case 'error':{
   const safe=workerFailure(envelope,event.code);
   if(safe.code!==event.code||safe.retryable!==event.retryable)return invalid();
   return {status:'accepted',event:safe};
  }
  case 'disposed':
   if(active.type!=='dispose')return invalid();payload={type:'disposed'};break;
  case 'cancelled':
   if(active.type!=='cancel')return invalid();payload={type:'cancelled'};break;
  default:return invalid();
 }
 return {status:'accepted',event:{...envelope,...payload}};
}
