/** Single-file picker binding. No filenames, Blob references or pixel bytes in published state. */
export function bindFileInput({input,owner,pageTarget,onChange=()=>{}}){
 let closed=false,epoch=0,closingPromise,state=Object.freeze({phase:'idle',input:owner.get(),errorCode:null});
 const publish=patch=>{state=Object.freeze({...state,...patch});try{onChange(state);}catch{}};
 const changed=async()=>{
  if(closed)return;
  let file;
  try{file=input.files?.[0];if(!file)return;input.value='';}
  catch{publish({phase:'error',errorCode:'input-selection-failed'});return;}
  const ticket=++epoch;publish({phase:'loading',errorCode:null});
  // A synchronous observer may close/reselect while receiving the loading state.
  if(closed||ticket!==epoch)return;
  try{
   const result=await owner.load(file);
   if(closed||ticket!==epoch)return;
   publish({phase:result.status==='ready'?'ready':'idle',input:owner.get(),errorCode:null});
  }catch{
   if(closed||ticket!==epoch)return;
   publish({phase:'error',input:owner.get(),errorCode:owner.getState().blocked?'input-stop-failed':'input-load-failed'});
  }
 };
 const change=()=>{void changed();};
 const close=()=>{
  if(closingPromise)return closingPromise;
  closed=true;epoch++;input.removeEventListener('change',change);pageTarget?.removeEventListener('pagehide',pagehide);
  closingPromise=Promise.resolve().then(()=>owner.close()).catch(()=>{throw new Error('input-stop-failed');});
  publish({phase:'closed',input:null,errorCode:null});return closingPromise;
 };
 const pagehide=()=>{void close().catch(()=>{});};
 input.multiple=false;input.addEventListener('change',change);pageTarget?.addEventListener('pagehide',pagehide);
 return Object.freeze({getState:()=>state,close});
}
