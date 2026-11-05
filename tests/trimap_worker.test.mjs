import test from 'node:test';
import assert from 'node:assert/strict';
import {createTrimapWorkerClient,createTrimapWorkerHandler} from '../tools/browser-library-adapter/trimap-worker.mjs';
import {createWorkerGate} from '../tools/browser-library-adapter/worker-gate.mjs';

test('invalid/repeated handler jobs never initialize OpenCV and errors contain no private detail',async()=>{
 let initialized=0;const events=[],handle=createTrimapWorkerHandler({createCv(){initialized++;throw Error('private path');},postMessage:event=>events.push(event)});
 await handle({type:'make-trimap',jobId:'first',alpha:{width:1,height:1,layout:'alpha-u8',data:new ArrayBuffer(2)}});
 await handle({type:'make-trimap',jobId:'second',alpha:{width:1,height:1,layout:'alpha-u8',data:new ArrayBuffer(1)}});
 assert.equal(initialized,0);assert.deepEqual(events.map(e=>e.code),['invalid-trimap-input','invalid-trimap-input']);
 const failed=createTrimapWorkerHandler({createCv(){throw Error('private path');},postMessage:event=>events.push(event)});
 await failed({type:'make-trimap',jobId:'valid',alpha:{width:1,height:1,layout:'alpha-u8',data:new ArrayBuffer(1)}});
 assert.deepEqual(events.at(-1),{type:'error',jobId:'valid',code:'trimap-worker-failed'});
});

function setup({badOutput=false,waitForStop=false,noReply=false}={}){
 const gate=createWorkerGate();let stopped=0,finishStop,worker;
 const client=createTrimapWorkerClient({gate,createWorker(){
  const listeners=new Map();worker={
   addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type),
   postMessage(command,transfer){
    const received=structuredClone(command,{transfer});
    if(!noReply)queueMicrotask(()=>listeners.get('message')?.({data:{type:'trimap-ready',jobId:received.jobId,
     trimap:{width:3,height:1,layout:'trimap-u8',data:Uint8Array.of(0,badOutput?127:128,255).buffer}}}));
   },async terminate(){if(waitForStop)await new Promise(resolve=>{finishStop=resolve;});stopped++;},
  };return worker;
 }});
 return {gate,client,stopped:()=>stopped,finish:()=>finishStop?.()};
}
test('trimap client transfers only its own HR alpha copy and awaits termination before releasing gate',async()=>{
 const f=setup({waitForStop:true}),original=Uint8Array.of(5,120,250),pending=f.client.make({width:3,height:1,layout:'alpha-u8',data:original.buffer});
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual([...original],[5,120,250]);assert.equal(f.stopped(),0);assert.equal(f.gate.getState().busy,true);
 f.finish();const result=await pending;assert.deepEqual([...new Uint8Array(result.data)],[0,128,255]);assert.equal(f.stopped(),1);assert.equal(f.gate.getState().busy,false);await f.client.close();
});
test('invalid trimap values reject after termination; cancellation closes the owned Worker',async()=>{
 const image=()=>({width:3,height:1,layout:'alpha-u8',data:new ArrayBuffer(3)});
 const bad=setup({badOutput:true});await assert.rejects(bad.client.make(image()),e=>e.code==='trimap-worker-protocol-error');assert.equal(bad.stopped(),1);await bad.client.close();
 const cancelled=setup({noReply:true}),pending=cancelled.client.make(image());const failure=assert.rejects(pending,e=>e.code==='aborted');
 await cancelled.client.close();await failure;assert.equal(cancelled.stopped(),1);assert.equal(cancelled.gate.getState().busy,false);
});
test('trimap cancel waits pending OpenCV initialization and never invokes a cancelled job',async()=>{
 let ready;const events=[],handle=createTrimapWorkerHandler({createCv:()=>new Promise(resolve=>{ready=resolve;}),postMessage:e=>events.push(e)});
 const done=handle({type:'make-trimap',jobId:'one',alpha:{width:1,height:1,layout:'alpha-u8',data:new ArrayBuffer(1)}});
 await handle({type:'cancel-trimap',jobId:'stale'});assert.deepEqual(events,[]);await handle({type:'cancel-trimap',jobId:'one'});assert.deepEqual(events,[]);
 ready(null);await done;assert.deepEqual(events,[{type:'trimap-cancelled',jobId:'one'}]);
});
test('trimap initialization failure during cancellation emits fixed failure, not successful ACK',async()=>{
 let fail;const events=[],handle=createTrimapWorkerHandler({createCv:()=>new Promise((_resolve,reject)=>{fail=reject;}),postMessage:e=>events.push(e)});
 const done=handle({type:'make-trimap',jobId:'one',alpha:{width:1,height:1,layout:'alpha-u8',data:new ArrayBuffer(1)}});
 await handle({type:'cancel-trimap',jobId:'one'});fail(Error('private'));await done;assert.deepEqual(events,[{type:'error',jobId:'one',code:'trimap-worker-failed'}]);
});
test('cooperative trimap client waits initialization before releasing shared gate',async()=>{
 let ready;const listeners=new Map(),gate=createWorkerGate(),order=[];
 const handle=createTrimapWorkerHandler({createCv:()=>new Promise(resolve=>{ready=resolve;}),postMessage:event=>queueMicrotask(()=>listeners.get('message')?.({data:event}))});
 const client=createTrimapWorkerClient({gate,cancellationProtocol:'cooperative-trimap-cancel-v1',createWorker:()=>({addEventListener:(t,f)=>listeners.set(t,f),removeEventListener:t=>listeners.delete(t),postMessage:c=>queueMicrotask(()=>void handle(c)),terminate(){order.push('terminate');}})});
 const controller=new AbortController(),pending=client.make({width:1,height:1,layout:'alpha-u8',data:new ArrayBuffer(1)},{signal:controller.signal}),rejected=assert.rejects(pending,e=>e.code==='aborted');await Promise.resolve();controller.abort();await Promise.resolve();assert.equal(gate.getState().busy,true);assert.deepEqual(order,[]);ready(null);await rejected;assert.deepEqual(order,['terminate']);assert.equal(gate.getState().busy,false);assert.equal(gate.getState().blocked,false);
});
