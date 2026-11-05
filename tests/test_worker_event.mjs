import test from 'node:test';
import assert from 'node:assert/strict';
import {checkWorkerEvent} from '../tools/browser-library-adapter/worker-event.mjs';
const key={inputId:'input-1',inferenceRevision:1,modelVersion:'set-1'};
const active={workerId:'worker-1',jobId:'job-1',type:'infer',key,width:3,height:2};
const result=()=>({workerId:active.workerId,jobId:active.jobId,type:'result',key:{...key},alpha:{width:3,height:2,layout:'alpha-u8',data:new ArrayBuffer(6)}});
test('old worker/job/input/revision/model responses cannot change the current result',()=>{
 const mutations=[e=>{e.workerId='old';},e=>{e.jobId='old';},e=>{e.key.inputId='old';},e=>{e.key.inferenceRevision=0;},e=>{e.key.modelVersion='old';}];
 for(const change of mutations){const event=result();change(event);assert.equal(checkWorkerEvent(event,active).status,'stale');}
 assert.equal(checkWorkerEvent(result(),null).status,'stale');
});
test('valid alpha retains the transferred buffer but excludes arbitrary event fields',()=>{
 const event=result();event.exception='private';event.alpha.photoName='private';event.key.private='private';
 const checked=checkWorkerEvent(event,active);assert.equal(checked.status,'accepted');assert.equal(checked.event.alpha.data,event.alpha.data);
 assert.equal(JSON.stringify(checked).includes('private'),false);
});
test('shape, layout, shared/detached buffers and wrong command replies are refused',()=>{
 for(const mutate of [e=>{e.alpha.width=2;},e=>{e.alpha.layout='rgb-u8-interleaved';},e=>{e.alpha.data=new ArrayBuffer(5);},e=>{e.alpha.data=new SharedArrayBuffer(6);},e=>{structuredClone(e.alpha.data,{transfer:[e.alpha.data]});}]){
  const event=result();mutate(event);assert.equal(checkWorkerEvent(event,active).status,'invalid');
 }
 assert.equal(checkWorkerEvent(result(),{...active,type:'prepare'}).status,'invalid');
});
test('old errors/progress are ignored and accepted errors have only fixed fields',()=>{
 const base={workerId:active.workerId,jobId:active.jobId};
 for(const payload of [{type:'progress',phase:'hr',elapsedMs:1},{type:'error',code:'runtime-error',retryable:true}]){
  assert.equal(checkWorkerEvent({...base,...payload,workerId:'old'},active).status,'stale');
  assert.equal(checkWorkerEvent({...base,...payload},active).status,'accepted');
 }
 assert.equal(checkWorkerEvent({...base,type:'error',code:'private',retryable:true},active).status,'invalid');
 assert.equal(checkWorkerEvent({...base,type:'error',code:'gpu-unavailable',retryable:true},active).status,'invalid');
 assert.equal(checkWorkerEvent({...base,type:'progress',phase:'hr',elapsedMs:Infinity},active).status,'invalid');
});
test('prepared/release/cancel replies belong to their exact command',()=>{
 const base={workerId:active.workerId,jobId:active.jobId};
 for(const [type,command] of [['disposed','dispose'],['cancelled','cancel']]){
  assert.equal(checkWorkerEvent({...base,type},{...active,type:command}).status,'accepted');
  assert.equal(checkWorkerEvent({...base,type},active).status,'invalid');
 }
 const expected={...active,type:'prepare',model:'hr',modelVersion:'set-1'};
 assert.equal(checkWorkerEvent({...base,type:'prepared',model:'hr',modelVersion:'set-1'},expected).status,'accepted');
 assert.equal(checkWorkerEvent({...base,type:'prepared',model:'matte',modelVersion:'set-1'},expected).status,'invalid');
});
test('resource state is bound to prepared resources and excludes URL/error text',()=>{
 const file={sha256:'a'.repeat(64),bytes:3},context={...active,type:'prepare',modelVersion:'set-1',resources:[file]};
 const event={workerId:active.workerId,jobId:active.jobId,type:'resource-state',modelVersion:'set-1',resources:[{...file,networkVerified:true,cacheVerified:false,stored:false,lastError:'cache-quota-exceeded',url:'private'}]};
 const checked=checkWorkerEvent(event,context);assert.equal(checked.status,'accepted');assert.equal(JSON.stringify(checked).includes('private'),false);
 for(const code of ['resource-rate-limited','resource-access-denied']){event.resources[0].lastError=code;assert.equal(checkWorkerEvent(event,context).status,'accepted');}
 event.resources[0].lastError='private';assert.equal(checkWorkerEvent(event,context).status,'invalid');
 event.resources[0].lastError=null;event.resources[0].bytes=4;assert.equal(checkWorkerEvent(event,context).status,'invalid');
});

