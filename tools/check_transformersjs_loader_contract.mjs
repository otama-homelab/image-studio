/** Tiny synthetic resource loading only; session creation is intercepted and rejected. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const [bundle,backend,output]=process.argv.slice(2);
if(!output||fs.existsSync(output))throw Error('Need bundle, JS backend, new output');
const prefix='https://model-fixture.invalid/releases/loader-r1/';
let network=0,creations=0;const requested=[],captures=[],store=new Map();
const common=await import(pathToFileURL(backend).href);
common.InferenceSession.create=async(bytes,options)=>{creations++;captures.push({bytes,options});throw Error('SYNTHETIC_SESSION_STOP');};
globalThis[Symbol.for('onnxruntime')]=common;
globalThis.fetch=async()=>{network++;throw Error('Real network forbidden');};
const {PreTrainedModel,VitMatteForImageMatting,env}=await import(pathToFileURL(bundle).href);
env.logLevel=50;env.useFS=false;env.useFSCache=false;env.useBrowserCache=false;env.useWasmCache=false;
env.useCustomCache=true;env.allowLocalModels=true;env.allowRemoteModels=false;env.localModelPath=prefix;
env.customCache={async match(k){return store.get(String(k))?.clone();},async put(k,r){store.set(String(k),new Response(await r.arrayBuffer()));}};
const graph=new Uint8Array([8,9,10,11]),external=new Uint8Array([21,22,23]);
env.fetch=async(input)=>{
 const url=String(input);requested.push(url);assert.ok(url.startsWith(prefix));
 if(url.endsWith('/onnx/model.onnx.data'))return new Response(external);
 if(url.endsWith('/onnx/model_fp16.onnx')||url.endsWith('/onnx/model.onnx'))return new Response(graph);
 throw Error('Unexpected resource');
};
for(const [role,Class,dtype] of [['hr',PreTrainedModel,'fp16'],['matte',VitMatteForImageMatting,'fp32']]){
 const before=requested.length;
 await assert.rejects(Class.from_pretrained(role,{config:{model_type:role==='hr'?'custom':'vitmatte'},device:'auto',dtype,model_file_name:'model',subfolder:'onnx',local_files_only:true,use_external_data_format:false,session_options:{executionProviders:['webgpu'],externalData:[{path:'model.onnx.data',data:'onnx/model.onnx.data'}],extra:{session:{disable_cpu_ep_fallback:'1'}}}}),/SYNTHETIC_SESSION_STOP/);
 const capture=captures.at(-1);assert.deepEqual(capture.bytes,graph);
 assert.equal(capture.options.externalData.length,1);
 assert.equal(capture.options.externalData[0].path,'model.onnx.data');
 assert.deepEqual(capture.options.externalData[0].data,external);
 assert.equal(capture.options.extra.session.disable_cpu_ep_fallback,'1');
 assert.ok(requested.slice(before).includes(prefix+role+'/onnx/'+(dtype==='fp16'?'model_fp16.onnx':'model.onnx')));
}
assert.equal(network,0);assert.equal(creations,2);
const report={status:'passed',checks:{fp16GraphSuffix:true,fp32GraphName:true,explicitExternalDataPathPreserved:true,externalBytesPassedToSession:true,graphBytesPassedToSession:true,sessionExtraForwarded:true},requestsIntercepted:requested,realNetworkRequests:network,sessionCreationIntercepts:creations,realSessionCreations:0,gpuRequests:0,currentRssBytes:process.memoryUsage().rss,limitations:['Synthetic four-byte graph and three-byte weights; session creation always throws. No valid ONNX or inference.','Node path branch with in-memory custom cache. device:auto avoids unavailable backend discovery in Common-only injection; explicit executionProviders is only forwarded, never executed. Browser loading/ORT options enforcement untested.','Actual ORT Common 1.31.1 injected; not default Transformers.js dependency acceptance.']};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
