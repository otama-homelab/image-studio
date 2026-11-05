import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const tool=fileURLToPath(new URL('../tools/build_browser_trimap_worker.mjs',import.meta.url));
for(const kind of ['wrong-version','escaped-source','private-wasm','unmatched-proof'])test('compiled OpenCV packaging refuses '+kind+' before creating output',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'opencv-package-'));
 try{
  const binary=kind==='private-wasm'?Buffer.concat([Buffer.from('0061736d01000000','hex'),Buffer.from('/home/yamato/private')]):Buffer.from('0061736d01000000','hex');
  const script=Buffer.from('const binary="data:application/octet-stream;base64,'+binary.toString('base64')+'";');fs.writeFileSync(path.join(root,'opencv.js'),script);
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  const descriptor={scope:'local-validation-only-not-approved-for-distribution',distributionApproved:false,opencvVersion:kind==='wrong-version'?'5.0.0':'4.11.0',script:kind==='escaped-source'?tool:'opencv.js',scriptSha256:sha(script),nativeComparison:'proof.json'};
  fs.writeFileSync(path.join(root,'proof.json'),JSON.stringify({status:'no-dynamic-js-runtime-and-native-trimap-fixtures-passed',scriptSha256:'0'.repeat(64),networkAttempts:0,cases:Array.from({length:8},()=>({kernelMatches:true}))}));
  fs.writeFileSync(path.join(root,'descriptor.json'),JSON.stringify(descriptor));
  const output=path.join(root,'output'),result=spawnSync(process.execPath,[tool,root,output,'descriptor.json'],{encoding:'utf8',timeout:10000});assert.equal(result.status,1);assert.equal(fs.existsSync(output),false);
  const expected={'wrong-version':'Private OpenCV4.11 candidate required','escaped-source':'Captured private file required','private-wasm':'Invalid/private embedded WASM','unmatched-proof':'Matching no-eval/native comparison required'}[kind];assert.ok(result.stderr.includes(expected));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
