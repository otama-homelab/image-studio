import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createForegroundWorkerClient} from './browser-library-adapter/foreground-worker-client.mjs';
import {nodeTaskWorker} from '../tests/fixtures/node-export-worker.mjs';
const [wasm,referencePath,output,browserBundle]=process.argv.slice(2);
if(!output||fs.existsSync(output))throw Error('Need WASM BYTE_ALPHA_REFERENCE NEW_OUTPUT');
const reference=JSON.parse(fs.readFileSync(referencePath,'utf8'));assert.equal(reference.status,'captured');assert.equal(reference.sourceSha256,'fd78cfb439940debc54c89a00638f025c0daef0bacc07fba393572787e9431ca');assert.deepEqual(reference.versions,{numpy:'2.3.5',numba:'0.68.0',llvmlite:'0.50.0'});
let created=0,stopped=0;const proofs=[];const client=createForegroundWorkerClient({rgba:true,createWorker(){created++;const worker=nodeTaskWorker(new URL(browserBundle?'../tests/fixtures/browser-export-thread.mjs':'../tests/fixtures/foreground-protocol-thread.mjs',import.meta.url),browserBundle?{browserBundle,allowWasm:true}:{wasm,maxMemoryBytes:131072},16,proof=>proofs.push(proof));return {...worker,async terminate(){await worker.terminate();stopped++;}};}}),cases=[];
try{for(const row of reference.cases){
 if(row.status==='reference-exception')continue;
 assert.ok(row.width*row.height<=64);const rgb=Uint8Array.from(Buffer.from(row.rgbBase64,'base64')),alpha=Uint8Array.from(Buffer.from(row.alphaBase64,'base64')),originalRgb=rgb.slice(),originalAlpha=alpha.slice();
 const pending=client.estimate({width:row.width,height:row.height,rgb,alpha});assert.equal(rgb.byteLength,0);assert.equal(alpha.byteLength,0);const result=await pending,rgba=new Uint8Array(result.data);
 assert.equal(result.format,'rgba-u8');assert.deepEqual(rgba,Uint8Array.from(Buffer.from(row.rgbaBase64,'base64')));
 for(let i=0;i<originalAlpha.length;i++){assert.equal(rgba[i*4+3],originalAlpha[i]);if(originalAlpha[i]===255)assert.deepEqual(rgba.slice(i*4,i*4+3),originalRgb.slice(i*3,i*3+3));}
 assert.equal(created,stopped);cases.push({name:row.name,rgbaSha256:createHash('sha256').update(rgba).digest('hex'),allBytesExact:true});
}}finally{await client.close();}
if(browserBundle){assert.equal(proofs.length,4);assert.ok(proofs.every(proof=>proof.nodeGlobalsAbsent&&proof.dynamicCodeDisabled&&proof.networkAttempts===0&&proof.wasmCompiles===1));}
const report={browserBundle:!!browserBundle,sandboxProofs:proofs,status:'passed',cases,workersCreated:created,workersStopped:stopped,alphaBytesPreserved:true,opaqueRgbPreserved:true,sourceTransferDetached:true,reference:'Pinned actual PyMatting JIT plus NumPy float64 stack/clip/uint8 and app opaque restoration',limits:['Tiny byte-alpha synthetic cases only; no photos/models/GPU/browser','Node worker threads; browser bundle/CSP and app connection remain','Full-size performance, release/license and native quality acceptance remain']};fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
