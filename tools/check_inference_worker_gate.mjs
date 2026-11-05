/** Actual Node thread shutdown for protocol-only synthetic preparation. Never loads models. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createWorkerClient} from './browser-library-adapter/worker-client.mjs';
import {createExportWorkerClient} from './browser-library-adapter/export-worker-client.mjs';
import {createWorkerGate} from './browser-library-adapter/worker-gate.mjs';
import {nodeTaskWorker} from '../tests/fixtures/node-export-worker.mjs';
const [output,mode]=process.argv.slice(2);const scoped=mode==='--scoped';if(!output||fs.existsSync(output))throw Error('Need new private report');
const gate=createWorkerGate(),pipelineLease=scoped?gate.tryAcquire():null,admission=pipelineLease?.createChildGate()??gate;let created=0,stopped=0,pixelCreates=0,fail=false;
const client=createWorkerClient({gate:admission,createWorker:()=>{
 created++;const worker=nodeTaskWorker(new URL('../tests/fixtures/inference-lifecycle-thread.mjs',import.meta.url),{fail},16);
 return {...worker,async terminate(){const result=await worker.terminate();stopped++;return result;}};
}}),pixels=createExportWorkerClient({gate,createWorker:()=>{pixelCreates++;throw Error('must not create while model worker owns gate');}});
const prep={type:'prepare',model:'hr',modelVersion:'synthetic-lifecycle-only',source:{mode:'library-resources',resources:[]}};
try{
 await client.request(prep);assert.equal(gate.getState().busy,true);
 await assert.rejects(pixels.encode({width:1,height:1,format:'rgb-u8',data:new ArrayBuffer(3)},{kind:'background'}),e=>e.code==='export-worker-busy');assert.equal(pixelCreates,0);
 await client.request({type:'dispose'});assert.equal(created,stopped);assert.equal(gate.getState().busy,scoped);assert.equal(admission.getState().busy,false);
 const pending=client.request(prep),rejected=assert.rejects(pending,e=>e.code==='aborted');await client.cancel();await rejected;assert.equal(created,stopped);
 fail=true;await assert.rejects(client.request(prep),e=>e.code==='runtime-error'&&e.message==='runtime-error');assert.equal(created,stopped);
}finally{await client.cancel();await pixels.close();pipelineLease?.release();}
assert.equal(created,3);assert.equal(stopped,3);assert.deepEqual(gate.getState(),{busy:false,blocked:false});
const report={pipelineLeaseHeldBetweenWorkers:scoped,status:'passed',workersCreated:created,workersStopped:stopped,pixelWorkersCreatedWhileOwned:pixelCreates,disposeTerminationAwaited:true,cancelTerminationAwaited:true,errorTerminationAwaited:true,finalGate:gate.getState(),scope:'Protocol-only preparation fixture; no weights, model sessions, GPU or inference executed',limits:['Node termination Promise proof, not actual browser termination/memory reclamation','Model/GPU lifecycle and A10 memory acceptance remain unverified','Application session/UI still must supply one shared gate','Requested 16MiB old-generation setting is not total process memory cap']};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
