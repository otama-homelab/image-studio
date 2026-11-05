import test from 'node:test';
import assert from 'node:assert/strict';
import {createInferenceOperation} from '../tools/browser-library-adapter/inference-operation.mjs';
const context=()=>({key:{inputId:'input-1',inferenceRevision:1,modelVersion:'set-1'},rgbAssetId:'image-1',refine:true});
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve:v=>resolve(v)};};
function setup({execute,cancelOwned}={}){
 let current=context(),stops=0;const commits=[];
 const operation=createInferenceOperation({execute:execute??(async c=>({key:c.key})),cancelOwned:cancelOwned??(()=>{stops++;}),getCurrent:()=>current,committer:{commit:r=>{commits.push(r);return {status:'committed'};}}});
 return {operation,commits,stops:()=>stops,setCurrent:c=>{current=c;}};
}
test('cancel rejects registration even when input key remains unchanged',async()=>{
 const work=deferred(),f=setup({execute:()=>work.promise}),pending=f.operation.start();
 await f.operation.cancel();work.resolve({key:context().key});assert.equal((await pending).status,'cancelled');assert.equal(f.commits.length,0);
});
test('old operation completion cannot cancel or commit over a newer operation',async()=>{
 const first=deferred(),second=deferred();let calls=0;
 const f=setup({execute:()=>calls++===0?first.promise:second.promise});
 const old=f.operation.start();await f.operation.cancel();const fresh=f.operation.start();
 first.resolve({key:context().key});assert.equal((await old).status,'cancelled');
 assert.equal(f.operation.getState().running,true);assert.equal(f.stops(),1);
 second.resolve({key:context().key});assert.equal((await fresh).status,'committed');assert.equal(f.commits.length,1);
});
test('new operations are refused while asynchronous resource shutdown is pending',async()=>{
 const release=deferred(),work=deferred(),f=setup({execute:()=>work.promise,cancelOwned:()=>release.promise});
 const pending=f.operation.start(),stop=f.operation.cancel();assert.equal(f.operation.getState().stopping,true);
 await assert.rejects(f.operation.start(),e=>e.code==='operation-stopping');
 release.resolve();await stop;work.resolve({});assert.equal((await pending).status,'cancelled');
});
test('changed domain context is stale and does not reach commit',async()=>{
 const work=deferred(),f=setup({execute:()=>work.promise}),pending=f.operation.start();
 f.setCurrent({...context(),key:{...context().key,inferenceRevision:2}});work.resolve({key:context().key});
 assert.equal((await pending).status,'stale');assert.equal(f.commits.length,0);assert.equal(f.stops(),1);
});
test('pipeline failures are fixed errors; failed resource shutdown blocks reuse',async()=>{
 const f=setup({execute:async()=>{throw Error('private model payload');}});
 await assert.rejects(f.operation.start(),e=>e.code==='runtime-error'&&e.message==='runtime-error');assert.equal(f.stops(),1);
 const broken=setup({cancelOwned:async()=>{throw Error('private release payload');}});
 await assert.rejects(broken.operation.cancel(),e=>e.code==='operation-stop-failed');
 await assert.rejects(broken.operation.start(),e=>e.code==='operation-unavailable');
});
test('execution gets frozen metadata and a live intent predicate, with no implicit queue',async()=>{
 const work=deferred();let snapshot,predicate;
 const f=setup({execute:(c,hooks)=>{snapshot=c;predicate=hooks.isCurrent;return work.promise;}});
 const pending=f.operation.start();assert.ok(Object.isFrozen(snapshot));assert.ok(Object.isFrozen(snapshot.key));assert.equal(predicate(),true);
 await assert.rejects(f.operation.start(),e=>e.code==='operation-busy');await f.operation.cancel();assert.equal(predicate(),false);
 work.resolve({});await pending;
});

test('shutdown failure on stale completion is reported rather than hidden as cancellation',async()=>{
 const work=deferred(),f=setup({execute:()=>work.promise,cancelOwned:async()=>{throw Error('private shutdown');}});
 const pending=f.operation.start();f.setCurrent({...context(),key:{...context().key,inferenceRevision:2}});work.resolve({});
 await assert.rejects(pending,e=>e.code==='operation-stop-failed');assert.equal(f.operation.getState().blocked,true);
});

test('failure from an obsolete domain context is discarded instead of shown for current settings',async()=>{
 let reject;const work=new Promise((_,r)=>{reject=r;}),f=setup({execute:()=>work}),pending=f.operation.start();
 f.setCurrent({...context(),key:{...context().key,inferenceRevision:2}});reject(Error('private old failure'));
 assert.equal((await pending).status,'stale');assert.equal(f.stops(),1);assert.equal(f.commits.length,0);
});
