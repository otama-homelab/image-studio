/** Exercise published AutoConfig/cache controls with in-memory HTTP responses. No model. */
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const [bundle,tensorBackend,output]=process.argv.slice(2);
if(!bundle||!tensorBackend||!output||process.argv.length!==5||fs.existsSync(output))throw Error('Need local bundle, common JS backend and new output JSON');
let sessions=0,gpuRequests=0,unhookedFetchRequests=0;const requests=[],writes=[],warnings=[],cache=new Map(),memory=[process.memoryUsage().rss];
const prefix='https://model-fixture.invalid/releases/r1/';
const config={model_type:'vitmatte',architectures:['VitMatteForImageMatting'],hidden_size:768};
let quotaFailure=false;
Object.defineProperty(globalThis.navigator,'gpu',{value:{requestAdapter:async()=>{gpuRequests++;throw Error('GPU forbidden');}},configurable:true});
globalThis.fetch=async(input,options={})=>{
 const url=String(input instanceof Request?input.url:input);requests.push({url,method:options.method||'GET'});
 assert.ok(url.startsWith(prefix),'No request outside fixed fixture origin/release');
 assert.equal(options.method||'GET','GET');
 return url.includes('/missing/')?new Response('missing',{status:404}):new Response(JSON.stringify(config),{status:200,headers:{'Content-Type':'application/json'}});
};
const fixtureFetch=globalThis.fetch;
const originalWarn=console.warn;console.warn=(...args)=>warnings.push(args.map(x=>x instanceof Error?x.name:String(x)).join(' ').slice(0,240));
try {
 const common=await import(pathToFileURL(tensorBackend).href);common.InferenceSession.create=async()=>{sessions++;throw Error('Model session forbidden');};
 globalThis[Symbol.for('onnxruntime')]=common;
 const {AutoConfig,env}=await import(pathToFileURL(bundle).href);
 env.fetch=fixtureFetch;
 globalThis.fetch=async()=>{unhookedFetchRequests++;throw Error('Library bypassed the env.fetch policy hook');};
 env.useFS=false;env.useFSCache=false;env.useBrowserCache=false;env.useWasmCache=false;
 env.useCustomCache=true;env.allowLocalModels=true;env.allowRemoteModels=false;env.localModelPath=prefix;
 env.experimental_useCrossOriginStorage=false;
 env.customCache={
  async match(key){return cache.get(String(key))?.clone();},
  async put(key,response){
   const name=String(key);assert.ok(name.startsWith(prefix));writes.push(name);
   if(quotaFailure)throw new DOMException('Synthetic quota failure','QuotaExceededError');
   cache.set(name,response.clone());
  },
 };
 const options={local_files_only:true,revision:'fixed-fixture-revision'};
 const first=await AutoConfig.from_pretrained('fixture/vitmatte',options);
 assert.equal(first.model_type,'vitmatte');assert.equal(requests.length,1);assert.equal(cache.size,1);
 const afterCold=requests.length;
 const second=await AutoConfig.from_pretrained('fixture/vitmatte',options);
 assert.equal(second.model_type,'vitmatte');assert.equal(requests.length,afterCold);
 const changedRevision=await AutoConfig.from_pretrained('fixture/vitmatte',{...options,revision:'another-fixture-revision'});
 assert.equal(changedRevision.model_type,'vitmatte');assert.equal(requests.length,afterCold); // local path remains the same
 const missingStart=requests.length;
 await assert.rejects(AutoConfig.from_pretrained('missing/vitmatte',options));
 assert.equal(requests.length,missingStart+1);
 const directStart=requests.length;
 await assert.rejects(AutoConfig.from_pretrained('https://forbidden-fixture.invalid/vitmatte',options));
 assert.equal(requests.length,directStart);
 // Parse corruption must not silently pass as valid config or trigger a Hub retry.
 const configKey=writes[0];cache.set(configKey,new Response('{broken',{status:200}));
 const corruptStart=requests.length;
 await assert.rejects(AutoConfig.from_pretrained('fixture/vitmatte',options));
 assert.equal(requests.length,corruptStart);
 cache.clear();quotaFailure=true;
 const uncached=await AutoConfig.from_pretrained('fixture/vitmatte',options);
 assert.equal(uncached.model_type,'vitmatte');assert.equal(cache.size,0);
 assert.equal(sessions,0);assert.equal(gpuRequests,0);assert.equal(unhookedFetchRequests,0);
 memory.push(process.memoryUsage().rss);
 const report={status:'published_library_config_cache_controls_checked',library:'@huggingface/transformers 4.3.2 browser bundle',tensorBackend:'Actual ORT Common 1.31.1 JS injection; not a validated app dependency override',checks:{coldConfigFetch:true,cacheHitWithoutFetch:true,missingLocalConfigHasNoHubFallback:true,absoluteRemoteIdRejectedBeforeFetch:true,corruptCachedJsonRejectedWithoutFetch:true,quotaWriteFailureReturnsUncachedConfig:true,documentedFetchHookUsed:true,localCacheHitPersistsAcrossRevisionOptionChange:true},unhookedFetchRequests,fetchCallsIntercepted:requests,cachePutAttempts:writes.length,sessionRequests:sessions,gpuRequests,realNetworkRequests:0,warningsCount:warnings.length,currentRssSamplesBytes:memory,limitations:['Custom cache is an in-memory test double; native browser Cache Storage persistence/quota behavior untested.','All HTTP responses were synthetic in-memory Responses; R2/CORS not tested.','Quota failure does not imply data was persisted: application must surface this state.','JSON syntax rejection is not SHA/content integrity checking; application manifest verification remains required.','No model files, inference, WASM initialization or image processing tested.']};
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
}catch(error){console.error((error.stack||error.message).split('\n').slice(0,6).join('\n'));process.exitCode=1;}
finally{console.warn=originalWarn;}
