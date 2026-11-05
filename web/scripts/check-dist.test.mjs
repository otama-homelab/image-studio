import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkDist} from './check-dist.mjs';
const buildInfo=JSON.stringify({schemaVersion:1,appVersion:'0.1.0',sourceId:'sha256:'+'a'.repeat(64)});
async function fixture(run){
 const root=await mkdtemp(join(tmpdir(),'image-studio-dist-'));
 try{
  await mkdir(join(root,'examples'));
  for(const name of ['index.html','_headers','LICENSE.txt','THIRD_PARTY_NOTICES.txt','logo.svg','examples/fictional-portrait-v1.png','examples/fictional-portrait-v1.webp','examples/fictional-portrait-modnet-cpu-v1.webp'])await writeFile(join(root,name),'fixture');
  await writeFile(join(root,'build-info.json'),buildInfo);
  await run(root);
 }finally{await rm(root,{recursive:true,force:true});}
}
test('accepts a small static deploy tree and refuses missing notices',()=>fixture(async root=>{
 const result=await checkDist(root);assert.equal(result.files.length,9);assert.equal(result.totalBytes,56+Buffer.byteLength(buildInfo));
 await rm(join(root,'THIRD_PARTY_NOTICES.txt'));await assert.rejects(checkDist(root),/Missing deployment file/);
}));
test('refuses missing, malformed or expanded build metadata',()=>fixture(async root=>{
 for(const value of [{schemaVersion:1,appVersion:'0.1.0',sourceId:'private-path'},{schemaVersion:1,appVersion:'0.1.0',sourceId:'sha256:'+'a'.repeat(64),hostname:'private-host'},[]]){
  await writeFile(join(root,'build-info.json'),JSON.stringify(value));await assert.rejects(checkDist(root),/Invalid deployment build metadata/);
 }
 await rm(join(root,'build-info.json'));await assert.rejects(checkDist(root),/Missing deployment file: build-info.json/);
}));
test('refuses model weights, private files and symlinks',()=>fixture(async root=>{
 for(const name of ['model.onnx','model.onnx.data','weights.bin','.env','source.py','private.key','script.js.map']){
  await writeFile(join(root,name),'fixture');await assert.rejects(checkDist(root),/Unapproved deployment file/);await rm(join(root,name));
 }
 await symlink(join(root,'index.html'),join(root,'linked.html'));await assert.rejects(checkDist(root),/Deployment symlink/);
}));
test('refuses oversized assets without reading or allocating their contents',()=>fixture(async root=>{
 const file=await open(join(root,'too-large.dat'),'w');try{await file.truncate(25*1024*1024+1);}finally{await file.close();}
 await assert.rejects(checkDist(root),/exceeds 25 MiB/);
}));
test('refuses a private local model validation build as a Pages artifact',()=>fixture(async root=>{
 await writeFile(join(root,'LOCAL_VALIDATION_ONLY.json'),JSON.stringify({distributionApproved:false}));
 await assert.rejects(checkDist(root),/must not be deployed to Pages/);
}));

test('refuses Pages server entry files and directory-form workers before traversal',()=>fixture(async root=>{
 for(const name of ['_worker.js','_routes.json']){
  await writeFile(join(root,name),'fixture');await assert.rejects(checkDist(root),/Server execution is not approved/);await rm(join(root,name));
 }
 for(const name of ['_worker.js','functions']){
  await mkdir(join(root,name));await writeFile(join(root,name,'index.js'),'fixture');
  await assert.rejects(checkDist(root),/Server execution is not approved/);await rm(join(root,name),{recursive:true});
 }
}));

test('refuses private validation entries even if their marker file was lost',()=>fixture(async root=>{
 await writeFile(join(root,'local-validation.html'),'private validation');
 await assert.rejects(checkDist(root),/Private validation entry/);await rm(join(root,'local-validation.html'));
 for(const directory of ['validation-workers','validation-notices']){
  await mkdir(join(root,directory));await writeFile(join(root,directory,'artifact.js'),'private validation');
  await assert.rejects(checkDist(root),/Private validation entry/);await rm(join(root,directory),{recursive:true});
 }
 assert.equal((await checkDist(root)).files.length,9);
}));

test('refuses a deploy tree missing the new lossless display asset',()=>fixture(async root=>{await rm(join(root,'examples/fictional-portrait-v1.webp'));await assert.rejects(checkDist(root),/Missing deployment file/);}));

test('release configuration digest metadata is bounded to its declared schema',()=>fixture(async root=>{
 await writeFile(join(root,'background-release.json'),JSON.stringify({schemaVersion:1,configSha256:'a'.repeat(64)}));assert.equal((await checkDist(root)).files.length,10);
 for(const value of [{schemaVersion:1,configSha256:['a'.repeat(64)]},{schemaVersion:2,configSha256:'a'.repeat(64)},{schemaVersion:1,configSha256:'private-sentinel'},{schemaVersion:1,configSha256:'a'.repeat(64),config:{private:'sentinel'}}]){
  await writeFile(join(root,'background-release.json'),JSON.stringify(value));await assert.rejects(checkDist(root),/Invalid background release metadata/);
 }
}));
