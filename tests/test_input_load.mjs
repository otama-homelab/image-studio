import test from 'node:test';
import assert from 'node:assert/strict';
import {createInputLoad} from '../tools/browser-library-adapter/input-load.mjs';
import {createOperationTracker} from '../tools/browser-library-adapter/operation-tracker.mjs';
import {createImageRegistry} from '../tools/browser-library-adapter/image-registry.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const pixel=n=>({width:1,height:1,format:'rgb-u8',data:Uint8Array.of(n,2,3).buffer});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(tracker){const registry=createImageRegistry(),calls=[];const owner=createInputLoad({registry,tracker,read:(file,hooks)=>{const work=deferred();calls.push({file,hooks,work});return work.promise;}});return {registry,calls,owner};}
test('ready input owns metadata, failed replacement preserves previous pixels',async()=>{
 const f=setup(),first=f.owner.load('first');await tick();f.calls[0].work.resolve(pixel(1));const ready=await first;assert.equal('data' in ready.input.image,false);
 const failed=f.owner.load('broken');await tick();const rejected=assert.rejects(failed,e=>e.code==='input-load-failed'&&e.message==='input-load-failed');f.calls[1].work.reject(Error('private file'));await rejected;
 assert.equal(f.owner.get(),ready.input);assert.deepEqual([...new Uint8Array(f.registry.copy(ready.input.image.id).data)],[1,2,3]);await f.owner.close();assert.throws(()=>f.registry.get(ready.input.image.id));
});
test('newest selection alone starts after old decoder terminal; old output is not consumed',async()=>{
 const f=setup(),first=f.owner.load('first');await tick();const skipped=f.owner.load('skip'),latest=f.owner.load('latest');assert.equal(f.calls[0].hooks.signal.aborted,true);assert.equal(f.calls.length,1);
 const old=pixel(7);f.calls[0].work.resolve(old);assert.equal((await first).status,'superseded');assert.equal((await skipped).status,'superseded');await tick();assert.equal(f.calls.length,2);assert.equal(f.calls[1].file,'latest');assert.equal(old.data.byteLength,3);
 f.calls[1].work.resolve(pixel(9));const ready=await latest;assert.equal(new Uint8Array(f.registry.copy(ready.input.image.id).data)[0],9);await f.owner.close();
});
test('successful replacement releases old image but respects downstream retain',async()=>{
 const f=setup(),first=f.owner.load('first');await tick();f.calls[0].work.resolve(pixel(1));const old=(await first).input;f.registry.retain(old.image.id,'crop');
 const next=f.owner.load('next');await tick();f.calls[1].work.resolve(pixel(4));const current=(await next).input;assert.notEqual(current.inputId,old.inputId);assert.ok(f.registry.get(old.image.id));f.registry.release(old.image.id,'crop');assert.throws(()=>f.registry.get(old.image.id));await f.owner.close();
});
test('cancel waits for terminal and prevents adoption',async()=>{
 const f=setup(),pending=f.owner.load('first');await tick();let finished=false;const cancellation=f.owner.cancel().then(()=>{finished=true;});await tick();assert.equal(finished,false);assert.equal(f.owner.getState().cancelling,true);f.calls[0].work.resolve(pixel(2));await cancellation;assert.equal((await pending).status,'superseded');assert.equal(f.owner.get(),null);await f.owner.close();
});
test('stop failure blocks queued replacement and owner reuse',async()=>{
 const f=setup(),first=f.owner.load('first');await tick();const replacement=f.owner.load('next');const a=assert.rejects(first,e=>e.code==='input-stop-failed'),b=assert.rejects(replacement,e=>e.code==='input-stop-failed');f.calls[0].work.reject(Object.assign(Error('private'),{code:'jpeg-input-worker-stop-failed'}));await a;await b;assert.equal(f.owner.getState().blocked,true);assert.equal(f.calls.length,1);await assert.rejects(f.owner.load('third'),e=>e.code==='input-unavailable');await f.owner.close();
});

test('all close callers share the same decoder termination wait',async()=>{
 const f=setup(),pending=f.owner.load('first');await tick();const first=f.owner.close(),second=f.owner.close();assert.equal(first,second);let closed=false;second.then(()=>{closed=true;});await tick();assert.equal(closed,false);assert.equal(f.calls[0].hooks.signal.aborted,true);f.calls[0].work.resolve(pixel(3));await first;assert.equal((await pending).status,'superseded');assert.equal(f.owner.get(),null);
});

test('decode tracker carries IDs only and stays cancelling until terminal',async()=>{
 const tracker=createOperationTracker(),f=setup(tracker),seen=[];tracker.subscribe(state=>seen.push(state));const pending=f.owner.load('private-filename');await tick();const state=tracker.getSnapshot();assert.equal(state.kind,'decode');assert.deepEqual(Object.keys(state).sort(),['kind','operationId','phase','selectionId']);assert.equal(JSON.stringify(state).includes('private'),false);const stopped=f.owner.cancel();assert.equal(tracker.getSnapshot().phase,'cancelling');f.calls[0].work.resolve(pixel(2));await stopped;await pending;assert.equal(tracker.getSnapshot(),null);assert.deepEqual(seen.map(s=>s?.phase??'idle'),['running','cancelling','idle']);await f.owner.close();
});
test('synchronous tracker cancellation prevents decoder creation',async()=>{
 const tracker=createOperationTracker(),f=setup(tracker);tracker.subscribe(state=>{if(state?.phase==='running')void f.owner.cancel();});assert.equal((await f.owner.load('file')).status,'superseded');assert.equal(f.calls.length,0);assert.equal(tracker.getSnapshot(),null);await f.owner.close();
});
test('decoder termination failure retains cancelling tracker metadata',async()=>{
 const tracker=createOperationTracker(),f=setup(tracker),pending=f.owner.load('file');await tick();const failed=assert.rejects(pending,e=>e.code==='input-stop-failed');f.calls[0].work.reject(Object.assign(Error('private'),{code:'png-input-worker-stop-failed'}));await failed;assert.equal(tracker.getSnapshot().phase,'cancelling');assert.equal(f.owner.getState().blocked,true);await f.owner.close();assert.equal(tracker.getSnapshot().phase,'cancelling');
});
test('another tracked operation prevents decode without clearing its metadata',async()=>{
 const tracker=createOperationTracker(),other=tracker.begin({kind:'export',sourceAssetId:'source',dependencyKey:'current'}),f=setup(tracker);await assert.rejects(f.owner.load('file'),e=>e.code==='input-load-failed');assert.equal(f.calls.length,0);assert.equal(tracker.getSnapshot().operationId,other.operationId);await f.owner.close();other.finish();
});
