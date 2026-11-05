import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createForegroundRuntime} from './browser-library-adapter/foreground-runtime.mjs';
const [boundedPath,unboundedPath,referencePath,output]=process.argv.slice(2);
if(!output||fs.existsSync(output))throw Error('Need BOUNDED_WASM UNBOUNDED_WASM REFERENCE_JSON NEW_OUTPUT');
const bytes=fs.readFileSync(boundedPath),reference=JSON.parse(fs.readFileSync(referencePath,'utf8'));
assert.equal(reference.status,'captured');assert.equal(reference.sourceSha256,'fd78cfb439940debc54c89a00638f025c0daef0bacc07fba393572787e9431ca');
for(const limit of [0,-1,65537,Infinity])await assert.rejects(createForegroundRuntime(bytes,{maxMemoryBytes:limit}),/invalid-foreground-memory-limit/);
await assert.rejects(createForegroundRuntime(fs.readFileSync(unboundedPath),{maxMemoryBytes:131072}),/invalid-foreground-module/);
await assert.rejects(createForegroundRuntime(bytes,{maxMemoryBytes:65536}),/foreground-initial-memory-limit/);
const runtime=await createForegroundRuntime(bytes,{maxMemoryBytes:131072}),cases=[];
for(const row of reference.cases){
 assert.ok(row.width*row.height<=64);
 const input={width:row.width,height:row.height,rgb:Float32Array.from(row.inputRgb),alpha:Float32Array.from(row.inputAlpha)};
 if(row.status==='reference-exception'){assert.throws(()=>runtime.estimate(input),/invalid-foreground-input/);continue;}
 const result=runtime.estimate(input);assert.deepEqual(result.foreground,Float32Array.from(row.foreground));assert.deepEqual(result.background,Float32Array.from(row.background));cases.push(row.name);
}
const before=runtime.getState();
// Allocation fails before the estimation kernel: no large image loop or inference.
assert.throws(()=>runtime.estimate({width:100,height:30,rgb:new Float32Array(9000),alpha:new Float32Array(3000)}),/foreground-memory-failed/);
const after=runtime.getState();assert.ok(after.rejectedGrowths>0);assert.equal(after.closed,true);assert.throws(()=>runtime.estimate({}),/unavailable/);
runtime.close();
const growing=await createForegroundRuntime(bytes,{maxMemoryBytes:262144});
const grown=growing.estimate({width:32,height:32,rgb:new Float32Array(3072),alpha:new Float32Array(1024).fill(1)});
assert.ok(grown.foreground.every(value=>value===0));assert.ok(grown.background.every(value=>value===0));
const growthState=growing.getState();assert.ok(growthState.growthAttempts>0);assert.equal(growthState.rejectedGrowths,0);assert.ok(growthState.memoryBytes<=262144);growing.close();
const report={status:'passed',wasmBytes:bytes.length,wasmSha256:createHash('sha256').update(bytes).digest('hex'),referenceCasesByteExact:cases,before,after,successfulGrowth: growthState,checks:['Invalid limits rejected','Old unbounded module refused','Initial memory above cap refused','Growth refusal yields fixed error and closes module','No reentry after allocation failure'],limits:['Host growth cap for trusted pinned fork; not a verifier of arbitrary WASM','Linear memory cap does not bound JavaScript arrays, process RAM or other workers','No browser/GPU/model or full-size execution; Worker cancellation and product acceptance remain']};fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
