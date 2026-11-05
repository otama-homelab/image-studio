import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,symlink,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verifyArtifact,stageRuntime,verifyRuntimeStage} from '../tools/stage_browser_runtime.mjs';
async function fixture(run){const root=await mkdtemp(path.join(os.tmpdir(),'runtime-stage-'));try{await run(root);}finally{await rm(root,{recursive:true,force:true});}}
test('artifact verification rejects byte drift, length drift and symlinks',()=>fixture(async root=>{
 const file=path.join(root,'file'),bytes=Buffer.from([1,2,3]),expected={bytes:3,sha256:createHash('sha256').update(bytes).digest('hex')};await writeFile(file,bytes);await verifyArtifact(file,expected);await writeFile(file,Buffer.from([1,2,4]));await assert.rejects(verifyArtifact(file,expected),/runtime-artifact-sha/);await writeFile(file,Buffer.from([1]));await assert.rejects(verifyArtifact(file,expected),/runtime-artifact-size-or-type/);await symlink(file,path.join(root,'link'));await assert.rejects(verifyArtifact(path.join(root,'link'),expected),/runtime-artifact-size-or-type/);
}));
test('wrong package version cannot create a staging directory',()=>fixture(async root=>{
 const packageRoot=path.join(root,'package'),output=path.join(root,'output');await mkdir(packageRoot);await writeFile(path.join(packageRoot,'package.json'),JSON.stringify({name:'onnxruntime-web',version:'other'}));await assert.rejects(stageRuntime(packageRoot,output),/runtime-package-mismatch/);await assert.rejects(readFile(path.join(output,'manifest.json')),{code:'ENOENT'});
}));
test('existing output is refused before reading or copying package data',()=>fixture(async root=>{
 const output=path.join(root,'output');await mkdir(output);await writeFile(path.join(output,'sentinel'),'keep');await assert.rejects(stageRuntime(path.join(root,'missing-package'),output),/runtime-output-exists/);assert.equal(await readFile(path.join(output,'sentinel'),'utf8'),'keep');
}));
test('stage verifier refuses mixed metadata, missing assets, unlisted files and symlinks',()=>fixture(async root=>{
 const trusted=JSON.parse(await readFile(new URL('../docs/browser/runtime-assets.candidate.json',import.meta.url),'utf8'));
 const notices=JSON.parse(await readFile(new URL('../docs/browser/runtime-notices/sources.json',import.meta.url),'utf8')).sources.map(({file,bytes,sha256})=>({file,bytes,sha256}));
 const receipt={status:'staged-not-deployed',runtimeFamily:'native',runtime:trusted.runtime,version:trusted.version,wasmFamily:trusted.wasmFamily,entrypoint:trusted.entrypoint,deploymentPerformed:false,notices,files:trusted.files.map(({url,...file})=>({...file,key:`runtime/ort/${trusted.version}/${file.sha256}/${file.name}`}))};
 const manifest=path.join(root,'manifest.json');await writeFile(manifest,JSON.stringify({...receipt,wasmFamily:'jsep'}));
 await assert.rejects(verifyRuntimeStage(root),/runtime-stage-contract-mismatch/);
 await writeFile(manifest,JSON.stringify(receipt));await assert.rejects(verifyRuntimeStage(root),/runtime-stage-missing-file/);
 const extra=path.join(root,'unlisted-key.pem');await writeFile(extra,'private-sentinel');await assert.rejects(verifyRuntimeStage(root),/runtime-stage-unexpected-file/);await rm(extra);
 await symlink(manifest,path.join(root,'unlisted-link'));await assert.rejects(verifyRuntimeStage(root),/runtime-stage-symlink/);
}));
