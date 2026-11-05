/** Published browser library/runtime binding, with session creation stopped before any engine init. */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {nodeTaskWorker} from '../tests/fixtures/node-export-worker.mjs';
const [evaluationRoot,output]=process.argv.slice(2);if(!evaluationRoot||!output||fs.existsSync(output))throw Error('Need PRIVATE_EVALUATION_ROOT NEW_OUTPUT');
const privateRoot=path.resolve(evaluationRoot),out=path.resolve(output),repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');fs.mkdirSync(out,{mode:0o700});
const transformer=path.join(privateRoot,'transformersjs-reuse-review-01/npm-4.3.2/package/dist/transformers.web.js'),ort=path.join(privateRoot,'runtime-packages/ort-web-1.31.1/package/dist/ort.webgpu.bundle.min.mjs'),common=path.join(privateRoot,'transformersjs-reuse-review-01/ort-common-1.31.1/package/dist/esm/index.js'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(fs.readFileSync(transformer)),'cd7d3236182f456b0b7833015f956df0c71ad63c0ef8bb4d9857d2a787c076e7');
const entry=path.join(out,'entry.mjs'),bundle=path.join(out,'probe.js');
fs.writeFileSync(entry,`import * as library from 'transformers-candidate';import * as ort from 'ort-candidate';import {createOrtRuntimeBootstrap} from ${JSON.stringify(path.join(repo,'tools/browser-library-adapter/ort-runtime-bootstrap.mjs'))};
let used=false;self.addEventListener('message',async({data:{role,external}})=>{if(used)return;used=true;const requests=[];let creates=0,adapters=0,devices=0,destroys=0,capture,runtime;
try{
 if(!['hr','matte'].includes(role)||typeof external!=='boolean')throw Error('invalid-role');
 let lose;const device={lost:new Promise(resolve=>{lose=resolve;}),destroy(){destroys++;lose({reason:'destroyed'});}};
 const gpu={async requestAdapter(){adapters++;return {features:new Set(['shader-f16']),limits:{maxBufferSize:1024},async requestDevice(){devices++;return device;}};}};
 const configure=createOrtRuntimeBootstrap({ort,gpu,origin:'https://app.invalid',wasmOrigin:'https://assets.invalid',runtimeAssets:{mjs:'https://app.invalid/runtime/fixed.mjs',wasm:'https://assets.invalid/runtime/fixed.wasm'},requiredLimits:{maxBufferSize:1024},maxNumPendingDispatches:1});
 const env=library.env;env.logLevel=50;env.allowRemoteModels=false;env.allowLocalModels=true;env.localModelPath='https://app.invalid/releases/test/';env.useFS=false;env.useFSCache=false;env.useBrowserCache=false;env.useCustomCache=false;env.useWasmCache=false;
 env.fetch=async url=>{url=String(url);requests.push(url);if(url.endsWith('/onnx/'+(role==='hr'?'model_fp16.onnx':'model.onnx')))return new Response(Uint8Array.of(8,9,10,11));if(url.endsWith('/onnx/model.onnx.data'))return new Response(Uint8Array.of(21,22,23));throw Error('unexpected-resource');};
 runtime=await configure(env,{model:role,precision:role==='hr'?'float16':'float32'});
 const tensor=new library.Tensor('float32',Float32Array.of(0.5),[1]);const tensorCompatible=tensor.ort_tensor instanceof ort.Tensor;tensor.dispose();
 ort.InferenceSession.create=async(bytes,options)=>{creates++;capture={graphBytes:bytes.length,externalBytes:options.externalData?.[0]?.data?.length,externalPath:options.externalData?.[0]?.path,provider:options.executionProviders?.[0]?.name,ownsDevice:options.executionProviders?.[0]?.device===device,fallback:options.extra?.session?.disable_cpu_ep_fallback,pendingDispatches:options.extra?.ep?.webgpuexecutionprovider?.maxNumPendingDispatches??'runtime-default',sessionFlags:Object.fromEntries(['enableGraphCapture','graphOptimizationLevel','enableCpuMemArena','enableMemPattern'].map(key=>[key,options[key]??'runtime-default'])),preferredLayout:options.executionProviders?.[0]?.preferredLayout??'runtime-default'};throw Error('SYNTHETIC_SESSION_STOP');};
 const Model=role==='hr'?library.PreTrainedModel:library.VitMatteForImageMatting;let stopped=false,loadFailure;
 try{await Model.from_pretrained(role,{config:{model_type:role==='hr'?'custom':'vitmatte'},device:'webgpu',dtype:role==='hr'?'fp16':'fp32',model_file_name:'model',subfolder:'onnx',local_files_only:true,use_external_data_format:false,session_options:{...runtime.sessionOptions,externalData:external?[{path:'model.onnx.data',data:'onnx/model.onnx.data'}]:[]}});}catch(error){stopped=error.message==='SYNTHETIC_SESSION_STOP';loadFailure=String(error.message).slice(0,100);}
 await runtime.dispose();runtime=null;
 self.postMessage({type:'contract',role,external,stopped,loadFailure,tensorCompatible,version:ort.env.versions.web,requests,creates,adapters,devices,destroys,capture,numThreads:ort.env.wasm.numThreads,proxy:ort.env.wasm.proxy});
}catch(error){try{await runtime?.dispose();}catch{}self.postMessage({type:'probe-error',code:String(error?.message).slice(0,100)});}});
`);
const esbuild=createRequire(import.meta.url)(path.join(privateRoot,'png-export-01/node_modules/esbuild/lib/main.js'));
try{await esbuild.build({entryPoints:[entry],outfile:bundle,bundle:true,minify:true,platform:'browser',format:'iife',target:'es2022',logLevel:'silent',legalComments:'linked',alias:{'transformers-candidate':transformer,'ort-candidate':ort,'onnxruntime-web/webgpu':ort,'onnxruntime-common':ort}});}finally{esbuild.stop();}
const cases=[],proofs=[];let stoppedWorkers=0;
for(const [role,external] of [['hr',true],['matte',true],['hr',false]]){
 const worker=nodeTaskWorker(new URL('../tests/fixtures/browser-export-thread.mjs',import.meta.url),{browserBundle:bundle,webgpuPresence:true},64,proof=>proofs.push(proof));
 try{
  const event=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('probe-timeout')),15000);worker.addEventListener('error',()=>{clearTimeout(timer);reject(Error('probe-worker-error'));});worker.addEventListener('message',message=>{if(message.data.type==='sandbox-proof')return;clearTimeout(timer);resolve(message.data);});worker.postMessage({role,external});});
  assert.equal(event.type,'contract',JSON.stringify(event));assert.equal(event.version,'1.31.1');assert.equal(event.stopped,true,JSON.stringify(event));assert.equal(event.tensorCompatible,true,'Tensor constructors must be shared');assert.equal(event.creates,1);assert.equal(event.adapters,1);assert.equal(event.devices,1);assert.equal(event.destroys,1);assert.deepEqual(event.capture,{graphBytes:4,externalBytes:external?3:undefined,externalPath:external?'model.onnx.data':undefined,provider:'webgpu',ownsDevice:true,fallback:role==='hr'?'1':'0',pendingDispatches:'1',sessionFlags:{enableGraphCapture:'runtime-default',graphOptimizationLevel:'runtime-default',enableCpuMemArena:'runtime-default',enableMemPattern:'runtime-default'},preferredLayout:'runtime-default'});assert.equal(event.numThreads,1);assert.equal(event.proxy,false);assert.equal(event.requests.length,external?2:1);cases.push(event);
 }finally{await worker.terminate();stoppedWorkers++;}
}
assert.equal(proofs.length,3);assert.ok(proofs.every(proof=>proof.nodeGlobalsAbsent&&proof.dynamicCodeDisabled&&proof.networkAttempts===0&&proof.wasmCompiles===0&&proof.wasmAbsent));
const report={status:'passed',library:'Transformers4.3.2',runtime:'ORT Web1.31.1 with shared bundled Common Tensor',cases,sandboxProofs:proofs,workersStopped:stoppedWorkers,bundleSha256:sha(fs.readFileSync(bundle)),limits:['GPU objects are artificial, not real adapter/device requests','Actual published browser loader reaches intercepted Session.create with4byte graph/3byte weights only; no valid ONNX or inference','WebAssembly absent; no native runtime initialized','Actual Chrome/CSP, Tensor run interoperability, model resources and quality still unverified']};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cases:cases.length,workersStopped:stoppedWorkers}));
