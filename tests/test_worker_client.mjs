import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkerClient} from '../tools/browser-library-adapter/worker-client.mjs';
import {createCooperativeWorkerStop} from '../tools/browser-library-adapter/cooperative-worker-stop.mjs';
import {createWorkerGate} from '../tools/browser-library-adapter/worker-gate.mjs';
import {FakeWorker} from './fixtures/fake-inference-worker.mjs';

const prep={type:'prepare',model:'hr',modelVersion:'set-1',source:{mode:'library-resources',resources:[]}};
const infer=()=>({type:'infer',key:{inputId:'input-1',inferenceRevision:1,modelVersion:'set-1'},rgb:{width:2,height:1,layout:'rgb-u8-interleaved',data:new ArrayBuffer(6)},refine:false});
function setup(options={}){const workers=[],events=[],failures=[];const client=createWorkerClient({createWorker:()=>{const worker=new FakeWorker();workers.push(worker);return worker;},onEvent:e=>events.push(e),onWorkerFailure:e=>failures.push(e),...options});return {client,workers,events,failures};}
async function ready(f){const pending=f.client.request(prep);f.workers.at(-1).reply({type:'prepared',model:'hr',modelVersion:'set-1'});await pending;}

test('prepare/infer/dispose use one Worker and valid result buffer is returned without copying',async()=>{
 const f=setup();await ready(f);const pending=f.client.request(infer()),worker=f.workers[0],buffer=new ArrayBuffer(2);
 worker.reply({type:'result',key:infer().key,alpha:{width:2,height:1,layout:'alpha-u8',data:buffer}});
 assert.equal((await pending).alpha.data,buffer);assert.equal(f.workers.length,1);
 const disposed=f.client.request({type:'dispose'});worker.reply({type:'disposed'});await disposed;
 assert.equal(worker.terminated,1);assert.deepEqual(f.client.getState(),{workerId:null,jobId:null,busy:false,stopping:false,blocked:false,prepared:null});
});
test('busy requests are rejected without queueing or replacing the current request',async()=>{
 const f=setup(),pending=f.client.request(prep);
 await assert.rejects(f.client.request(prep),e=>e.code==='worker-busy');assert.equal(f.workers[0].sent.length,1);
 f.workers[0].reply({type:'prepared',model:'hr',modelVersion:'set-1'});await pending;
 await assert.rejects(f.client.request(prep),e=>e.code==='model-already-prepared');
 f.client.cancel();
});
test('cancel invalidates before terminate and late callbacks cannot affect a new Worker',async()=>{
 const f=setup(),pending=f.client.request(prep),old=f.workers[0];
 const lateMessage=[...old.listeners.get('message')][0],lateError=[...old.listeners.get('error')][0];
 const rejected=assert.rejects(pending,e=>e.code==='aborted');f.client.cancel();await rejected;assert.equal(old.terminated,1);
 const next=f.client.request(prep),current=f.workers[1];assert.notEqual(current.sent[0].message.workerId,old.sent[0].message.workerId);
 lateError({message:'private'});lateMessage({data:{...old.sent[0].message,type:'prepared'}});
 assert.equal(f.client.getState().busy,true);assert.equal(current.terminated,0);
 current.reply({type:'prepared',model:'hr',modelVersion:'set-1'});await next;f.client.cancel();
});
test('stale results are ignored and mutable caller keys cannot change admission',async()=>{
 const f=setup();await ready(f);const command=infer(),pending=f.client.request(command),worker=f.workers[0];command.key.inferenceRevision=2;
 worker.reply({type:'result',key:command.key,alpha:{width:2,height:1,layout:'alpha-u8',data:new ArrayBuffer(2)}});
 assert.equal(f.client.getState().busy,true);
 worker.reply({type:'result',key:infer().key,alpha:{width:2,height:1,layout:'alpha-u8',data:new ArrayBuffer(2)}});
 assert.equal((await pending).key.inferenceRevision,1);f.client.cancel();
});
test('bad results and runtime errors terminate the owning Worker with fixed errors',async()=>{
 for(const mode of ['invalid','error','messageerror','typed-error']){
  const f=setup();await ready(f);const pending=f.client.request(infer()),worker=f.workers[0];
  const rejection=assert.rejects(pending,e=>e.code===(mode==='invalid'?'invalid-worker-event':'runtime-error')&&!e.message.includes('private'));
  if(mode==='invalid')worker.reply({type:'result',key:infer().key,alpha:{width:2,height:1,layout:'alpha-u8',data:new ArrayBuffer(1)}});
  else if(mode==='typed-error')worker.reply({type:'error',code:'runtime-error',retryable:true,message:'private'});
  else worker.emit(mode);
  await rejection;assert.equal(worker.terminated,1);assert.equal(f.client.getState().busy,false);
 }
});
test('model version mismatch and infer before prepare never reach a Worker',async()=>{
 const f=setup();await assert.rejects(f.client.request(infer()),e=>e.code==='model-not-prepared');assert.equal(f.workers.length,0);
 await ready(f);const command=infer();command.key.modelVersion='set-2';
 await assert.rejects(f.client.request(command),e=>e.code==='model-not-prepared');assert.equal(f.workers[0].sent.length,1);f.client.cancel();
});
test('postMessage failure rejects, terminates and permits later explicit preparation',async()=>{
 const broken=new FakeWorker(),next=new FakeWorker();broken.postMessage=()=>{throw Error('private clone payload');};let count=0;
 const client=createWorkerClient({createWorker:()=>count++===0?broken:next});
 await assert.rejects(client.request(prep),e=>e.code==='post-message-failed');assert.equal(broken.terminated,1);assert.equal(client.getState().busy,false);
 const pending=client.request(prep);next.reply({type:'prepared',model:'hr',modelVersion:'set-1'});await pending;
 assert.equal(count,2);assert.equal(client.getState().prepared.model,'hr');client.cancel();
});
test('progress is published without completing the request; callback failures do not strand it',async()=>{
 const worker=new FakeWorker();let events=0;
 const client=createWorkerClient({createWorker:()=>worker,onEvent(){events++;throw Error('Synthetic observer failure');}});
 const pending=client.request(prep);worker.reply({type:'progress',phase:'initializing',elapsedMs:3});
 assert.equal(client.getState().busy,true);
 worker.reply({type:'prepared',model:'hr',modelVersion:'set-1'});await pending;
 assert.equal(events,2);assert.equal(client.getState().busy,false);client.cancel();
});

