import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createForegroundWorkerClient} from './browser-library-adapter/foreground-worker-client.mjs';
import {createWorkerGate} from './browser-library-adapter/worker-gate.mjs';
import {nodeTaskWorker} from '../tests/fixtures/node-export-worker.mjs';
const [wasm,referencePath,output,browserBundle]=process.argv.slice(2);
if(!output||fs.existsSync(output))throw Error('Need WASM REFERENCE_JSON NEW_OUTPUT');
const reference=JSON.parse(fs.readFileSync(referencePath,'utf8'));
assert.equal(reference.status,'captured');assert.equal(reference.sourceSha256,'fd78cfb439940debc54c89a00638f025c0daef0bacc07fba393572787e9431ca');
let created=0,stopped=0;const proofs=[];const gate=createWorkerGate(),client=createForegroundWorkerClient({gate,createWorker(){created++;const worker=nodeTaskWorker(new URL(browserBundle?'../tests/fixtures/browser-export-thread.mjs':'../tests/fixtures/foreground-protocol-thread.mjs',import.meta.url),browserBundle?{browserBundle,allowWasm:true}:{wasm,maxMemoryBytes:131072},16,proof=>proofs.push(proof));return {...worker,async terminate(){const result=await worker.terminate();stopped++;return result;}};}});
const cases=[];
const input=row=>({width:row.width,height:row.height,rgb:Float32Array.from(row.inputRgb),alpha:Float32Array.from(row.inputAlpha)});
try{
 for(const row of reference.cases){
  assert.ok(row.width*row.height<=64);
  if(row.status==='reference-exception')continue;
  const source=input(row),rgb=source.rgb.slice(),alpha=source.alpha.slice(),pending=client.estimate(source);
  assert.equal(source.rgb.byteLength,0);assert.equal(source.alpha.byteLength,0);
  const result=await pending;assert.deepEqual(result.foreground,Float32Array.from(row.foreground));assert.deepEqual(result.background,Float32Array.from(row.background));assert.equal(created,stopped);assert.equal(gate.getState().busy,false);
  // Caller-owned source copies, rather than transferred job buffers, remain reusable.
  assert.deepEqual(rgb,Float32Array.from(row.inputRgb));assert.deepEqual(alpha,Float32Array.from(row.inputAlpha));cases.push(row.name);
 }
 const before=created;
 await assert.rejects(client.estimate({width:1,height:1,rgb:new Float32Array(3),alpha:new Float32Array(1)}),error=>error.code==='invalid-foreground-input');assert.equal(created,before);
 await assert.rejects(client.estimate({width:100,height:30,rgb:new Float32Array(9000),alpha:new Float32Array(3000)}),error=>error.code==='foreground-worker-failed');assert.equal(created,stopped);
 const row=reference.cases.find(row=>row.status!=='reference-exception');
 const recovered=await client.estimate(input(row));assert.deepEqual(recovered.foreground,Float32Array.from(row.foreground));assert.equal(created,stopped);
 const controller=new AbortController(),cancelled=client.estimate(input(row),{signal:controller.signal});controller.abort('private');await assert.rejects(cancelled,error=>error.code==='aborted');assert.equal(created,stopped);assert.equal(gate.getState().busy,false);
}finally{await client.close();}
assert.equal(created,stopped);
if(browserBundle){assert.ok(proofs.length>=6);assert.ok(proofs.every(proof=>proof.nodeGlobalsAbsent&&proof.dynamicCodeDisabled&&proof.networkAttempts===0&&proof.wasmCompiles===1));}
const report={browserBundle:!!browserBundle,sandboxProofs:proofs,status:'passed',casesByteExact:cases,workersCreated:created,workersStopped:stopped,transferDetached:true,invalidInputBeforeWorker:true,budgetFailureThenFreshWorkerRecovery:true,abortTerminationAwaited:true,sharedGateReleased:true,threadOldGenerationMiB:16,limits:['Node worker_threads with existing EventTarget facade, not native browser Worker/CSP acceptance','Tiny synthetic saved-JIT data only; no full-size quality/resource acceptance','16MiB heap request and WASM growth cap are not process RAM caps','No model/GPU/browser started; app integration still pending']};fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
