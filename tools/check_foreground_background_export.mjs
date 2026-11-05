import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createForegroundWorkerClient} from './browser-library-adapter/foreground-worker-client.mjs';
import {createExportWorkerClient} from './browser-library-adapter/export-worker-client.mjs';
import {createImageRegistry} from './browser-library-adapter/image-registry.mjs';
import {createWorkerGate} from './browser-library-adapter/worker-gate.mjs';
import {nodeTaskWorker,nodeExportWorker} from '../tests/fixtures/node-export-worker.mjs';
const [wasm,referencePath,backgroundPath,dependencyRoot,output,foregroundBundle,exportBundle]=process.argv.slice(2);if(!output||fs.existsSync(output))throw Error('Need WASM REFERENCE BACKGROUNDS DEPENDENCIES NEW_OUTPUT');
const reference=JSON.parse(fs.readFileSync(referencePath)),background=JSON.parse(fs.readFileSync(backgroundPath));assert.equal(reference.status,'captured');assert.equal(reference.sourceSha256,'fd78cfb439940debc54c89a00638f025c0daef0bacc07fba393572787e9431ca');assert.equal(background.pillow,'12.3.0');
const {decode}=await import(pathToFileURL(path.join(dependencyRoot,'node_modules/fast-png/lib/index.js')));
const gate=createWorkerGate(),registry=createImageRegistry();let estimates=0,exports=0,stopped=0;const proofs=[];
const track=worker=>({...worker,async terminate(){await worker.terminate();stopped++;}});
const foreground=createForegroundWorkerClient({rgba:true,gate,createWorker(){estimates++;return track(nodeTaskWorker(new URL(foregroundBundle?'../tests/fixtures/browser-export-thread.mjs':'../tests/fixtures/foreground-protocol-thread.mjs',import.meta.url),foregroundBundle?{browserBundle:foregroundBundle,allowWasm:true}:{wasm,maxMemoryBytes:131072},16,proof=>proofs.push(proof)));}});
const exporter=createExportWorkerClient({gate,createWorker(){exports++;return track(nodeExportWorker(exportBundle?{browserBundle:exportBundle}:{dependencyRoot},16,proof=>proofs.push(proof)));}});
const row=reference.cases[0];assert.ok(row.width*row.height<=64);let asset;const cases=[];
try{
 const image=await foreground.estimate({width:row.width,height:row.height,rgb:Uint8Array.from(Buffer.from(row.rgbBase64,'base64')),alpha:Uint8Array.from(Buffer.from(row.alphaBase64,'base64'))});asset=registry.register(image,'cutout');
 const transparent=await exporter.encode(registry.copy(asset.id),{kind:'transparent'});const decoded=decode(transparent.bytes);assert.deepEqual(new Uint8Array(decoded.data),Uint8Array.from(Buffer.from(row.rgbaBase64,'base64')));
 for(const item of background.cases){const file=await exporter.encode(registry.copy(asset.id),{kind:'background',backgroundColor:item.color});const png=decode(file.bytes);assert.equal(png.channels,3);assert.deepEqual(new Uint8Array(png.data),Uint8Array.from(Buffer.from(item.rgbBase64,'base64')));cases.push({color:item.color,allPixelsExact:true});}
 assert.equal(estimates,1);assert.equal(exports,4);assert.equal(stopped,5);assert.deepEqual(new Uint8Array(registry.copy(asset.id).data),Uint8Array.from(Buffer.from(row.rgbaBase64,'base64')));assert.equal(gate.getState().busy,false);
}finally{await foreground.close();await exporter.close();if(asset)registry.release(asset.id,'cutout');}
if(foregroundBundle&&exportBundle){assert.equal(proofs.length,5);assert.ok(proofs.every(proof=>proof.nodeGlobalsAbsent&&proof.dynamicCodeDisabled&&proof.networkAttempts===0));assert.equal(proofs.filter(proof=>proof.wasmCompiles===1).length,1);assert.equal(proofs.filter(proof=>proof.wasmAbsent).length,4);}
const report={browserBundles:!!foregroundBundle&&!!exportBundle,sandboxProofs:proofs,status:'passed',cases,foregroundEstimations:estimates,pngExports:exports,workersStopped:stopped,transparentPngExact:true,cutoutUnchanged:true,sharedGateReleased:true,reference:'Pinned actual PyMatting+NumPy RGBA, then independent Pillow12.3.0 alpha_composite',limits:['Tiny synthetic Node workers only; no browser/model/GPU','Private integration test; visible app and real browser/CSP acceptance remain','Full-size performance, release/license and rollback acceptance remain']};fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
