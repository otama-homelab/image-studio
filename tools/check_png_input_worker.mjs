import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createPngInputWorkerClient} from './browser-library-adapter/png-input-worker.mjs';
import {createImagePreflight} from './browser-library-adapter/image-preflight.mjs';
import {createInputLoad} from './browser-library-adapter/input-load.mjs';
import {createImageRegistry} from './browser-library-adapter/image-registry.mjs';
import {createWorkerGate} from './browser-library-adapter/worker-gate.mjs';
import {nodeTaskWorker} from '../tests/fixtures/node-export-worker.mjs';
const [library,dependencies,png,output,browserBundle,boundedFlag]=process.argv.slice(2);
if(!output||fs.existsSync(output))throw Error('Need dimensions library, dependencies, PNG, new report');
const probeModule=pathToFileURL(path.resolve(library,'index.js')).href,codecModule=pathToFileURL(path.resolve(dependencies,'node_modules/fast-png/lib/index.js')).href;
const {imageDimensionsFromData}=await import(probeModule),inspect=createImagePreflight({probe:imageDimensionsFromData,maxAxis:4096,maxPixels:4_000_000});
const gate=createWorkerGate(),data=fs.readFileSync(png),file=new Blob([data]);let created=0,stopped=0;const proofs=[];
const client=createPngInputWorkerClient({inspect,gate,createWorker(){created++;const worker=nodeTaskWorker(new URL(browserBundle?'../tests/fixtures/browser-export-thread.mjs':'../tests/fixtures/png-input-thread.mjs',import.meta.url),browserBundle?{browserBundle,allowWasm:false}:{probeModule,codecModule},64,proof=>proofs.push(proof));return {...worker,async terminate(){const value=await worker.terminate();stopped++;return value;}};}});
const registry=createImageRegistry(),inputOwner=createInputLoad({registry,read:client.read});
try{
 const ready=await inputOwner.load(file);assert.equal(ready.status,'ready');const image=registry.copy(ready.input.image.id);assert.equal(created,stopped);assert.equal(createHash('sha256').update(new Uint8Array(image.data)).digest('hex'),'4597a0e0561723ccfb93206732afce3a7771fd8cb6017f8dd78dfbfe9f35a16b');
 const signal=new AbortController();const pending=client.read(file,{signal:signal.signal});
 while(created<2)await new Promise(resolve=>setImmediate(resolve));signal.abort();
 await assert.rejects(pending,e=>e.code==='aborted');assert.equal(stopped,2);
 const broken=Uint8Array.from(data);broken[broken.length-1]^=1;await assert.rejects(inputOwner.load(new Blob([broken])),e=>e.code==='input-load-failed');assert.equal(stopped,3);
 assert.equal(inputOwner.get(),ready.input);
 const replacement=await inputOwner.load(file),recovered=registry.copy(replacement.input.image.id);assert.notEqual(replacement.input.inputId,ready.input.inputId);assert.throws(()=>registry.get(ready.input.image.id));assert.deepEqual(new Uint8Array(recovered.data),new Uint8Array(image.data));assert.equal(stopped,4);
 if(boundedFlag==='--bounded'){
 const {encode}=await import(codecModule),{default:crc32}=await import(pathToFileURL(path.resolve(dependencies,'node_modules/crc-32/crc32.js')));
 const forged=Uint8Array.from(encode({width:128,height:128,channels:3,depth:8,data:new Uint8Array(128*128*3)})),view=new DataView(forged.buffer);view.setUint32(16,1);view.setUint32(20,1);view.setUint32(29,crc32.buf(forged.subarray(12,29))>>>0);await assert.rejects(client.read(new Blob([forged])),e=>e.code==='png-input-worker-failed');assert.equal(stopped,5);
 const checksumBad=Uint8Array.from(encode({width:1,height:1,channels:3,depth:8,data:Uint8Array.of(1,2,3)}));for(let at=8;at<checksumBad.length;){const view=new DataView(checksumBad.buffer),n=view.getUint32(at);if(String.fromCharCode(...checksumBad.subarray(at+4,at+8))==='IDAT'){checksumBad[at+8+n-1]^=1;view.setUint32(at+8+n,crc32.buf(checksumBad.subarray(at+4,at+8+n))>>>0);break;}at+=n+12;}await assert.rejects(client.read(new Blob([checksumBad])),e=>e.code==='png-input-worker-failed');assert.equal(stopped,6);
 }
}finally{await inputOwner.close();await client.close();}
assert.deepEqual(gate.getState(),{busy:false,blocked:false});assert.equal(created,stopped);
if(browserBundle){assert.ok(proofs.length>=3);assert.ok(proofs.every(p=>p.nodeGlobalsAbsent&&p.wasmAbsent&&p.dynamicCodeDisabled&&p.networkAttempts===0));}
const report={oversizeInflationRejected:boundedFlag==='--bounded',validCrcBadAdlerRejected:boundedFlag==='--bounded',inputOwnerIntegrated:true,failedReplacementPreservesInput:true,successfulReplacementReleasesOldInput:true,browserBundleInRestrictedVm:!!browserBundle,proofs,status:'passed',workersCreated:created,workersStopped:stopped,rgbExact:true,cancelTerminationAwaited:true,crcFailureThenNewWorkerRecovery:true,gate:gate.getState(),limits:['Actual Node threads and fast-png; not browser Worker/CSP/bootstrap acceptance','Synthetic RGB PNG only; JPEG/EXIF/ICC/alpha conversion and product policy unresolved','Abort immediately after thread creation, not measured during decoder instruction execution','Heap configuration is not total memory cap; no GPU/model/browser initialized']};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
