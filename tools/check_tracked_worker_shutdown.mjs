/** Real Node lifecycle proof for UI intent tracking; synthetic protocol only, no model execution. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createOperationTracker} from './browser-library-adapter/operation-tracker.mjs';
import {createTrackedOperation} from './browser-library-adapter/tracked-operation.mjs';
import {createWorkerClient} from './browser-library-adapter/worker-client.mjs';
import {createWorkerGate} from './browser-library-adapter/worker-gate.mjs';
import {nodeTaskWorker} from '../tests/fixtures/node-export-worker.mjs';
const [output]=process.argv.slice(2);if(!output||fs.existsSync(output))throw Error('Need new private report');
const tracker=createOperationTracker(),gate=createWorkerGate();let created=0,stopped=0,fail=false,cancelMode=false;const snapshots=[];
const client=createWorkerClient({gate,createWorker:()=>{
 created++;const worker=nodeTaskWorker(new URL('../tests/fixtures/inference-lifecycle-thread.mjs',import.meta.url),{fail},16);
 return {...worker,async terminate(){const value=await worker.terminate();stopped++;return value;}};
}});
tracker.subscribe(state=>{snapshots.push({phase:state?.phase??'idle',created,stopped,controllerBusy:op.getState().busy});});
const op=createTrackedOperation({tracker,gate,describe:()=>({kind:'inference',key:{inputId:'fixture',inferenceRevision:1,modelVersion:'synthetic-only'}}),
 run:async handle=>{
  const pending=client.request({type:'prepare',model:'hr',modelVersion:'synthetic-only',source:{mode:'library-resources',resources:[]}});
  handle.setWorker(client.getState().workerId);await pending;
  if(!cancelMode){await client.request({type:'dispose'});handle.setWorker(null);}
  return {ready:true};
 },cancelOwned:()=>client.cancel(),
});
try{
 assert.equal((await op.start()).status,'completed');assert.equal(created,stopped);
 cancelMode=true;const pending=op.start();await Promise.resolve();const cancelling=op.cancel();assert.equal(tracker.getSnapshot().phase,'cancelling');
 await cancelling;assert.deepEqual(await pending,{status:'cancelled'});assert.equal(created,stopped);assert.equal(tracker.getSnapshot(),null);
 cancelMode=false;fail=true;await assert.rejects(op.start(),e=>e.code==='operation-failed');assert.equal(created,stopped);assert.equal(tracker.getSnapshot(),null);
}finally{await client.cancel();}
assert.equal(created,3);assert.equal(stopped,3);
const idle=snapshots.filter(s=>s.phase==='idle');assert.equal(idle.length,3);assert.ok(idle.every(s=>s.created===s.stopped&&!s.controllerBusy));
const report={status:'passed',workersCreated:created,workersStopped:stopped,idlePublishedOnlyAfterTermination:true,cancelPhaseHeld:true,failureCleanupAwaited:true,finalOperation:op.getState(),finalGate:gate.getState(),snapshots,scope:'Protocol-only synthetic prepare/dispose/error, no weights/session/tensors/GPU or inference',limits:['UI intent/controller binding candidate; actual DOM/browser and production session untested','Node actual termination Promise does not prove browser physical memory reclamation','Heap settings are requested, not total memory caps']};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
