import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createForegroundWorkerHandler} from '../tools/browser-library-adapter/foreground-worker-handler.mjs';
const input=()=>({width:2,height:1,rgb:Uint8Array.of(1,2,3,4,5,6),alpha:Uint8Array.of(255,0)});
const command=()=>({type:'recover-foreground',jobId:'test',input:input()});
test('malformed byte planes reject before creating the WASM runtime',async()=>{
 for(const change of [{width:2001},{width:1,height:1},{rgb:new Float32Array(6)},{alpha:new Uint8Array(1)},...(typeof SharedArrayBuffer==='function'?[{alpha:new Uint8Array(new SharedArrayBuffer(2))}]:[])]){
  let created=0;const events=[],handle=createForegroundWorkerHandler({createRuntime(){created++;},postMessage:event=>events.push(event)});await handle({...command(),input:{...input(),...change}});assert.equal(created,0);assert.deepEqual(events,[{type:'error',jobId:'test',code:'invalid-foreground-input'}]);
 }
});
test('runtime closes before final RGBA transfer and preserves original opaque RGB',async()=>{
 const order=[],handle=createForegroundWorkerHandler({createRuntime:async()=>({estimate(source){assert.ok(source.rgb instanceof Float32Array);assert.equal(source.alpha[0],1);return {width:2,height:1,foreground:new Float32Array(6).fill(0.5),background:new Float32Array(6)};},close(){order.push('close');}}),postMessage(event,transfer){order.push('post');assert.deepEqual([...new Uint8Array(event.result.data)],[1,2,3,255,127,127,127,0]);assert.deepEqual(transfer,[event.result.data]);}});await handle(command());assert.deepEqual(order,['close','post']);
});
for(const failure of ['create','estimate','result','close'])test('runtime failure produces fixed error without leaking details: '+failure,async()=>{
 const events=[];let closes=0;const handle=createForegroundWorkerHandler({createRuntime:async()=>{if(failure==='create')throw Error('private path');return {estimate(){if(failure==='estimate')throw Error('private path');return {width:2,height:1,foreground:new Float32Array(6).fill(failure==='result'?NaN:0),background:new Float32Array(6)};},close(){closes++;if(failure==='close')throw Error('private path');}};},postMessage:event=>events.push(event)});await handle(command());assert.deepEqual(events,[{type:'error',jobId:'test',code:'foreground-worker-failed'}]);assert.equal(closes,failure==='create'?0:1);
});
test('second command is rejected while the first runtime is still being created',async()=>{
 let release,created=0;const events=[],handle=createForegroundWorkerHandler({createRuntime(){created++;return new Promise(resolve=>{release=()=>resolve({estimate:()=>({width:2,height:1,foreground:new Float32Array(6),background:new Float32Array(6)}),close(){}});});},postMessage:event=>events.push(event)});
 const pending=handle(command());await handle({...command(),jobId:'second'});assert.equal(created,1);assert.deepEqual(events,[{type:'error',jobId:'second',code:'invalid-foreground-input'}]);release();await pending;assert.equal(events[1].type,'foreground-rgba-ready');
});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
test('foreground cancellation waits late runtime and asynchronous cleanup, ignoring stale jobs',async()=>{
 const ready=deferred(),closing=deferred(),closed=deferred(),events=[];let estimates=0,closes=0;
 const handle=createForegroundWorkerHandler({createRuntime:()=>ready.promise,postMessage:e=>events.push(e)}),done=handle(command());
 await handle({type:'cancel-foreground',jobId:'stale'});await handle({type:'cancel-foreground',jobId:'test'});assert.deepEqual(events,[]);
 ready.resolve({estimate(){estimates++;},async close(){closes++;closing.resolve();await closed.promise;}});await closing.promise;assert.deepEqual(events,[]);closed.resolve();await done;
 assert.equal(estimates,0);assert.equal(closes,1);assert.deepEqual(events,[{type:'foreground-cancelled',jobId:'test'}]);
});
test('queued cancel from synchronous estimate suppresses output after cleanup',async()=>{
 const events=[],order=[];let handle;
 handle=createForegroundWorkerHandler({createRuntime:async()=>({estimate(){order.push('estimate');queueMicrotask(()=>void handle({type:'cancel-foreground',jobId:'test'}));return {width:2,height:1,foreground:new Float32Array(6),background:new Float32Array(6)};},close(){order.push('close');}}),postMessage:e=>{order.push('post');events.push(e);}});
 await handle(command());assert.deepEqual(order,['estimate','close','post']);assert.deepEqual(events,[{type:'foreground-cancelled',jobId:'test'}]);
});
test('foreground cancellation with failed cleanup never returns a success acknowledgement',async()=>{
 const ready=deferred(),events=[];const handle=createForegroundWorkerHandler({createRuntime:()=>ready.promise,postMessage:e=>events.push(e)}),done=handle(command());await handle({type:'cancel-foreground',jobId:'test'});ready.resolve({close(){throw Error('private');}});await done;
 assert.deepEqual(events,[{type:'error',jobId:'test',code:'foreground-worker-failed'}]);await handle({type:'cancel-foreground',jobId:'test'});assert.equal(events.at(-1).type,'error');
});
test('cooperative foreground client holds shared gate until cancelled runtime closes',async()=>{
 const {createForegroundWorkerClient}=await import('../tools/browser-library-adapter/foreground-worker-client.mjs');
 const {createWorkerGate}=await import('../tools/browser-library-adapter/worker-gate.mjs');
 const gate=createWorkerGate(),ready=deferred(),closing=deferred(),closed=deferred(),listeners=new Map(),order=[];
 const handle=createForegroundWorkerHandler({createRuntime:()=>ready.promise,postMessage:event=>queueMicrotask(()=>listeners.get('message')?.({data:event}))});
 const client=createForegroundWorkerClient({gate,rgba:true,cancellationProtocol:'cooperative-foreground-cancel-v1',createWorker:()=>({addEventListener:(t,f)=>listeners.set(t,f),removeEventListener:t=>listeners.delete(t),postMessage:c=>queueMicrotask(()=>void handle(c)),terminate(){order.push('terminate');}})});
 const controller=new AbortController(),pending=client.estimate(input(),{signal:controller.signal}),rejected=assert.rejects(pending,e=>e.code==='aborted');await Promise.resolve();controller.abort();
 ready.resolve({async close(){closing.resolve();await closed.promise;order.push('closed');}});await closing.promise;assert.equal(gate.getState().busy,true);assert.deepEqual(order,[]);closed.resolve();await rejected;
 assert.deepEqual(order,['closed','terminate']);assert.equal(gate.getState().busy,false);assert.equal(gate.getState().blocked,false);
});
