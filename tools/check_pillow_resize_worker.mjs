/** Real WASM resize on serial Node workers; owning threads always terminated and awaited. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createResizeWorkerClient} from './browser-library-adapter/resize-worker-client.mjs';
import {createImageRegistry} from './browser-library-adapter/image-registry.mjs';
import {nodeTaskWorker} from '../tests/fixtures/node-export-worker.mjs';
const [wasm,output,mode,browser256,browser128]=process.argv.slice(2);const bounded=mode==='--bounded-growth';if(!wasm||!output||fs.existsSync(output))throw Error('Need private WASM and new report');
const reference=JSON.parse(fs.readFileSync(new URL('../docs/browser/validation/2026-11-01-pillow-resize-reference-v2.json',import.meta.url),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex'),registry=createImageRegistry();
const pixels=Uint8Array.from(Buffer.from(reference.sourceRgbHex,'hex')),sourceSha=sha(pixels),asset=registry.register({width:7,height:5,format:'rgb-u8',data:pixels.buffer},'session');
let created=0,stopped=0,trap=false,maxMemoryBytes=262144;const memoryProofs=[];
const client=createResizeWorkerClient({createWorker:()=>{
 created++;
 const entry=browser256?'../tests/fixtures/browser-export-thread.mjs':'../tests/fixtures/resize-protocol-thread.mjs';
 const data=browser256?{browserBundle:maxMemoryBytes===131072?browser128:browser256,allowWasm:true,trap}:{wasm,trap,bounded,maxMemoryBytes,probeMemory:bounded};
 const worker=nodeTaskWorker(new URL(entry,import.meta.url),data,16,proof=>memoryProofs.push(proof));
 return {...worker,async terminate(){const result=await worker.terminate();stopped++;return result;}};
}}),cases=[];
const options=c=>({width:c.outputSize[0],height:c.outputSize[1],box:c.box??undefined});
try{
 for(const c of reference.cases){
  const copy=registry.copy(asset.id),pending=client.resize(copy,options(c));assert.equal(copy.data.byteLength,0);
  const result=await pending;assert.equal(sha(new Uint8Array(result.data)),c.sha256);assert.equal(created,stopped);assert.equal(client.getState().busy,false);
  cases.push({name:c.name,sha256:c.sha256,allComponentsExact:true,threadTerminationAwaited:true});
 }
 if(bounded){
  maxMemoryBytes=131072;
  await assert.rejects(client.resize(registry.copy(asset.id),{width:128,height:128}),e=>e.code==='resize-worker-failed');assert.equal(created,stopped);
  maxMemoryBytes=262144;
  const grown=await client.resize(registry.copy(asset.id),{width:128,height:128});
  const expected=JSON.parse(fs.readFileSync(new URL('../docs/browser/validation/2026-11-01-pillow-growth-reference.json',import.meta.url),'utf8'));
  assert.equal(sha(new Uint8Array(grown.data)),expected.rgbSha256);assert.equal(created,stopped);
 }
 trap=true;await assert.rejects(client.resize(registry.copy(asset.id),options(reference.cases[0])),e=>e.code==='resize-worker-failed'&&e.message==='resize-worker-failed');assert.equal(created,stopped);
 trap=false;const recovered=await client.resize(registry.copy(asset.id),options(reference.cases[0]));assert.equal(sha(new Uint8Array(recovered.data)),reference.cases[0].sha256);assert.equal(created,stopped);
 const controller=new AbortController(),cancelled=client.resize(registry.copy(asset.id),options(reference.cases[0]),{signal:controller.signal});controller.abort('private reason');
 await assert.rejects(cancelled,e=>e.code==='aborted'&&e.message==='aborted');assert.equal(created,stopped);
 assert.equal(sha(new Uint8Array(registry.copy(asset.id).data)),sourceSha);
}finally{await client.close();registry.release(asset.id,'session');}
assert.equal(created,stopped);
if(browser256){
 assert.ok(memoryProofs.length>=8);
 assert.ok(memoryProofs.every(p=>p.nodeGlobalsAbsent&&p.dynamicCodeDisabled&&!p.wasmAbsent&&p.networkAttempts===0&&p.wasmCompiles===1));
 assert.ok(memoryProofs.some(p=>p.linearMemoryBytes.includes(262144)));
}else if(bounded){
 assert.ok(memoryProofs.some(p=>p.state.rejectedGrowths>0));
 assert.ok(memoryProofs.some(p=>p.state.growthAttempts>0&&p.state.memoryBytes===262144));
 assert.ok(memoryProofs.every(p=>p.state.memoryBytes<=p.state.maxMemoryBytes));
}
const report={browserBundle:!!browser256,boundedGrowth:bounded,memoryProofs,budgetFailureThenFreshWorkerSuccess:bounded,status:'passed',cases,workersCreated:created,workersStopped:stopped,recoveryInNewWorker:true,realImportExceptionThreadTerminated:true,abortTerminationAwaited:true,registryOriginalUnchanged:true,configuredWorkerOldGenerationMiB:16,limits:[browser256?'Browser entry bundle executed in restricted VM on Node threads; actual browser/CSP/UI untested':'Node Worker/EventTarget facade, not browser Worker/CSP/UI acceptance','Requested heap setting is not total memory/RSS cap','Only four tiny RGB cases off-thread; broader 160-case WASM numeric evidence is separate','Allocator budget is not total RAM or declared module maximum; original dimension limits and production adoption remain unresolved','No GPU/model/browser started']};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
