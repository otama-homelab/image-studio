import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,symlink} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {createPrivateArtifactReview,verifyPrivateArtifactReview,writePrivateArtifactReview} from '../tools/review_browser_private_artifact.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(run){const root=await mkdtemp(join(tmpdir(),'studio-private-review-'));try{const rows=[['/local-validation.html','entry','index'],['/worker.js','worker','worker'],['/NOTICE.txt','notice','license'],['/model.onnx','model',Buffer.alloc(2*1024*1024+17,37)]];const mounts=[];for(const [route,name,body] of rows){const bytes=Buffer.from(body);await writeFile(join(root,name),bytes);mounts.push({route,source:join(root,name),bytes:bytes.length,sha256:sha(bytes)});}const value={status:'local-app-built-not-started',scope:'local-validation-only-not-approved-for-distribution',distributionApproved:false,appOrigin:'http://127.0.0.1:17861',entry:'/local-validation.html',policySha256:'a'.repeat(64),mounts},file=join(root,'manifest.json');const save=()=>writeFile(file,JSON.stringify(value));await save();await run({root,file,value,save});}finally{await rm(root,{recursive:true,force:true});}}
test('streams model bytes, binds notice and worker independently, and excludes host paths from content ID',()=>fixture(async({root,file,value,save})=>{
 const initial=await createPrivateArtifactReview(root,file);assert.equal(initial.verification.bytesRead,initial.totalBytes);assert.equal(initial.files.length,4);assert.ok(!JSON.stringify(initial).includes(root));await verifyPrivateArtifactReview(root,file,initial);
 const notice=value.mounts.find(x=>x.route==='/NOTICE.txt');await writeFile(notice.source,'changed');notice.bytes=7;notice.sha256=sha('changed');await save();const revised=await createPrivateArtifactReview(root,file);assert.notEqual(initial.artifactId,revised.artifactId);assert.equal(initial.files.find(x=>x.route==='/worker.js').sha256,revised.files.find(x=>x.route==='/worker.js').sha256);await assert.rejects(verifyPrivateArtifactReview(root,file,initial),/differs/);
}));
test('same-size weight corruption and incomplete bytes fail without writing a review',()=>fixture(async({root,file,value})=>{
 const weight=value.mounts.find(x=>x.route==='/model.onnx'),output=join(root,'review.json');await writeFile(weight.source,Buffer.alloc(weight.bytes,38));await assert.rejects(writePrivateArtifactReview(root,file,output),/SHA/);await assert.rejects(readFile(output),{code:'ENOENT'});await writeFile(weight.source,'short');await assert.rejects(createPrivateArtifactReview(root,file),/size mismatch/);
}));
test('aliases are hashed once but must have consistent declarations; canonical order is stable',()=>fixture(async({root,file,value,save})=>{
 const first=await createPrivateArtifactReview(root,file);value.mounts.reverse();await save();const reordered=await createPrivateArtifactReview(root,file);assert.equal(first.artifactId,reordered.artifactId);value.mounts.push({...value.mounts[0],route:'/model-alias.onnx'});await save();const aliased=await createPrivateArtifactReview(root,file);assert.equal(aliased.verification.uniqueSources,4);assert.equal(aliased.verification.bytesRead,first.totalBytes);value.mounts.at(-1).sha256='b'.repeat(64);await save();await assert.rejects(createPrivateArtifactReview(root,file),/Conflicting/);
}));
test('rejects duplicate/encoded/traversing routes, public manifests, missing entry and source symlinks',()=>fixture(async({root,file,value,save})=>{
 const original=structuredClone(value);for(const route of ['/worker.js','/bad%2fname','/a/../name','//other.invalid/file']){value.mounts.push({...value.mounts[0],route});await save();await assert.rejects(createPrivateArtifactReview(root,file),/mount/);value.mounts.pop();}
 value.distributionApproved=true;await save();await assert.rejects(createPrivateArtifactReview(root,file),/Private candidate/);Object.assign(value,structuredClone(original));value.entry='/missing';await save();await assert.rejects(createPrivateArtifactReview(root,file),/Missing candidate entry/);value.entry=original.entry;await symlink(value.mounts[0].source,join(root,'link'));value.mounts[0].source=join(root,'link');await save();await assert.rejects(createPrivateArtifactReview(root,file),/Regular/);
}));
test('review output is private and cannot overwrite an existing file; unmounted files do not enter it',()=>fixture(async({root,file})=>{
 const output=join(root,'review.json');const review=await writePrivateArtifactReview(root,file,output);await verifyPrivateArtifactReview(root,file,review);await assert.rejects(writePrivateArtifactReview(root,file,output),{code:'EEXIST'});await writeFile(join(root,'unmounted-secret'),'ignored');assert.equal((await createPrivateArtifactReview(root,file)).artifactId,review.artifactId);await assert.rejects(writePrivateArtifactReview(root,file,join(root,'../bad-review.json')),/inside private root/);
}));

test('a regular mount outside the explicit private root is rejected before hashing',()=>fixture(async({root,file,value,save})=>{
 const external=await mkdtemp(join(tmpdir(),'studio-private-outside-'));
 try{const source=join(external,'model');await writeFile(source,'external');value.mounts[0]={...value.mounts[0],source,bytes:8,sha256:sha('external')};await save();await assert.rejects(createPrivateArtifactReview(root,file),/outside private root/);}
 finally{await rm(external,{recursive:true,force:true});}
}));

test('LAN byte review requires explicit HTTPS RFC1918 CPU-only manifest',()=>fixture(async({root,file,value,save})=>{
 value.appOrigin='https://192.168.100.8:17863';await save();await assert.rejects(createPrivateArtifactReview(root,file),/origin/);
 value.privateLanHttps=true;value.backgroundModel='modnet';value.runtimeConfig={executionProvider:'wasm'};await save();assert.equal((await createPrivateArtifactReview(root,file)).files.length,4);
 value.runtimeConfig.executionProvider='webgpu';await save();await assert.rejects(createPrivateArtifactReview(root,file),/CPU-only/);
 value.runtimeConfig.executionProvider='wasm';value.appOrigin='https://8.8.8.8';await save();await assert.rejects(createPrivateArtifactReview(root,file),/origin/);
}));
