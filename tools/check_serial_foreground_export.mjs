/** Domain integration with synthetic model protocol and real CPU WASM/PNG workers. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createSerialInference} from './browser-library-adapter/serial-inference.mjs';
import {createInferenceOperation} from './browser-library-adapter/inference-operation.mjs';
import {createAlphaCommitter} from './browser-library-adapter/alpha-commit.mjs';
import {createImageRegistry} from './browser-library-adapter/image-registry.mjs';
import {createWorkerGate} from './browser-library-adapter/worker-gate.mjs';
import {createForegroundWorkerClient} from './browser-library-adapter/foreground-worker-client.mjs';
import {createExportWorkerClient} from './browser-library-adapter/export-worker-client.mjs';
import {createExportJobs} from './browser-library-adapter/export-job.mjs';
import {nodeTaskWorker,nodeExportWorker} from '../tests/fixtures/node-export-worker.mjs';
const [wasm,referencePath,backgroundPath,dependencyRoot,output]=process.argv.slice(2);
if(!output||fs.existsSync(output))throw Error('Need WASM REFERENCE BACKGROUNDS DEPENDENCIES NEW_OUTPUT');
const reference=JSON.parse(fs.readFileSync(referencePath)),backgrounds=JSON.parse(fs.readFileSync(backgroundPath));assert.equal(reference.status,'captured');assert.equal(reference.sourceSha256,'fd78cfb439940debc54c89a00638f025c0daef0bacc07fba393572787e9431ca');assert.equal(backgrounds.pillow,'12.3.0');
const row=reference.cases[0];assert.ok(row.width*row.height<=64);
const bytes=name=>Uint8Array.from(Buffer.from(row[name],'base64'));
const registry=createImageRegistry(),gate=createWorkerGate(),source=registry.register({width:row.width,height:row.height,format:'rgb-u8',data:bytes('rgbBase64').buffer},'session');
const key={inputId:'synthetic-input',inferenceRevision:1,modelVersion:'synthetic-protocol-only'},current={key,rgbAssetId:source.id,refine:false};let foreground=null,foregroundWorkers=0,exportWorkers=0,stopped=0;const events=[];let recoveryStarted;
const track=worker=>({...worker,async terminate(){await worker.terminate();stopped++;}});
const exporter=createExportWorkerClient({gate,createWorker(){exportWorkers++;return track(nodeExportWorker({dependencyRoot},16));}});
const committer=createAlphaCommitter({registry,getCurrent:()=>current});
const model={async request(command){events.push(command.type);if(command.type==='prepare'){assert.equal(gate.getState().busy,true);const count=exportWorkers;await assert.rejects(exporter.encode(registry.copy(source.id),{kind:'background'}),error=>error.code==='export-worker-busy');assert.equal(exportWorkers,count);return {type:'prepared'};}if(command.type==='dispose')return {type:'disposed'};assert.equal(command.type,'infer');return {type:'result',key:command.key,alpha:{width:row.width,height:row.height,layout:'alpha-u8',data:bytes('alphaBase64').buffer}};}};
const execute=createSerialInference({registry,client:model,prepareHr:{type:'prepare',model:'hr',modelVersion:key.modelVersion},recoverForeground:async(input,{workerGate})=>{
 assert.equal(events.at(-1),'dispose');foreground=createForegroundWorkerClient({rgba:true,gate:workerGate,createWorker(){foregroundWorkers++;return track(nodeTaskWorker(new URL('../tests/fixtures/foreground-protocol-thread.mjs',import.meta.url),{wasm,maxMemoryBytes:131072},16));}});
 try{const pending=foreground.estimate(input);recoveryStarted?.();return await pending;}finally{await foreground.close();foreground=null;}
}});
const operation=createInferenceOperation({execute,committer,gate,getCurrent:()=>current,cancelOwned:async()=>{await foreground?.close();}});
const jobs=createExportJobs({registry,getCurrent:()=>{const record=committer.get();return record?.status==='valid'?{assetId:record.cutout.id,dependencyKey:JSON.stringify(record.key)}:null;},encode:exporter.encode});
const {decode}=await import(pathToFileURL(path.join(dependencyRoot,'node_modules/fast-png/lib/index.js')));
const cases=[];
try{
 const accepted=await operation.start();assert.equal(accepted.status,'committed');assert.ok(accepted.cutout);assert.equal(gate.getState().busy,false);assert.equal(stopped,1);
 assert.deepEqual(new Uint8Array(registry.copy(accepted.cutout.id).data),bytes('rgbaBase64'));assert.deepEqual(new Uint8Array(registry.copy(accepted.image.id).data),bytes('alphaBase64'));
 const transparent=await jobs.start({kind:'transparent'});assert.equal(transparent.status,'ready');assert.deepEqual(new Uint8Array(decode(transparent.file.bytes).data),bytes('rgbaBase64'));
 for(const item of backgrounds.cases){const options={kind:'background',backgroundColor:item.color},result=await jobs.start(options);assert.equal(result.status,'ready');assert.deepEqual(new Uint8Array(decode(result.file.bytes).data),Uint8Array.from(Buffer.from(item.rgbBase64,'base64')));assert.ok(jobs.getReady(options));cases.push(item.color);}
 assert.equal(jobs.getReady({kind:'background',backgroundColor:backgrounds.cases[0].color}),null);assert.equal(foregroundWorkers,1);assert.equal(exportWorkers,4);assert.equal(stopped,5);assert.deepEqual(events,['prepare','infer','dispose']);assert.deepEqual(new Uint8Array(registry.copy(source.id).data),bytes('rgbBase64'));
 let started;const startedPromise=new Promise(resolve=>{started=resolve;});recoveryStarted=started;current.key={...key,inferenceRevision:2};
 const cancelled=operation.start();await startedPromise;await operation.cancel();assert.equal((await cancelled).status,'cancelled');assert.equal(committer.get().cutout.id,accepted.cutout.id);assert.equal(committer.get().status,'stale');assert.equal(stopped,6);assert.equal(gate.getState().busy,false);
 recoveryStarted=null;const recovered=await operation.start();assert.equal(recovered.status,'committed');assert.notEqual(recovered.cutout.id,accepted.cutout.id);assert.equal(stopped,7);
 current.key={...key,inferenceRevision:3};recoveryStarted=()=>{current.key={...key,inferenceRevision:4};};
 assert.equal((await operation.start()).status,'stale');assert.equal(committer.get().cutout.id,recovered.cutout.id);assert.equal(stopped,8);assert.equal(foregroundWorkers,4);assert.equal(gate.getState().busy,false);

}finally{jobs.clear();await operation.cancel();await exporter.close();committer.close();registry.release(source.id,'session');}
assert.equal(gate.getState().busy,false);
const report={status:'passed',scope:'Synthetic model protocol, real foreground WASM and PNG workers through existing serial operation/commit/export jobs',modelExecuted:false,modelProtocol:events,foregroundWorkers,exportWorkers,workersStopped:stopped,backgroundsExact:cases,transparentPngExact:true,alphaAndCutoutCommitted:true,overlapRejectedDuringModelPhase:true,oldColorReadyFileRefused:true,originalRgbPreserved:true,gateReleased:true,cancelDuringRealRecoveryDiscarded:true,freshOperationAfterCancelCommitted:true,revisionChangedDuringRealRecoveryDiscarded:true,limits:['No actual HR/ViTMatte model or trimap executed','Node workers only; visible app/browser/CSP and full-size acceptance remain','No GPU/model/browser startup; not original goal completion']};fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
