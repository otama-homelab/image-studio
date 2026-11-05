import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationTracker} from '../tools/browser-library-adapter/operation-tracker.mjs';
function tracker(){let id=0;return createOperationTracker({createId:()=>`intent-${++id}`});}
const pixel={kind:'resize',sourceAssetId:'source',dependencyKey:'revision-1'};
test('metadata is rebuilt without image bytes; snapshots remain stable until mutation',()=>{
 const t=tracker(),handle=t.begin({...pixel,data:new ArrayBuffer(100),privateLabel:'private'}),state=t.getSnapshot();
 assert.deepEqual(Object.keys(state).sort(),['dependencyKey','kind','operationId','phase','sourceAssetId']);assert.equal(state,t.getSnapshot());assert.ok(Object.isFrozen(state));assert.equal(handle.setWorker('not-for-pixel'),false);handle.finish();assert.equal(t.getSnapshot(),null);
});
test('inference worker transitions preserve the parent operation ID and immutable key snapshot',()=>{
 const t=tracker(),key={inputId:'input',inferenceRevision:1,modelVersion:'set-1'},h=t.begin({kind:'inference',key});key.inferenceRevision=2;
 h.setWorker('hr-worker');h.setWorker(null);assert.equal(t.getSnapshot().operationId,h.operationId);assert.equal(t.getSnapshot().key.inferenceRevision,1);
 h.setWorker('matte-worker');assert.equal(t.getSnapshot().workerId,'matte-worker');assert.ok(Object.isFrozen(t.getSnapshot().key));h.markCancelling();assert.equal(h.setWorker('late-worker'),false);assert.equal(t.getSnapshot().workerId,'matte-worker');h.finish();
});
test('cancel invalidates observers but retains active metadata until owner finishes',()=>{
 const t=tracker(),h=t.begin(pixel);h.markCancelling();assert.equal(h.isCurrent(),false);assert.equal(t.getSnapshot().phase,'cancelling');
 assert.throws(()=>t.begin(pixel),e=>e.code==='operation-busy');h.finish();const next=t.begin(pixel);assert.notEqual(next.operationId,h.operationId);
 assert.equal(h.finish(),false);assert.equal(h.markCancelling(),false);assert.equal(t.getSnapshot().operationId,next.operationId);next.finish();
});
test('observer exceptions/unsubscribe do not strand ownership or clear a newer intent',()=>{
 const t=tracker();let events=0;const unsubscribe=t.subscribe(()=>{events++;throw Error('private observer');});const h=t.begin(pixel);unsubscribe();h.finish();assert.equal(events,1);
 let next;const stop=t.subscribe(state=>{if(!state)next=t.begin(pixel);});const first=t.begin(pixel);first.finish();assert.equal(t.getSnapshot().operationId,next.operationId);assert.equal(first.finish(),false);stop();next.finish();
});
test('malformed descriptors and ID generator failures publish no state',()=>{
 const t=tracker();for(const d of [{...pixel,sourceAssetId:''},{kind:'other'}, {kind:'inference',key:{inputId:'a',modelVersion:'s',inferenceRevision:NaN}}])assert.throws(()=>t.begin(d),e=>e.code==='invalid-operation');assert.equal(t.getSnapshot(),null);
 const failed=createOperationTracker({createId:()=>{throw Error('private');}});assert.throws(()=>failed.begin(pixel),e=>e.code==='operation-id-unavailable'&&e.message==='operation-id-unavailable');assert.equal(failed.getSnapshot(),null);
});
