/** Actual synchronous interpolation utility; tiny analytic fixture, no inference. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {alphaToUint8} from './browser-library-adapter/alpha-u8.mjs';
const [bundle,backend,fixturePath,output]=process.argv.slice(2);
if(!output||fs.existsSync(output))throw Error('Need bundle, JS backend, fixture and new output');
let network=0,sessions=0,gpu=0;
globalThis.fetch=async()=>{network++;throw Error('Network forbidden');};
Object.defineProperty(globalThis.navigator,'gpu',{value:{requestAdapter:async()=>{gpu++;throw Error('GPU forbidden');}},configurable:true});
const common=await import(pathToFileURL(backend).href);
common.InferenceSession.create=async()=>{sessions++;throw Error('Session forbidden');};
globalThis[Symbol.for('onnxruntime')]=common;
const {Tensor,interpolate}=await import(pathToFileURL(bundle).href);
const fixture=JSON.parse(fs.readFileSync(fixturePath));
const cases=[];
for(const c of fixture.cases){
 const input=new Tensor('float32',Float32Array.from(c.input),c.inputShape);
 const result=interpolate(input,c.outputSize,'bilinear',false);
 assert.deepEqual(result.dims,[1,...c.outputSize]);
 const diff=Math.max(...result.data.map((v,i)=>Math.abs(v-c.expected[i])));
 assert.ok(diff<=1e-6);
 const bytes=alphaToUint8(result.data);
 const u8diff=Math.max(...bytes.map((v,i)=>Math.abs(v-c.expectedU8[i])));
 assert.equal(u8diff,0);
 cases.push({inputShape:c.inputShape,outputSize:c.outputSize,maxAbsoluteDifference:diff,uint8Difference:u8diff});
 result.dispose();input.dispose();
}
assert.deepEqual([...alphaToUint8(Float32Array.from(fixture.quantization.input))],fixture.quantization.expected);
assert.deepEqual([...alphaToUint8(Float32Array.of(0.2,0.3,0.4),Uint8Array.of(0,128,255))],[0,76,255]);
for(const v of [NaN,Infinity,-Infinity])assert.throws(()=>alphaToUint8(Float32Array.of(v)),/Non-finite/);
assert.throws(()=>alphaToUint8(Float32Array.of(0.5),Uint8Array.of(127)),/trimap/);
assert.equal(network,0);assert.equal(sessions,0);assert.equal(gpu,0);
const report={status:'passed',oracle:fixture.oracle,cases,quantizationCases:fixture.quantization.input.length,checks:{tiesToEven:true,float32MultiplyBeforeRound:true,definiteTrimapAnchorsRestored:true,nonFiniteRejected:true,invalidTrimapRejected:true},realNetworkRequests:network,sessionCreations:sessions,gpuRequests:gpu,currentRssBytes:process.memoryUsage().rss,limitations:['Small analytical oracle, not actual PyTorch output or full-image acceptance.','Published synchronous interpolate only; interpolate_4d uses inference ops and was not called.','Node with ORT Common 1.31.1 JS Tensor injection; browser/full model path untested.']};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
