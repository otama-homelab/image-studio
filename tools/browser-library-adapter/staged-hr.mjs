import {createCooperativeWorkerStop} from './cooperative-worker-stop.mjs';
import {createSingleWorkerTask} from './single-worker-task.mjs';
import {stagePorts,stageFeatures,stageTiming,MAX_HR_STAGES} from './stage-tensors.mjs';
export class StageError extends Error{constructor(code){super(code);this.name='StageError';this.code=code;}}
/** Serial composition only; Worker lifetime and admission use existing primitives. Consumes input buffers. */
export function createStagedHr({catalog,createWorker,gate,onStage=()=>{},cancellationProtocol,workerLifetime='per-stage',maxStagesPerWorker}={}){
 if(cancellationProtocol!==undefined&&cancellationProtocol!=='cooperative-stage-cancel-v1')throw Error('invalid-stage-cancellation-protocol');
 if(!['per-stage','per-run'].includes(workerLifetime)||(workerLifetime==='per-run'&&(cancellationProtocol!=='cooperative-stage-cancel-v1'||catalog?.length>MAX_HR_STAGES)))throw Error('invalid-stage-worker-lifetime');
 const stopWorker=cancellationProtocol?createCooperativeWorkerStop({requestType:'cancel-stage',responseType:'stage-cancelled',timeoutMs:120000}):undefined;
 if(!Array.isArray(catalog)||!catalog.length||catalog.length>MAX_HR_STAGES)throw Error('invalid-stage-catalog');
 const workerStageLimit=maxStagesPerWorker??(workerLifetime==='per-run'?catalog.length:1);
 if(!Number.isSafeInteger(workerStageLimit)||workerStageLimit<1||workerStageLimit>Math.min(MAX_HR_STAGES,catalog.length)||(workerLifetime==='per-stage'&&workerStageLimit!==1))throw Error('invalid-stage-worker-limit');
 const produced=new Map(),lastUse=new Map();
 const specs=catalog.map((s,index)=>{
  const inputs=stagePorts(s.inputs),outputs=stagePorts(s.outputs);
  if(index===0)for(const p of inputs)produced.set(p.name,p);
  for(const p of inputs){const prior=produced.get(p.name);if(!prior||prior.dtype!==p.dtype||JSON.stringify(prior.dims)!==JSON.stringify(p.dims))throw Error('stage-input-not-produced');lastUse.set(p.name,index);}
  for(const p of outputs){if(produced.has(p.name))throw Error('duplicate-stage-output');produced.set(p.name,p);}
  return {inputs,outputs};
 });
 const finals=new Set(specs.at(-1).outputs.map(p=>p.name));
 for(const spec of specs.slice(0,-1))for(const p of spec.outputs)if(!lastUse.has(p.name))throw Error('unused-stage-output');
 let active=null,closed=false,blocked=false;
 const emit=event=>{try{onStage(Object.freeze(event));}catch{}};
 return Object.freeze({
  run(features,{signal}={}){
   if(closed||blocked)return Promise.reject(new StageError('stage-unavailable'));
   if(active)return Promise.reject(new StageError('stage-busy'));
   if(signal?.aborted)return Promise.reject(new StageError('aborted'));
   let initial;try{initial=stageFeatures(features,specs[0].inputs);}catch{return Promise.reject(new StageError('stage-input-invalid'));}
   const lease=gate?.tryAcquire();if(gate&&!lease)return Promise.reject(new StageError('stage-busy'));
   const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
   let retainedWorker=null,completedInWorker=0;
   const retained=workerLifetime==='per-run';
   const task=createSingleWorkerTask({createWorker:retained?()=>retainedWorker??=createWorker():createWorker,...(stopWorker?{stopWorker:retained?async(worker,job)=>{
    // A valid stage-result is sent only after its tensors/session are released.
    // Any error or cancellation ends this Worker; never retry it silently.
    if(job.code===null&&!job.cancel&&++completedInWorker<workerStageLimit)return;
    await stopWorker(worker,job);retainedWorker=null;completedInWorker=0;
   }:stopWorker}:{}),ErrorClass:StageError,prefix:'stage',requestType:'run-stage',responseType:'stage-result',
    errorCodes:['stage-input-failed','stage-prepare-failed','stage-run-failed','stage-release-failed','stage-device-lost','stage-output-invalid'],
    prepare({index,features}){const checked=stageFeatures(features,specs[index].inputs);return {request:{stageIndex:index,features:checked},transfer:checked.map(f=>f.data),context:{index}};},
    validate(event,{index}){if(event.stageIndex!==index)throw Error('wrong-stage');return {features:stageFeatures(event.features,specs[index].outputs,{finite:true}),...(event.timing?{timing:stageTiming(event.timing)}:{})};}});
   const job={controller,task};active=job;
   job.done=(async()=>{
    const values=new Map(initial.map(f=>[f.name,f]));
    try{
     for(let index=0;index<specs.length;index++){
      if(controller.signal.aborted)throw new StageError('aborted');
      const feedStarted=performance.now();
      const feeds=specs[index].inputs.map(port=>{
       const feature=values.get(port.name);if(!feature)throw new StageError('stage-input-invalid');
       if(lastUse.get(port.name)>index||finals.has(port.name))return {...feature,data:feature.data.slice(0)};
       values.delete(port.name);return feature;
      });
      const feedPreparationMs=performance.now()-feedStarted;
      emit({phase:'start',index,count:specs.length});
      const roundTripStarted=performance.now();
      const result=await task.run({index,features:feeds},{signal:controller.signal});
      const roundTripMs=performance.now()-roundTripStarted;
      if(controller.signal.aborted)throw new StageError('aborted');
      for(const feature of result.features)values.set(feature.name,feature);
      const residentBytes=[...values.values()].reduce((sum,f)=>sum+f.data.byteLength,0);
      if(residentBytes>2*1024**3)throw new StageError('stage-registry-budget-exceeded');
      const parentTiming={roundTripMs,feedPreparationMs};
      const timing=result.timing?stageTiming({...result.timing,...(Object.values(parentTiming).every(value=>Number.isFinite(value)&&value>=0&&value<=600000)?parentTiming:{})}):null;
      emit({phase:'complete',index,count:specs.length,residentBytes,...(timing?{timing}:{})});
     }
     return stageFeatures(specs.at(-1).outputs.map(p=>values.get(p.name)),specs.at(-1).outputs);
    }finally{
     values.clear();
     try{
      await task.close();
      if(retainedWorker&&!task.getState().blocked){const worker=retainedWorker;retainedWorker=null;try{await stopWorker(worker,{cancel:false});}catch{blocked=true;throw new StageError('stage-stop-failed');}}
      if(retained&&controller.signal.aborted)throw new StageError('aborted');
     }finally{signal?.removeEventListener('abort',abort);blocked||=task.getState().blocked;lease?.release({failed:blocked});if(active===job)active=null;}
    }
   })();return job.done;
  },
  async close(){closed=true;if(active){const job=active;job.controller.abort();try{await job.done;}catch{}}if(blocked)throw new StageError('stage-stop-failed');},
  getState(){return Object.freeze({busy:!!active,closed,blocked});},
 });
}
