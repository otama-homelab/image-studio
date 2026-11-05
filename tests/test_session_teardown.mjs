import test from 'node:test';import assert from 'node:assert/strict';
import {createSessionTeardown} from '../tools/browser-library-adapter/session-teardown.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('invalidate and link removal are synchronous; operation/client/script/assets end in order',async()=>{
 const work=deferred(),client=deferred(),events=[];
 const owner=createSessionTeardown({invalidate:()=>events.push('invalidate'),closeLinks:()=>events.push('links'),stopOperations:[()=>{events.push('operation');return work.promise;}],closeClients:[()=>{events.push('client');return client.promise;}],closeScripts:[()=>events.push('script')],releaseAssets:()=>events.push('assets')});
 const closed=owner.close();assert.equal(closed,owner.close());assert.deepEqual(events,['invalidate','links']);await tick();assert.deepEqual(events,['invalidate','links','operation']);work.resolve();await tick();assert.deepEqual(events,['invalidate','links','operation','client']);assert.equal(owner.getState().phase,'closing');client.resolve();await closed;assert.deepEqual(events,['invalidate','links','operation','client','script','assets']);assert.equal(owner.getState().phase,'closed');assert.ok(Object.isFrozen(owner.getState()));
});
test('failed operation still closes every client/script, preserves assets and redacts errors',async()=>{
 const events=[];const owner=createSessionTeardown({invalidate(){},closeLinks(){},stopOperations:[async()=>{throw Error('private image');}],closeClients:[()=>events.push('client1'),async()=>{events.push('client2');throw Error('private driver');}],closeScripts:[()=>events.push('script')],releaseAssets:()=>events.push('assets')});
 await assert.rejects(owner.close(),e=>e.code==='session-stop-failed'&&e.message==='session-stop-failed');assert.deepEqual(events,['client1','client2','script']);assert.deepEqual(owner.getState().failedStages,['operations','clients']);assert.equal(owner.getState().phase,'failed');
});
test('invalidation failure cannot skip shutdown or claim session assets released',async()=>{
 const events=[];const owner=createSessionTeardown({invalidate(){throw Error('observer');},closeLinks:()=>events.push('links'),closeClients:[()=>events.push('client')],closeScripts:[()=>events.push('script')],releaseAssets:()=>events.push('assets')});await assert.rejects(owner.close());assert.deepEqual(events,['links','client','script']);assert.deepEqual(owner.getState().failedStages,['invalidate']);
});
test('reentrant close receives the same terminal promise and cleanup runs once',async()=>{
 let owner,reentrant,count=0;owner=createSessionTeardown({invalidate(){reentrant=owner.close();},closeLinks(){count++;},releaseAssets(){count++;}});const closed=owner.close();assert.equal(closed,reentrant);await closed;await owner.close();assert.equal(count,2);
});
