import test from 'node:test';
import assert from 'node:assert/strict';
import {createImageRegistry} from '../tools/browser-library-adapter/image-registry.mjs';
import {createImageRenderJob} from '../tools/browser-library-adapter/image-render-job.mjs';
import {createResizeWorkerClient} from '../tools/browser-library-adapter/resize-worker-client.mjs';
import {createPaperWorkerClient} from '../tools/browser-library-adapter/paper-worker-client.mjs';
import {createWorkerGate} from '../tools/browser-library-adapter/worker-gate.mjs';
import {createOperationTracker} from '../tools/browser-library-adapter/operation-tracker.mjs';
import {createTrackedOperation} from '../tools/browser-library-adapter/tracked-operation.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
for(const kind of ['resize','paper'])for(const cancelled of [false,true]){
 test(`${kind} shutdown failure holds tracked intent (${cancelled?'cancel':'worker error'})`,async()=>{
  const shutdown=deferred(),started=deferred();let worker,created=0,terminations=0;
  class Worker extends EventTarget{
   postMessage(){started.resolve();}
   terminate(){terminations++;return shutdown.promise;}
  }
  const gate=createWorkerGate(),createWorker=()=>{created++;return worker=new Worker();};
  const client=kind==='resize'?createResizeWorkerClient({createWorker,gate}):createPaperWorkerClient({createWorker,gate});
  const registry=createImageRegistry(),source=registry.register({width:1,height:1,format:'rgb-u8',data:Uint8Array.of(3,5,7).buffer},'session');
  const tracker=createOperationTracker({createId:()=> 'owned-intent'}),states=[];
  tracker.subscribe(value=>states.push(value));
  const render=createImageRenderJob({registry,getCurrent:()=>({assetId:source.id,dependencyKey:'revision',settings:{}}),
   prepare:()=>({options:kind==='resize'?{width:1,height:1}:{paper:'l'},output:kind==='resize'?{width:1,height:1}:{width:1500,height:1051}}),
   render:(image,options,hooks)=>kind==='resize'?client.resize(image,options,hooks):client.render(image,options,hooks)});
  const operation=createTrackedOperation({tracker,gate,describe:()=>({kind,sourceAssetId:source.id,dependencyKey:'revision'}),run:()=>render.start(),cancelOwned:()=>render.cancel()});
  const pending=operation.start(),failure=assert.rejects(pending,e=>e.code==='operation-stop-failed'&&e.message==='operation-stop-failed');
  await started.promise;
  let cancellation;
  if(cancelled)cancellation=assert.rejects(operation.cancel(),e=>e.code==='operation-stop-failed');
  else worker.dispatchEvent(new Event('error'));
  // Termination remains pending: source and intent must remain owned.
  await Promise.resolve();await Promise.resolve();
  assert.equal(gate.getState().busy,true);assert.equal(render.getState().busy,true);
  assert.equal(tracker.getSnapshot().operationId,'owned-intent');
  shutdown.reject(Error('private driver message'));await failure;if(cancellation)await cancellation;
  assert.equal(terminations,1);assert.equal(created,1);
  assert.equal(gate.getState().blocked,true);assert.equal(client.getState().blocked,true);assert.equal(render.getState().blocked,true);
  assert.equal(operation.getState().blocked,true);assert.equal(tracker.getSnapshot().phase,'cancelling');
  assert.equal(states.includes(null),false);assert.equal(render.get(),null);
  assert.deepEqual([...new Uint8Array(registry.copy(source.id).data)],[3,5,7]);
  await assert.rejects(operation.start(),e=>e.code==='operation-unavailable');
  await assert.rejects(render.start(),e=>e.code==='render-unavailable');
  const other=createResizeWorkerClient({createWorker,gate});
  await assert.rejects(other.resize(registry.copy(source.id),{width:1,height:1}),e=>e.code==='resize-worker-unavailable');
  assert.equal(created,1);await other.close();await render.close();await client.close();
 });
}
