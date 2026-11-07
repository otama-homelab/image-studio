import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const builder=new URL('../tools/build_browser_model_prepare.mjs',import.meta.url);
test('RVM builder rejects mixed roles, wrong backend, missing pair or public admission before dependencies',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rvm-build-'));
 try{
  for(const alter of [p=>{p.enableModnetInference=true;p.modnetProcessor={};},p=>{p.profiles.rvm.executionProvider='webgpu';},p=>{p.models[0].resources.pop();},p=>{p.distributionApproved=true;}]){
   const policy={scope:'local-validation-only-not-approved-for-distribution',distributionApproved:false,localModelPath:'http://127.0.0.1:17861/models/',wasmOrigin:'http://127.0.0.1:17861',runtimeAssets:{},profiles:{rvm:{executionProvider:'wasm'}},enableRvmInference:true,models:[{model:'rvm',resources:[{name:'model.onnx'},{name:'restore.onnx'}]}]};alter(policy);const file=path.join(root,'policy.json');fs.writeFileSync(file,JSON.stringify(policy));const result=spawnSync(process.execPath,[builder.pathname,root,file,path.join(root,'output')],{encoding:'utf8',timeout:15000});assert.equal(result.error,undefined);assert.notEqual(result.status,0);assert.match(result.stderr,/Explicit isolated RVM pair policy required/);assert.equal(fs.existsSync(path.join(root,'output')),false);
  }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
