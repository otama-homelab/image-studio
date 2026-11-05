import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLibraryPreparation} from '../tools/browser-library-adapter/preparation-source.mjs';
const trusted={model:'hr',modelVersion:'set-1',releaseId:'release-1',cacheNamespace:'studio-release-1',resources:[
 {name:'config.json',url:'https://assets.invalid/release-1/hr/config.json',sha256:'a'.repeat(64),bytes:87},
 {name:'model_fp16.onnx',url:'https://assets.invalid/release-1/hr/onnx/model_fp16.onnx',sha256:'b'.repeat(64),bytes:4},
]};
const command=()=>({type:'prepare',workerId:'worker-1',jobId:'job-1',model:trusted.model,modelVersion:trusted.modelVersion,source:{mode:'library-resources',releaseId:trusted.releaseId,cacheNamespace:trusted.cacheNamespace,resources:structuredClone(trusted.resources)}});
test('matching descriptors resolve to independent frozen trusted resources',()=>{
 const request=command();request.source.resources.reverse();
 const result=validateLibraryPreparation(request,trusted);
 assert.deepEqual(result.resources,trusted.resources);assert.notEqual(result.resources,trusted.resources);
 request.source.resources[0].url='https://untrusted.invalid/photo';
 assert.equal(result.resources[0].url,trusted.resources[0].url);
 assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.resources));assert.ok(Object.isFrozen(result.resources[0]));
});
test('role, release, cache namespace and file substitutions are refused',()=>{
 const mutations=[r=>{r.model='matte';},r=>{r.modelVersion='set-2';},r=>{r.source.releaseId='release-2';},r=>{r.source.cacheNamespace='other-app';},r=>{r.source.mode='verified-bytes';},r=>{r.source.resources.pop();},r=>{r.source.resources.push({...r.source.resources[0]});},r=>{r.source.resources[1]={...r.source.resources[0]};}];
 for(const key of ['name','url','sha256','bytes'])mutations.push(r=>{r.source.resources[0][key]=key==='bytes'?88:'private-substitution';});
 for(const mutate of mutations){const request=command();mutate(request);assert.throws(()=>validateLibraryPreparation(request,trusted),e=>e.message==='invalid-preparation-source');}
});

test('archive transport comes only from the trusted embedded release and is frozen independently',()=>{
 const request=command();request.source.archive={url:'https://evil.invalid/photo',bytes:1,sha256:'e'.repeat(64)};
 const archive={url:'https://assets.invalid/release-1/hr.zip',bytes:500,sha256:'c'.repeat(64)};
 const result=validateLibraryPreparation(request,{...trusted,archive});
 assert.deepEqual(result.archive,archive);assert.notEqual(result.archive,archive);assert.ok(Object.isFrozen(result.archive));
 archive.url='https://evil.invalid/change';assert.equal(result.archive.url,'https://assets.invalid/release-1/hr.zip');
 assert.equal(validateLibraryPreparation(request,trusted).archive,undefined);
});