test('stage counts belong only to current HR inference and stay within their declared total',()=>{
 const base={workerId:active.workerId,jobId:active.jobId,type:'progress',phase:'hr',elapsedMs:10,completedStages:12,totalStages:46,private:'discard'};
 assert.equal(checkWorkerEvent({...base,completedStages:406,totalStages:406},active).status,'accepted');
 const checked=checkWorkerEvent(base,active);assert.equal(checked.status,'accepted');assert.equal(checked.event.completedStages,12);assert.equal(checked.event.totalStages,46);assert.equal('private' in checked.event,false);
 for(const change of [{completedStages:-1},{completedStages:47},{completedStages:1.5},{totalStages:0},{totalStages:1025},{totalStages:undefined},{phase:'matte'}])assert.equal(checkWorkerEvent({...base,...change},active).status,'invalid');
 assert.equal(checkWorkerEvent(base,{...active,type:'prepare'}).status,'invalid');assert.equal(checkWorkerEvent({...base,jobId:'old'},active).status,'stale');
});

test('stage timing is bounded numeric metadata, with no arbitrary worker fields',()=>{
 const base={workerId:active.workerId,jobId:active.jobId,type:'progress',phase:'hr',elapsedMs:10,completedStages:1,totalStages:46,stageTiming:{prepareMs:2,inferMs:3,exportMs:1,releaseMs:0,private:'discard'}};
 const checked=checkWorkerEvent(base,active);assert.equal(checked.status,'accepted');assert.deepEqual(checked.event.stageTiming,{prepareMs:2,inferMs:3,exportMs:1,releaseMs:0});
 for(const change of [{prepareMs:Infinity},{inferMs:-1},{exportMs:undefined},{releaseMs:600001}])assert.equal(checkWorkerEvent({...base,stageTiming:{...base.stageTiming,...change}},active).status,'invalid');
});

test('stage timing optional parent measurements are bounded, paired and sanitized',()=>{
 const base={prepareMs:2,inferMs:3,exportMs:1,releaseMs:0};
 const event={workerId:active.workerId,jobId:active.jobId,type:'progress',phase:'hr',elapsedMs:10,completedStages:1,totalStages:46,stageTiming:{...base,roundTripMs:10,feedPreparationMs:2,filename:'private-sentinel'}};
 const checked=checkWorkerEvent(event,active);assert.equal(checked.status,'accepted');assert.deepEqual(checked.event.stageTiming,{...base,roundTripMs:10,feedPreparationMs:2});
 for(const extra of [{roundTripMs:1},{feedPreparationMs:1},{roundTripMs:Infinity,feedPreparationMs:1},{roundTripMs:1,feedPreparationMs:600001}])assert.equal(checkWorkerEvent({...event,stageTiming:{...base,...extra}},active).status,'invalid');
});

test('private trace keeps CPU stage progress and timing beyond 256 stages',async()=>{
 const {createLocalValidationTrace}=await import('../web/src/localValidationTrace.mjs');const t=createLocalValidationTrace();t.onEvent({type:'prepared',model:'hr'});t.onEvent({type:'progress',phase:'hr',completedStages:406,totalStages:406,elapsedMs:100,stageTiming:{prepareMs:1,inferMs:2,exportMs:0,releaseMs:0}});assert.equal(t.read().stageTimings[0]?.completedStages,406);assert.equal(t.read().stageTimingSummary.elapsedMs,100);
});
