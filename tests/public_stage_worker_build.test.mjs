import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPublicStageWorker,validatePublicStagePolicy} from '../tools/build_browser_public_stage_worker.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
const runtime=JSON.parse(fs.readFileSync(new URL('../docs/browser/runtime-assets.candidate.json',import.meta.url)));
const root='https://huggingface.co/otama/image-studio-browser-models/resolve/'+ 'a'.repeat(40)+'/';
const file=name=>runtime.files.find(f=>f.name.endsWith('.'+name));
function fixture(){
 const localModelPath=root+'models/hr/stage-000/';
 return {workerLifetime:'per-stage',maxStagesPerWorker:1,wasmOrigin:'https://huggingface.co',runtimeAssets:{mjs:`/runtime/ort/1.31.1/${file('mjs').sha256}/${file('mjs').name}`,wasm:root+`runtime/ort/1.31.1/${file('wasm').sha256}/${file('wasm').name}`},profile:{executionProvider:'wasm',numThreads:2},stages:[{inputs:[{name:'pixels',dtype:'float16',dims:[1,3,2048,2048]}],outputs:[{name:'alpha',dtype:'float32',dims:[1,1,2048,2048]}],localModelPath,release:{model:'hr',modelVersion:'hr-test',releaseId:'test',cacheNamespace:'image-studio-test',resources:['config.json','onnx/model_fp16.onnx'].map(name=>({name,url:localModelPath+'hr/'+name,bytes:4,sha256:'b'.repeat(64)}))}}]};
}
test('public stage policy keeps immutable Hub resources and relative same-origin runtime without starting anything',()=>{
 const policy=fixture(),before=JSON.stringify(policy);
 assert.equal(validatePublicStagePolicy(policy),policy);
 assert.equal(JSON.stringify(policy),before);
});
test('public stage build refuses private fields, mutable revisions, mixed commits, substituted runtime and invalid stage contracts',()=>{
 for(const change of [
  p=>{p.scope='local-validation-only-not-approved-for-distribution';},
  p=>{p.appOrigin='http://127.0.0.1:17861';},
  p=>{p.profile.scope='private';},
  p=>{p.runtimeAssets.mjs='https://app.invalid'+p.runtimeAssets.mjs;},
  p=>{p.runtimeAssets.wasm=p.runtimeAssets.wasm.replace('a'.repeat(40),'main');},
  p=>{p.runtimeAssets.wasm=p.runtimeAssets.wasm.replace(file('wasm').sha256,'c'.repeat(64));},
  p=>{p.stages[0].release.resources[0].url=p.stages[0].release.resources[0].url.replace('a'.repeat(40),'c'.repeat(40));},
  p=>{p.stages[0].release.resources[0].sha256='wrong';},
  p=>{p.stages[0].release.resources[0].sourceArtifact='/private/weights';},
  p=>{p.stages[0].localModelPath='http://127.0.0.1/models/';},
  p=>{p.stages[0].outputs[0].dims=[1,1,2,2];},
  p=>{p.maxStagesPerWorker=2;},
  p=>{p.profile.executionProvider='other';},
  p=>{p.profile.numThreads=3;},
  p=>{p.stages[0].release.cacheNamespace='foreign-cache';},
 ]){const p=fixture();change(p);assert.throws(()=>validatePublicStagePolicy(p));}
});


test('public stage builder preserves existing outputs and rejects changed libraries before writing assets',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-stage-build-'));
 try{
  const policy=path.join(root,'policy.json'),output=path.join(root,'output');fs.writeFileSync(policy,JSON.stringify(fixture()));
  fs.mkdirSync(output);fs.writeFileSync(path.join(output,'keep.txt'),'keep');
  await assert.rejects(buildPublicStageWorker(root,policy,output),/New output directory required/);
  assert.equal(fs.readFileSync(path.join(output,'keep.txt'),'utf8'),'keep');
  const changed=path.join(root,'transformersjs-reuse-review-01/npm-4.3.2/package/dist');fs.mkdirSync(changed,{recursive:true});fs.writeFileSync(path.join(changed,'transformers.web.js'),'changed');
  for(const [name,body] of [['runtime-packages/ort-web-1.31.1/package/dist/ort.webgpu.bundle.min.mjs','fixture'],['hash-wasm-reuse-01/package/dist/sha256.umd.min.js','fixture'],['png-export-01/node_modules/esbuild/lib/main.js','module.exports={version:"0.25.12"}']]){
   const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body);
  }
  fs.writeFileSync(path.join(root,'hash-wasm-reuse-01/package-evidence.json'),JSON.stringify({integrity_verified:true,files:[{path:'package/dist/sha256.umd.min.js',sha256:createHash('sha256').update('fixture').digest('hex')}]}));
  const fresh=path.join(root,'fresh');await assert.rejects(buildPublicStageWorker(root,policy,fresh),/Pinned stage library mismatch/);assert.equal(fs.existsSync(fresh),false);
  const invalid=fixture();invalid.scope='private';fs.writeFileSync(policy,JSON.stringify(invalid));
  await assert.rejects(buildPublicStageWorker(root,policy,fresh),/Invalid public stage policy/);assert.equal(fs.existsSync(fresh),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
