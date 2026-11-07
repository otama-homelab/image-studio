import {createResourcePolicy,ResourcePolicyError} from './resource-policy.mjs';
import {prepareStoredModel} from './prepared-model.mjs';

/** Own the fixed still-model/filter pair through the existing verified cache. */
export function createRvmPreparation({ort,env,fetchImpl,cache,makeHasher,configureRuntime}){
 const invalid=()=>{throw new ResourcePolicyError('invalid-preparation-policy');};
 if(typeof ort?.InferenceSession?.create!=='function'||typeof configureRuntime!=='function')invalid();
 return async function prepare(release,{emit=()=>{},signal,onDeviceLost=()=>{}}={}){
  if(release?.model!=='rvm'||!Array.isArray(release.resources)||release.resources.length!==2)invalid();
  const files=release.resources.map(f=>Object.freeze({...f})),names=['model.onnx','restore.onnx'];
  if(new Set(files.map(f=>f.name)).size!==2||!names.every(name=>files.some(f=>f.name===name)))invalid();
  let policy,runtime,closing,disposed=false;const sessions=[],active=new Set();
  policy=createResourcePolicy({files,fetchImpl,cache,makeHasher,signal,onEvent:()=>emit({type:'resource-state',modelVersion:release.modelVersion,resources:policy.getState()})});
  const checkAbort=()=>{if(signal?.aborted)throw new ResourcePolicyError('aborted');};
  const run=async(index,feeds)=>{
   if(disposed)throw Error('rvm-session-unavailable');
   const job=Promise.resolve().then(()=>sessions[index].run(feeds));active.add(job);
   try{return await job;}finally{active.delete(job);}
  };
  const handle={model:feeds=>run(0,feeds),restore:feeds=>run(1,feeds),dispose(){
   if(closing)return closing;disposed=true;
   closing=(async()=>{
    await Promise.allSettled([...active]);let failed=false;
    for(const session of [...sessions].reverse())try{await session.release();}catch{failed=true;}
    try{await runtime?.dispose();}catch{failed=true;}
    if(failed)throw Error('rvm-session-release-failed');
   })();return closing;
  }};
  try{return await prepareStoredModel({policy,requiredFiles:files,signal,load:async()=>{
   for(const file of files){
    checkAbort();const response=await policy.cache.match(file.url);
    if(response)await response.arrayBuffer();else await policy.cache.put(file.url,await policy.fetch(file.url));
   }
   checkAbort();runtime=await configureRuntime(env,{model:'rvm',precision:'float32',onDeviceLost});
   if(runtime?.executionProvider!=='wasm'||typeof runtime.dispose!=='function'||JSON.stringify(runtime.sessionOptions?.executionProviders)!==JSON.stringify(['wasm']))invalid();
   for(const name of names){
    checkAbort();const file=files.find(f=>f.name===name),response=await policy.cache.match(file.url);
    if(!response)throw new ResourcePolicyError('model-resources-not-stored');
    const bytes=new Uint8Array(await response.arrayBuffer());checkAbort();
    const session=await ort.InferenceSession.create(bytes,runtime.sessionOptions);sessions.push(session);
    if(typeof session?.run!=='function'||typeof session?.release!=='function')invalid();
    checkAbort();
   }
   return handle;
  }});}catch(error){await handle.dispose();throw error;}
 };
}
