import {ResourcePolicyError} from './resource-policy.mjs';
const fail=code=>{throw new ResourcePolicyError(code);};

/** Gate the existing library loader's returned model; no loader/cache/session implementation here. */
export async function prepareStoredModel({load,policy,requiredFiles,signal,isCurrent=()=>true}){
 if(typeof load!=='function'||typeof policy?.getState!=='function'||typeof isCurrent!=='function'
  ||!Array.isArray(requiredFiles)||requiredFiles.length===0
  ||requiredFiles.some(f=>!f||!/^[a-f0-9]{64}$/.test(f.sha256)||!Number.isSafeInteger(f.bytes)||f.bytes<1))fail('invalid-preparation-policy');
 let model,reason;
 try{
  if(signal?.aborted)fail('aborted');
  if(!isCurrent())fail('operation-stale');
  try{model=await load();}catch{fail(signal?.aborted?'aborted':'model-load-failed');}
  if(!model||typeof model.dispose!=='function')fail('invalid-model-handle');
  if(signal?.aborted)fail('aborted');
  if(!isCurrent())fail('operation-stale');
  const states=policy.getState();
  // State intentionally omits URLs. Preserve multiplicity: identical content at
  // separate manifest URLs still requires each resource to be stored/verified.
  if(!Array.isArray(states)||states.length!==requiredFiles.length)fail('model-resources-not-stored');
  const pending=[...states];
  for(const file of requiredFiles){
   const index=pending.findIndex(state=>state.sha256===file.sha256&&state.bytes===file.bytes&&state.stored&&(state.networkVerified||state.cacheVerified));
   if(index<0)fail('model-resources-not-stored');
   pending.splice(index,1);
  }
  return model;
 }catch(error){reason=error instanceof ResourcePolicyError?error.code:'preparation-failed';}
 if(model&&typeof model.dispose==='function'){
  try{await model.dispose();}catch{fail('model-release-failed');}
 }
 fail(reason);
}
