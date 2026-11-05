import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkerGate} from '../tools/browser-library-adapter/worker-gate.mjs';
import {createSingleWorkerTask} from '../tools/browser-library-adapter/single-worker-task.mjs';
class TaskError extends Error{constructor(code){super(code);this.code=code;}}
function setup({failStop=false,failCreate=false}={}){
 const gate=createWorkerGate(),workers=[];
 const task=prefix=>createSingleWorkerTask({gate,prefix,ErrorClass:TaskError,requestType:'run',responseType:'done',errorCodes:[],prepare:input=>({request:{input},transfer:[],context:null}),validate:event=>event.value,
  createWorker(){
   if(failCreate)throw Error('private');const listeners=new Map();let resolve,reject;
   const stopped=new Promise((a,b)=>{resolve=a;reject=b;});
   const w={addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type),postMessage:message=>{w.command=message;},terminate:()=>stopped,reply:()=>listeners.get('message')({data:{type:'done',jobId:w.command.jobId,value:7}}),stop:()=>failStop?reject(Error('private')):resolve()};workers.push(w);return w;
  },
 });return {gate,workers,a:task('resize-worker'),b:task('export-worker')};
}
test('different clients cannot overlap, including while a successful Worker is stopping',async()=>{
 const f=setup(),pending=f.a.run({});assert.equal(f.workers.length,1);
 await assert.rejects(f.b.run({}),e=>e.code==='export-worker-busy');assert.equal(f.workers.length,1);
 f.workers[0].reply();assert.equal(f.gate.getState().busy,true);await assert.rejects(f.b.run({}),e=>e.code==='export-worker-busy');
 f.workers[0].stop();assert.equal(await pending,7);assert.equal(f.gate.getState().busy,false);
 const next=f.b.run({});f.workers[1].reply();f.workers[1].stop();assert.equal(await next,7);await f.a.close();await f.b.close();
});
test('failed termination blocks all clients using the gate',async()=>{
 const f=setup({failStop:true}),pending=f.a.run({});f.workers[0].reply();f.workers[0].stop();
 await assert.rejects(pending,e=>e.code==='resize-worker-stop-failed');assert.deepEqual(f.gate.getState(),{busy:false,blocked:true});
 await assert.rejects(f.b.run({}),e=>e.code==='export-worker-unavailable');assert.equal(f.workers.length,1);
});
test('Worker construction failure releases admission without poisoning other clients',async()=>{
 const f=setup({failCreate:true});await assert.rejects(f.a.run({}),e=>e.code==='resize-worker-create-failed');assert.deepEqual(f.gate.getState(),{busy:false,blocked:false});
});
test('released lease cannot release or poison a newer owner; state snapshots are stable',()=>{
 const gate=createWorkerGate();assert.equal(gate.getState(),gate.getState());const first=gate.tryAcquire();assert.equal(gate.tryAcquire(),null);first.release();
 const second=gate.tryAcquire();assert.equal(first.release({failed:true}),false);assert.deepEqual(gate.getState(),{busy:true,blocked:false});second.release();
});

test('listener setup failure still terminates before releasing shared admission',async()=>{
 const gate=createWorkerGate();let stop,terminated=0;
 const stopped=new Promise(resolve=>{stop=resolve;});
 const task=createSingleWorkerTask({gate,prefix:'pixel-worker',ErrorClass:TaskError,requestType:'run',responseType:'done',errorCodes:[],prepare:()=>({request:{},transfer:[]}),validate:()=>0,
 createWorker:()=>({addEventListener(){throw Error('private');},removeEventListener(){throw Error('private cleanup');},postMessage(){assert.fail('must not post');},terminate(){terminated++;return stopped;}})});
 const pending=task.run({});assert.equal(terminated,1);assert.equal(gate.getState().busy,true);stop();
 await assert.rejects(pending,e=>e.code==='pixel-worker-failed'&&e.message==='pixel-worker-failed');assert.deepEqual(gate.getState(),{busy:false,blocked:false});
});
