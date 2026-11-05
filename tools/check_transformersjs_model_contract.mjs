/** Published model wrapper contract only. Fake failing session; no inference/weights. */
import {runWorkerOperation} from './browser-library-adapter/worker-failure.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const [bundle,backend,output]=process.argv.slice(2);
if(!output||fs.existsSync(output))throw Error('Need bundle, JS backend, new report path');
let network=0,sessions=0,runs=0,released=0;const captured=[];
globalThis.fetch=async()=>{network++;throw Error('Network forbidden');};
const common=await import(pathToFileURL(backend).href);
common.InferenceSession.create=async()=>{sessions++;throw Error('Session creation forbidden');};
globalThis[Symbol.for('onnxruntime')]=common;
const {PreTrainedModel,Tensor,env}=await import(pathToFileURL(bundle).href);
const oldError=console.error;
console.error=(...args)=>captured.push(args);
try{
 const model=new PreTrainedModel({model_type:'custom'}, {model:{inputNames:['pixels'],async run(feed){runs++;assert.deepEqual(Object.keys(feed),['pixels']);throw Error('Synthetic session failure');},async release(){released++;}}},{});
 const input=new Tensor('float32',new Float32Array([0.125,0.25,0.5]),[1,3,1,1]);
 env.logLevel=30;
 await assert.rejects(model({pixels:input}),/Synthetic session failure/);
 assert.equal(captured.length,2);assert.ok(captured[1][1].pixels.data instanceof Float32Array);
 captured.length=0;env.logLevel=50; // published LogLevel.NONE value; enum is not re-exported by this bundle
 const safeFailure=await runWorkerOperation({workerId:'worker-1',jobId:'job-1'},()=>model({pixels:input}));
 assert.deepEqual(safeFailure,{ok:false,event:{workerId:'worker-1',jobId:'job-1',type:'error',code:'runtime-error',retryable:true}});
 assert.equal(captured.length,0);
 const before=runs;
 await assert.rejects(model({pixel_values:input}),/Missing the following inputs: pixels/);
 assert.equal(runs,before);
 await model.dispose();assert.equal(released,1);
 input.dispose();assert.equal(network,0);assert.equal(sessions,0);
 const report={status:'passed',library:'@huggingface/transformers 4.3.2 published browser bundle',checks:{customPixelsNameReachesSession:true,wrongInputNameRejectedBeforeRun:true,defaultErrorLoggingIncludesInputData:true,noneLevelSuppressesLibraryErrorLogging:true,fixedWorkerFailureExcludesExceptionPayload:true,disposeAwaitsSessionRelease:true},networkRequests:network,sessionCreations:sessions,realInferenceRuns:0,syntheticFailingSessionCalls:runs,currentRssBytes:process.memoryUsage().rss,limitations:['Fake failing session tests wrapper behavior only; no real model/ORT inference compatibility established.','Node runtime with actual ORT Common JS Tensor injection; browser behavior untested.','NONE suppresses this library logger only; ORT/native/browser logs and thrown exceptions require separate review.']};
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 oldError(JSON.stringify(report));
}finally{console.error=oldError;}
