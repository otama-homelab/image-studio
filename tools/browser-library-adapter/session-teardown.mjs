export class SessionTeardownError extends Error{
 constructor(){super('session-stop-failed');this.name='SessionTeardownError';this.code='session-stop-failed';}
}
/** invalidate synchronously closes UI admission/revision ownership before asynchronous shutdown. */
export function createSessionTeardown({invalidate,closeLinks,stopOperations=[],closeClients=[],closeScripts=[],releaseAssets}){
 if(![invalidate,closeLinks,releaseAssets,...stopOperations,...closeClients,...closeScripts].every(fn=>typeof fn==='function'))throw TypeError('invalid-session-teardown');
 const operations=[...stopOperations],clients=[...closeClients],scripts=[...closeScripts];
 let closing,state=Object.freeze({phase:'open',failedStages:Object.freeze([])});
 return Object.freeze({
  close(){
   if(closing)return closing;
   const failures=[];state=Object.freeze({phase:'closing',failedStages:Object.freeze([])});
   const stage=async(name,actions)=>{const results=await Promise.allSettled(actions.map(action=>Promise.resolve().then(action)));if(results.some(result=>result.status==='rejected'))failures.push(name);};
   closing=Promise.resolve().then(async()=>{
    await stage('operations',operations);
    await stage('clients',clients);
    await stage('scripts',scripts);
    // Keep session assets when resource shutdown is unproven, even after best-effort cleanup.
    if(!failures.length)await stage('assets',[releaseAssets]);
    state=Object.freeze({phase:failures.length?'failed':'closed',failedStages:Object.freeze([...failures])});
    if(failures.length)throw new SessionTeardownError();
   });
   try{invalidate();}catch{failures.push('invalidate');}
   try{closeLinks();}catch{failures.push('links');}
   return closing;
  },
  getState(){return state;},
 });
}
