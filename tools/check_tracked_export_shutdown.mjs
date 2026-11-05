/** Actual codec Worker -> export job -> owned save cancellation -> UI metadata. Tiny RGB only. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createImageRegistry} from './browser-library-adapter/image-registry.mjs';
import {createWorkerGate} from './browser-library-adapter/worker-gate.mjs';
import {createExportWorkerClient} from './browser-library-adapter/export-worker-client.mjs';
import {createExportJobs} from './browser-library-adapter/export-job.mjs';
import {createDownloadLinks} from './browser-library-adapter/download-links.mjs';
import {createSaveActions} from './browser-library-adapter/save-actions.mjs';
import {createOperationTracker} from './browser-library-adapter/operation-tracker.mjs';
import {createTrackedOperation} from './browser-library-adapter/tracked-operation.mjs';
import {nodeExportWorker} from '../tests/fixtures/node-export-worker.mjs';
const [dependencyRoot,output]=process.argv.slice(2);if(!output||fs.existsSync(output))throw Error('Need private dependencies and new report');
const registry=createImageRegistry(),asset=registry.register({width:1,height:1,format:'rgb-u8',data:Uint8Array.of(1,2,3).buffer},'session'),gate=createWorkerGate(),tracker=createOperationTracker();
let created=0,stopped=0;const snapshots=[];
const client=createExportWorkerClient({gate,createWorker:()=>{created++;const worker=nodeExportWorker({dependencyRoot},96);return {...worker,async terminate(){const value=await worker.terminate();stopped++;return value;}};}});
const jobs=createExportJobs({registry,getCurrent:()=>({assetId:asset.id,dependencyKey:'rgb-1'}),encode:client.encode}),links=createDownloadLinks({getReady:jobs.getReady}),control=createSaveActions({jobs,links,getOptions:()=>({kind:'background',format:'png'})});
const operation=createTrackedOperation({tracker,gate,describe:()=>({kind:'export',sourceAssetId:asset.id,dependencyKey:'rgb-1'}),run:()=>control.generate(),cancelOwned:()=>control.cancelAndWait()});
tracker.subscribe(state=>snapshots.push({phase:state?.phase??'idle',created,stopped,jobBusy:jobs.getState().busy,operationBusy:operation.getState().busy}));
try{
 assert.deepEqual(await operation.start(),{status:'completed',value:{status:'ready'}});assert.equal(created,stopped);
 const previous=jobs.getReady({kind:'background'});assert.ok(previous);assert.equal(control.getState().phase,'ready');
 const pending=operation.start();await Promise.resolve();const cancelling=operation.cancel();assert.equal(tracker.getSnapshot().phase,'cancelling');
 await cancelling;assert.deepEqual(await pending,{status:'cancelled'});assert.equal(created,stopped);assert.equal(jobs.getReady({kind:'background'}),previous);
 assert.deepEqual([...new Uint8Array(registry.copy(asset.id).data)],[1,2,3]);
}finally{control.close();links.close();await jobs.cancelAndWait();jobs.clear();await client.close();registry.release(asset.id,'session');}
const idle=snapshots.filter(s=>s.phase==='idle');assert.equal(idle.length,2);assert.ok(idle.every(s=>s.created===s.stopped&&!s.jobBusy&&!s.operationBusy));assert.equal(created,2);assert.equal(stopped,2);
const report={status:'passed',workersCreated:created,workersStopped:stopped,idleOnlyAfterTermination:true,oldValidFilePreserved:true,originalPreserved:true,urlsAfterClose:links.getState().urls,snapshots,limits:['Real PNG codec on Node threads with synthetic 1x1 RGB, not browser/UI acceptance','Worker failure tests are separate unit tests; no physical OOM/stop failure induced here','No model/GPU/browser initialized; heap setting is not total RAM cap']};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
