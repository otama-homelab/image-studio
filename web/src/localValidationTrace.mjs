import {workerFailure} from '../../tools/browser-library-adapter/worker-failure.mjs';
import {stageTiming,MAX_HR_STAGES} from '../../tools/browser-library-adapter/stage-tensors.mjs';
/** Private validation entry only. Bounded metadata; never retain alpha/RGB/File/error objects. */
export function createLocalValidationTrace(){
 let state=null,role=null,completedElapsedMs=null;const events=[],resultRoles=[],stageTimes=new Map();let resultRolesOverflow=false;
 return Object.freeze({
  onState(value){state=Object.freeze(Object.fromEntries(['hasPhoto','hasResult','busy','blocked','closed','refine'].map(key=>[key,value?.[key]===true])));},
  onEvent(value){
   if(!['prepared','result','disposed','progress','error','resource-state'].includes(value?.type))return;
   if(value.type==='prepared'){role=['hr','matte','modnet','portrait','lite'].includes(value.model)?value.model:null;if(role==='hr'){stageTimes.clear();completedElapsedMs=null;}}
   const event={type:value.type,role,atMs:performance.now()};
   if(value.type==='error')event.code=workerFailure({},value.code).code;
   if(value.type==='progress'&&['initializing','hr','trimap','matte','releasing'].includes(value.phase))event.phase=value.phase;
   if(value.type==='progress'&&Number.isSafeInteger(value.completedStages)&&Number.isSafeInteger(value.totalStages)
    &&value.completedStages>=0&&value.completedStages<=value.totalStages&&value.totalStages<=MAX_HR_STAGES){event.completedStages=value.completedStages;event.totalStages=value.totalStages;}
   if(event.completedStages!==undefined&&value.stageTiming)try{event.stageTiming=stageTiming(value.stageTiming);if(role==='hr'&&event.completedStages>0)stageTimes.set(event.completedStages,event.stageTiming);}catch{}
   if(event.completedStages!==undefined&&Number.isFinite(value.elapsedMs)&&value.elapsedMs>=0&&value.elapsedMs<=600000){
    event.elapsedMs=value.elapsedMs;
    if(role==='hr'&&event.completedStages===event.totalStages)completedElapsedMs=value.elapsedMs;
   }
   if(value.type==='resource-state'&&Array.isArray(value.resources)){
    const safe=value.resources.filter(item=>Number.isSafeInteger(item?.bytes)&&item.bytes>0);
    event.storedBytes=safe.filter(item=>item.stored===true).reduce((sum,item)=>sum+item.bytes,0);
   }
   if(value.type==='result'){if(resultRoles.length<32)resultRoles.push(role);else resultRolesOverflow=true;}
   events.push(Object.freeze(event));if(events.length>64)events.shift();if(value.type==='disposed')role=null;
  },
  read:()=>{
   const totals={prepareMs:0,inferMs:0,exportMs:0,releaseMs:0};
   const parent={parentTimedStages:0,roundTripMs:0,feedPreparationMs:0};
   const preparation={preparationTimedStages:0,runtimeConfigureMs:0,modelLoadMs:0};
   const resources={resourceTimedStages:0,resourceReadWaitSumMs:0,resourceHashWorkSumMs:0,resourceVerifiedBytes:0,resourceVerifiedStreams:0};
   for(const timing of stageTimes.values()){
    for(const key of Object.keys(totals))totals[key]+=timing[key];
    if(timing.resourceReadWaitSumMs!==undefined){resources.resourceTimedStages++;for(const key of ['resourceReadWaitSumMs','resourceHashWorkSumMs','resourceVerifiedBytes','resourceVerifiedStreams'])resources[key]+=timing[key];}
    if(timing.runtimeConfigureMs!==undefined){preparation.preparationTimedStages++;preparation.runtimeConfigureMs+=timing.runtimeConfigureMs;preparation.modelLoadMs+=timing.modelLoadMs;}
    if(timing.roundTripMs!==undefined){parent.parentTimedStages++;parent.roundTripMs+=timing.roundTripMs;parent.feedPreparationMs+=timing.feedPreparationMs;}
   }
   return Object.freeze({state,resultRoles:Object.freeze([...resultRoles]),resultRolesOverflow,events:Object.freeze([...events]),stageTimings:Object.freeze([...stageTimes].sort(([a],[b])=>a-b).map(([completedStages,timing])=>Object.freeze({completedStages,...timing}))),stageTimingSummary:Object.freeze({completedStages:stageTimes.size,...totals,...(resources.resourceTimedStages?resources:{}),...(preparation.preparationTimedStages?preparation:{}),...(parent.parentTimedStages?parent:{}),...(completedElapsedMs===null?{}:{elapsedMs:completedElapsedMs})})});
  },
 });
}
