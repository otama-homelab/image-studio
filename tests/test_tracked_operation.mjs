import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationTracker} from '../tools/browser-library-adapter/operation-tracker.mjs';
import {createTrackedOperation} from '../tools/browser-library-adapter/tracked-operation.mjs';
const deferred=()=>{let resolve,reject;return {promise:new Promise((a,b)=>{resolve=a;reject=b;}),resolve:v=>resolve(v),reject:e=>reject(e)};};
function setup(){let id=0;const tracker=createOperationTracker({createId:()=>`intent-${++id}`}),work=deferred(),shutdown=deferred();let runs=0,stops=0;
 const op=createTrackedOperation({tracker,describe:()=>({kind:'resize',sourceAssetId:'source',dependencyKey:'crop-1'}),run:()=>{runs++;return work.promise;},cancelOwned:()=>{stops++;return shutdown.promise;}});
 return {tracker,work,shutdown,op,get runs(){return runs;},get stops(){return stops;}};
}
test('normal completion retains only metadata and finishes the current intent',async()=>{
 const f=setup(),pending=f.op.start();assert.equal(f.tracker.getSnapshot().phase,'running');f.work.resolve({imageId:'result'});
 assert.deepEqual(await pending,{status:'completed',value:{imageId:'result'}});assert.equal(f.tracker.getSnapshot(),null);assert.equal(f.stops,0);
});
test('cancel waits for shutdown even if execution returns earlier; next intent stays blocked',async()=>{
 const f=setup(),pending=f.op.start();await Promise.resolve();const cancelled=f.op.cancel();f.work.resolve({imageId:'late'});
 await Promise.resolve();assert.equal(f.tracker.getSnapshot().phase,'cancelling');assert.equal(f.op.getState().busy,true);await assert.rejects(f.op.start(),e=>e.code==='operation-busy');
 f.shutdown.resolve();await cancelled;assert.deepEqual(await pending,{status:'cancelled'});assert.equal(f.tracker.getSnapshot(),null);assert.equal(f.stops,1);
});
test('shutdown failure keeps cancelling metadata and prevents reuse',async()=>{
 const f=setup(),pending=f.op.start();await Promise.resolve();const cancelled=f.op.cancel(),cancelError=assert.rejects(cancelled,e=>e.code==='operation-stop-failed');
 f.shutdown.reject(Error('private'));await cancelError;f.work.resolve({});await assert.rejects(pending,e=>e.code==='operation-stop-failed');
 assert.equal(f.tracker.getSnapshot().phase,'cancelling');assert.equal(f.op.getState().blocked,true);await assert.rejects(f.op.start(),e=>e.code==='operation-unavailable');
});
test('synchronous observer cancellation before run prevents resource creation',async()=>{
 const f=setup();f.tracker.subscribe(state=>{if(state?.phase==='running')void f.op.cancel();});
 assert.deepEqual(await f.op.start(),{status:'cancelled'});assert.equal(f.runs,0);assert.equal(f.stops,0);assert.equal(f.tracker.getSnapshot(),null);
});
test('run errors use fixed codes and still await cleanup',async()=>{
 const f=setup(),pending=f.op.start();f.work.reject(Error('private'));await Promise.resolve();await Promise.resolve();f.shutdown.resolve();
 await assert.rejects(pending,e=>e.code==='operation-failed'&&e.message==='operation-failed');assert.equal(f.tracker.getSnapshot(),null);assert.equal(f.stops,1);
});
test('a run that leaves resources active is cleaned up and cannot publish completion',async()=>{
 const tracker=createOperationTracker({createId:()=> 'held-intent'});let busy=false,stops=0;
 const op=createTrackedOperation({tracker,gate:{getState:()=>({busy,blocked:false})},describe:()=>({kind:'paper',sourceAssetId:'source',dependencyKey:'paper-1'}),run:async()=>{busy=true;return {};},cancelOwned:async()=>{stops++;busy=false;}});
 await assert.rejects(op.start(),e=>e.code==='operation-failed');assert.equal(stops,1);assert.equal(tracker.getSnapshot(),null);assert.equal(busy,false);
});
test('idle notification may start the next operation without an old completion clearing it',async()=>{
 const f=setup();let next;const observed=[];
 const unsubscribe=f.tracker.subscribe(state=>{if(!state){observed.push(f.op.getState().busy);if(!next)next=f.op.start();}});
 const first=f.op.start();f.work.resolve({imageId:'ready'});assert.equal((await first).status,'completed');assert.equal((await next).status,'completed');
 unsubscribe();assert.deepEqual(observed,[false,false]);assert.equal(f.runs,2);assert.equal(f.tracker.getSnapshot(),null);
});
test('shutdown may finish before an obsolete execution; its late completion cannot clear a new intent',async()=>{
 let sequence=0,runs=0;const tracker=createOperationTracker({createId:()=>`intent-${++sequence}`}),oldWork=deferred(),newWork=deferred(),shutdown=deferred();
 const op=createTrackedOperation({tracker,describe:()=>({kind:'resize',sourceAssetId:'source',dependencyKey:'same-key'}),run:()=>++runs===1?oldWork.promise:newWork.promise,cancelOwned:()=>shutdown.promise});
 const old=op.start();await Promise.resolve();const stopping=op.cancel();shutdown.resolve();await stopping;assert.equal(tracker.getSnapshot(),null);
 const next=op.start(),nextId=tracker.getSnapshot().operationId;oldWork.resolve({obsolete:true});assert.deepEqual(await old,{status:'cancelled'});assert.equal(tracker.getSnapshot().operationId,nextId);
 newWork.resolve({ready:true});assert.equal((await next).status,'completed');assert.equal(tracker.getSnapshot(),null);
});
