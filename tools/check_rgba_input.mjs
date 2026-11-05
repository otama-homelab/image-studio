import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createInputLoad} from './browser-library-adapter/input-load.mjs';
import {createImageRegistry} from './browser-library-adapter/image-registry.mjs';
import {createPngInputWorkerClient} from './browser-library-adapter/png-input-worker.mjs';
import {createWorkerGate} from './browser-library-adapter/worker-gate.mjs';
import {nodeTaskWorker} from '../tests/fixtures/node-export-worker.mjs';
import {createInputRgb} from './browser-library-adapter/input-rgb.mjs';
import {createImagePreflight} from './browser-library-adapter/image-preflight.mjs';
import {createPngInput} from './browser-library-adapter/png-input.mjs';
const [bundle,backend,library,dependencies,fixtures,output,inputBundle]=process.argv.slice(2);
if(!output||fs.existsSync(output))throw Error('Need bundle, backend, dimensions library, dependencies, fixtures, new output');
let network=0,gpu=0,sessions=0;
globalThis.fetch=async()=>{network++;throw Error('Network forbidden');};
Object.defineProperty(globalThis.navigator,'gpu',{value:{requestAdapter:async()=>{gpu++;throw Error('GPU forbidden');}},configurable:true});
const common=await import(pathToFileURL(path.resolve(backend)));common.InferenceSession.create=async()=>{sessions++;throw Error('Session forbidden');};globalThis[Symbol.for('onnxruntime')]=common;
const {RawImage,env}=await import(pathToFileURL(path.resolve(bundle)));env.allowRemoteModels=false;env.allowLocalModels=false;
const {imageDimensionsFromData}=await import(pathToFileURL(path.resolve(library,'index.js'))),{decode}=await import(pathToFileURL(path.resolve(dependencies,'node_modules/fast-png/lib/index.js')));
const reference=JSON.parse(fs.readFileSync(path.join(fixtures,'report.json'),'utf8')),png=fs.readFileSync(path.join(fixtures,'rgba.png')),expected=fs.readFileSync(path.join(fixtures,'rgb.bin'));
const sha=b=>createHash('sha256').update(b).digest('hex');assert.equal(sha(png),reference.pngSha256);assert.equal(sha(expected),reference.rgbSha256);
const read=createPngInput({inspect:createImagePreflight({probe:imageDimensionsFromData,maxAxis:512,maxPixels:1024}),decode});
const rgba=await read(new Blob([png]));assert.equal(rgba.format,'rgba-u8');assert.equal(sha(new Uint8Array(rgba.data)),reference.rgbaSha256);
const normalize=createInputRgb({RawImage}),rgb=normalize(rgba);assert.equal(rgb.format,'rgb-u8');assert.deepEqual(new Uint8Array(rgb.data),new Uint8Array(expected));assert.equal(sha(new Uint8Array(rgba.data)),reference.rgbaSha256);
const again=normalize(rgb);assert.deepEqual(new Uint8Array(again.data),new Uint8Array(expected));new Uint8Array(again.data).fill(0);assert.equal(sha(new Uint8Array(rgb.data)),reference.rgbSha256);
assert.throws(()=>normalize({...rgba,data:new ArrayBuffer(1)}),e=>e.message==='invalid-input-rgb');assert.equal(network+gpu+sessions,0);
let workerIntegration=null;
if(inputBundle){
 const gate=createWorkerGate(),registry=createImageRegistry(),proofs=[];let created=0,stopped=0;
 const client=createPngInputWorkerClient({inspect:createImagePreflight({probe:imageDimensionsFromData,maxAxis:512,maxPixels:1024}),gate,createWorker(){created++;const worker=nodeTaskWorker(new URL('../tests/fixtures/browser-export-thread.mjs',import.meta.url),{browserBundle:inputBundle,allowWasm:false},64,p=>proofs.push(p));return {...worker,async terminate(){const value=await worker.terminate();stopped++;return value;}};}});
 const owner=createInputLoad({registry,read:async(file,hooks)=>normalize(await client.read(file,hooks))});
 try{
  const first=await owner.load(new Blob([png]));assert.equal(first.status,'ready');assert.equal(created,stopped);assert.equal(sha(new Uint8Array(registry.copy(first.input.image.id).data)),reference.rgbSha256);
  const broken=Uint8Array.from(png);broken[broken.length-1]^=1;await assert.rejects(owner.load(new Blob([broken])),e=>e.code==='input-load-failed');assert.equal(owner.get(),first.input);assert.equal(created,stopped);
  const next=await owner.load(new Blob([png]));assert.equal(next.status,'ready');assert.notEqual(next.input.inputId,first.input.inputId);assert.throws(()=>registry.get(first.input.image.id));assert.equal(sha(new Uint8Array(registry.copy(next.input.image.id).data)),reference.rgbSha256);
 }finally{await owner.close();await client.close();}
 assert.equal(created,stopped);assert.deepEqual(gate.getState(),{busy:false,blocked:false});assert.ok(proofs.every(p=>p.nodeGlobalsAbsent&&p.wasmAbsent&&p.networkAttempts===0));
 workerIntegration={status:'passed',workersCreated:created,workersStopped:stopped,failedReplacementPreservesInput:true,oldAssetReleased:true,proofs};
}
assert.equal(network+gpu+sessions,0);
const report={workerIntegration,status:'passed',alphaByteValues:256,rgbaDecodedExact:true,rgbMatchesPillow:true,hiddenRgbPreserved:true,inputUnchanged:true,outputNotAliased:true,library:'Transformers.js 4.3.2 actual RawImage.rgb; fast-png8',network,gpu,sessions,reference,rssBytes:process.memoryUsage().rss,limits:['Actual published browser library in Node with existing ORT Common injection; no model/runtime initialization','Synthetic RGBA8 PNG only; no real browser/ICC/EXIF/other PNG formats','Utility chunk sizing and production dependency selection remain incomplete']};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
