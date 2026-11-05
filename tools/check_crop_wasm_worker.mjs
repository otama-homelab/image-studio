/** Private numerical checkpoint: actual crop bundle + WASM on serial Node threads.
 * Asset fetch is a fixed in-memory fixture. This is not native browser acceptance.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {nodeTaskWorker} from '../tests/fixtures/node-export-worker.mjs';
import {createSingleWorkerTask} from './browser-library-adapter/single-worker-task.mjs';
import {createCooperativeWorkerStop} from './browser-library-adapter/cooperative-worker-stop.mjs';
import {createWorkerGate} from './browser-library-adapter/worker-gate.mjs';
import {PNG_MAX_AXIS,PNG_MAX_PIXELS} from './browser-library-adapter/png-input.mjs';
const [bundle,descriptorFile,output]=process.argv.slice(2);
if(!bundle||!descriptorFile||!output||fs.existsSync(output))throw Error('Need BROWSER_BUNDLE ASSET_DESCRIPTOR NEW_OUTPUT');
const descriptor=JSON.parse(fs.readFileSync(descriptorFile)),asset=fs.readFileSync(descriptor.file),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(asset.length,descriptor.bytes);assert.equal(sha(asset),descriptor.sha256);
const fixture=JSON.parse(fs.readFileSync(new URL('../tests/fixtures/crop-aspect-cases.json',import.meta.url))),require=createRequire(new URL('../web/package.json',import.meta.url)),{encode,decode}=require('fast-png');
fs.mkdirSync(output,{mode:0o700});let created=0,stopped=0,corrupt=false;const proofs=[],gate=createWorkerGate();
class CropError extends Error{constructor(code){super(code);this.code=code;}}
const task=createSingleWorkerTask({gate,ErrorClass:CropError,prefix:'crop-save',requestType:'crop-png',responseType:'crop-png-ready',errorCodes:['crop-resize-unavailable','png-dimensions-too-large','pdf-module-unavailable','unsupported-png-format','unsupported-browser','invalid-crop-input','crop-encode-failed','unsupported-print-dpi','invalid-print-metadata','photo-does-not-fit'],
 stopWorker:createCooperativeWorkerStop({requestType:'cancel-crop',responseType:'crop-cancelled',timeoutMs:10000}),
 createWorker(){created++;const bytes=Uint8Array.from(asset);if(corrupt)bytes[0]^=1;
  const worker=nodeTaskWorker(new URL('../tests/fixtures/browser-export-thread.mjs',import.meta.url),{browserBundle:path.resolve(bundle),allowWasm:true,fixedAsset:{url:descriptor.url,bytes}},64,proof=>proofs.push(proof));
  return {...worker,async terminate(){const result=await worker.terminate();stopped++;return result;}};
 },prepare(input){return {request:input,transfer:[],context:input};},
 validate(event,input){const file=event.file;assert.equal(file.mime,'image/png');assert.equal(file.width,input.width);assert.equal(file.height,input.height);assert.ok(file.bytes instanceof Uint8Array);return file;}
});
function input(item){const [width,height]=item.source,data=new Uint8Array(width*height*3);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++)data[(y*width+x)*3+c]=(x*37+y*59+c*83)%256;
 assert.equal(sha(data),item.sourceSha256);return {mode:'crop',file:new Blob([encode({width,height,channels:3,depth:8,data})],{type:'image/png'}),sourceWidth:width,sourceHeight:height,width:item.output[0],height:item.output[1],crop:{x:item.box[0],y:item.box[1],width:item.box[2]-item.box[0],height:item.box[3]-item.box[1]},output:{kind:'crop',format:'png'}};
}
function check(file,item,name){const image=decode(file.bytes);assert.equal(image.width,item.output[0]);assert.equal(image.height,item.output[1]);assert.equal(image.channels,3);assert.equal(sha(image.data),item.rgbSha256);fs.writeFileSync(path.join(output,name+'.png'),file.bytes,{flag:'wx',mode:0o600});assert.equal(created,stopped);assert.equal(gate.getState().busy,false);return {name,width:file.width,height:file.height,bytes:file.bytes.length,pngSha256:sha(file.bytes),rgbSha256:sha(image.data),exact:true};}
const results=[],rejections=[],cases=[...fixture.cases,...(fixture.workerCases??[])],recoveryCase=fixture.workerCases[0];
try{
 for(const item of cases){
  if(item.source.some(axis=>axis>PNG_MAX_AXIS)||item.source[0]*item.source[1]>PNG_MAX_PIXELS){
   const before=proofs.length;await assert.rejects(task.run(input(item)),error=>error.code==='png-dimensions-too-large');assert.equal(created,stopped);assert.equal(gate.getState().busy,false);assert.ok(proofs.length>before);assert.ok(proofs.slice(before).every(p=>p.assetRequests===0&&p.wasmCompiles===0));rejections.push({name:item.name,code:'png-dimensions-too-large',beforeAssetAndWasm:true});
  }else results.push(check(await task.run(input(item)),item,item.name));
 }
 const corruptBefore=proofs.length;corrupt=true;await assert.rejects(task.run(input(recoveryCase)),error=>error.code==='crop-resize-unavailable');assert.equal(created,stopped);assert.equal(gate.getState().blocked,false);
 assert.ok(proofs.length>corruptBefore);assert.ok(proofs.slice(corruptBefore).every(p=>p.assetRequests===1&&p.wasmCompiles===0));
 corrupt=false;results.push(check(await task.run(input(recoveryCase)),recoveryCase,'after-corruption'));
 const cancelBefore=proofs.length,controller=new AbortController(),pending=task.run(input(recoveryCase),{signal:controller.signal});controller.abort();await assert.rejects(pending,error=>error.code==='aborted');assert.equal(created,stopped);assert.equal(gate.getState().blocked,false);
 results.push(check(await task.run(input(recoveryCase)),recoveryCase,'after-cancel'));
 assert.ok(proofs.length>cancelBefore);
}catch(error){fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({code:error.code??'checkpoint-failed',created,stopped,proofs},null,2)+'\n');throw error;}finally{await task.close();}
assert.equal(created,stopped);assert.equal(created,cases.length+4);assert.ok(proofs.length>=created);assert.ok(proofs.every(p=>p.nodeGlobalsAbsent&&p.dynamicCodeDisabled&&p.networkAttempts===0&&p.gpuPresenceProbes===0));assert.ok(proofs.some(p=>p.assetRequests===1&&p.wasmCompiles===0));
const report={status:'passed',browserBundleSha256:sha(fs.readFileSync(bundle)),wasmSha256:descriptor.sha256,results,rejections,workersCreated:created,workersStopped:stopped,corruptAssetRejectedBeforeWasm:true,cancelAcknowledgedBeforeTermination:true,recoveryExact:true,proofs,limits:['Real browser crop entry executed in restricted VM on Node threads; not native browser/CSP/UI acceptance','WASM and image operations are real; asset transport is a fixed in-memory fixture','Small synthetic pixel counts; no 24MP or 4096x4096 native acceptance','Cancellation requested immediately after dispatch; no proof of interruption inside synchronous WASM','64MiB old-generation setting is not total RAM/RSS cap','No model/GPU/native browser started']};
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,workersCreated:created,workersStopped:stopped,results:results.length}));
