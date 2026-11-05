/** Test-only VM: enforce no dynamic JS, execute existing adapter against pinned native fixtures. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createOpenCvTrimap} from './browser-library-adapter/opencv-trimap.mjs';
async function main(){
const [script,directory,output]=process.argv.slice(2);
if(!script||!directory||!output||fs.existsSync(output)||fs.statSync(script).size>32*1024**2)throw Error('Need bounded OPENCV_JS PINNED_REFERENCE_DIRECTORY NEW_OUTPUT');
const sha=data=>createHash('sha256').update(data).digest('hex'),source=fs.readFileSync(script,'utf8');
const reference=JSON.parse(fs.readFileSync(path.join(directory,'report.json')));
assert.equal(reference.status,'pinned-native-reference-captured');assert.equal(reference.opencv,'4.11.0');assert.equal(reference.package.verified,true);assert.equal(reference.cases.length,8);
let networkAttempts=0;
const context=vm.createContext({console,performance,setTimeout,clearTimeout,atob,TextDecoder,TextEncoder,location:{href:'https://invalid.test/opencv.js'},importScripts(){networkAttempts++;throw Error('network-disabled');},fetch(){networkAttempts++;throw Error('network-disabled');}},{codeGeneration:{strings:false,wasm:true}});
vm.runInContext('globalThis.self=globalThis;',context);
assert.throws(()=>vm.runInContext('new Function("return 1")()',context),/Code generation from strings disallowed/);
new vm.Script(source,{filename:'verified-opencv.js'}).runInContext(context,{timeout:30000});
let timer;const started=performance.now();let cv;
try{cv=await Promise.race([context.cv,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('opencv-init-timeout')),30000);})]);}finally{clearTimeout(timer);}
assert.equal(typeof cv?.Mat,'function');const make=createOpenCvTrimap(cv),cases=[];
for(const row of reference.cases){
 const alpha=fs.readFileSync(path.join(directory,row.stem+'-alpha.bin')),expected=fs.readFileSync(path.join(directory,row.stem+'-trimap.bin'));
 assert.equal(sha(alpha),row.alphaSha256);assert.equal(sha(expected),row.trimapSha256);
 const bytes=Uint8Array.from(alpha),at=performance.now(),result=make({width:row.width,height:row.height,layout:'alpha-u8',data:bytes.buffer});
 assert.deepEqual(Buffer.from(result.data),expected);assert.deepEqual(Buffer.from(bytes),alpha);
 const kernel=cv.getStructuringElement(cv.MORPH_ELLIPSE,new cv.Size(2*row.radius+1,2*row.radius+1));try{assert.equal(sha(kernel.data),row.kernelSha256);}finally{kernel.delete();}
 cases.push({stem:row.stem,width:row.width,height:row.height,elapsedMs:performance.now()-at,trimapSha256:sha(new Uint8Array(result.data)),kernelMatches:true});
}
assert.equal(networkAttempts,0);
const report={status:'no-dynamic-js-runtime-and-native-trimap-fixtures-passed',scriptSha256:sha(Buffer.from(source)),referenceReportSha256:sha(fs.readFileSync(path.join(directory,'report.json'))),cases,networkAttempts,elapsedMs:performance.now()-started,limits:['Node VM dynamic-code prohibition; native browser CSP acceptance remains separate.','Eight saved synthetic native4.11 fixtures; not full quality/performance/resource acceptance.','No models/GPU/browser started.']};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({status:report.status,cases:cases.length}));

}
main().catch(error=>{console.error(JSON.stringify({status:"failed",name:error.name,message:String(error.message).slice(0,300)}));process.exitCode=1;});