test('invalid input leaves prepared Worker usable and valid input automatically transfers RGB',async()=>{
 const f=setup();await ready(f);const bad=infer();bad.rgb.data=new ArrayBuffer(1);
 await assert.rejects(f.client.request(bad),e=>e.code==='invalid-input');
 assert.equal(f.workers[0].sent.length,1);assert.equal(f.workers[0].terminated,0);
 const command=infer(),pending=f.client.request(command),sent=f.workers[0].sent.at(-1);
 assert.deepEqual(sent.transfer,[command.rgb.data]);
 f.workers[0].reply({type:'result',key:command.key,alpha:{width:2,height:1,layout:'alpha-u8',data:new ArrayBuffer(2)}});
 await pending;f.client.cancel();
});

test('idle Worker errors clear preparation, notify current ownership and allow explicit recreation',async()=>{
 const f=setup();await ready(f);const previousId=f.client.getState().workerId,old=f.workers[0];
 old.emit('error');assert.equal(f.client.getState().prepared,null);assert.equal(old.terminated,1);
 assert.deepEqual(f.failures,[{workerId:previousId,code:'runtime-error'}]);
 await ready(f);assert.notEqual(f.client.getState().workerId,previousId);f.client.cancel();assert.equal(f.failures.length,1);
});
test('idle device-lost messages are scoped to the last command and redacted',async()=>{
 const f=setup();await ready(f);const worker=f.workers[0],workerId=f.client.getState().workerId;
 worker.emit('message',{workerId,jobId:'old',type:'error',code:'device-lost',retryable:true});assert.equal(f.failures.length,0);
 worker.reply({type:'error',code:'device-lost',retryable:true,message:'private device payload'});
 assert.deepEqual(f.failures,[{workerId,code:'device-lost'}]);assert.equal(worker.terminated,1);
});

test('separate client instances cannot reuse a Worker ownership identifier',async()=>{
 const first=setup(),second=setup();await ready(first);await ready(second);
 assert.notEqual(first.client.getState().workerId,second.client.getState().workerId);
 first.client.cancel();second.client.cancel();
});

test('malformed preparation snapshot is rejected before creating or reserving a Worker',async()=>{
 const f=setup();await assert.rejects(f.client.request({...prep,source:{mode:'library-resources',resources:null}}),e=>e.code==='invalid-input');assert.equal(f.workers.length,0);
});

test('cooperative cancellation retains the gate until the matching worker/job acknowledgement',async()=>{
 const gate=createWorkerGate(),stopWorker=createCooperativeWorkerStop({requestType:'cancel',responseType:'cancelled',timeoutMs:100});const f=setup({gate,stopWorker});await ready(f);
 const pending=f.client.request(infer()),rejected=assert.rejects(pending,e=>e.code==='aborted'),worker=f.workers[0];const stopped=f.client.cancel();
 assert.equal(worker.terminated,0);assert.equal(gate.getState().busy,true);const cancel=worker.sent.at(-1).message;assert.equal(cancel.type,'cancel');
 worker.emit('message',{type:'cancelled',workerId:'old-worker',jobId:cancel.jobId});worker.emit('message',{...cancel,type:'cancelled',jobId:'old-job'});
 worker.reply({type:'result',key:infer().key,alpha:{width:2,height:1,layout:'alpha-u8',data:new ArrayBuffer(2)}});
 assert.equal(worker.terminated,0);await assert.rejects(f.client.request(prep),e=>e.code==='worker-stopping');
 worker.reply({type:'cancelled'});await stopped;await rejected;assert.equal(worker.terminated,1);assert.equal(gate.getState().busy,false);assert.equal(f.events.some(e=>e.type==='result'),false);
});
test('unconfirmed cooperative cancellation terminates and blocks admission instead of allowing a new worker',async()=>{
 const gate=createWorkerGate(),stopWorker=createCooperativeWorkerStop({requestType:'cancel',responseType:'cancelled',timeoutMs:10}),f=setup({gate,stopWorker});
 const pending=f.client.request(prep),rejected=assert.rejects(pending,e=>e.code==='worker-stop-failed');await assert.rejects(f.client.cancel(),e=>e.code==='worker-stop-failed');await rejected;
 assert.equal(f.workers[0].terminated,1);assert.deepEqual(gate.getState(),{busy:false,blocked:true});await assert.rejects(f.client.request(prep),e=>e.code==='worker-unavailable');assert.equal(f.workers.length,1);
});
