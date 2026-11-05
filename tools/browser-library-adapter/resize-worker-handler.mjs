import {resizeTransport,resizeResult} from './resize-transport.mjs';
/** One accepted request per Worker. Runtime creation is injected and remains Worker-local. */
export function createResizeWorkerHandler({createResizer,postMessage}){
 let used=false;
 return async command=>{
  if(!command||typeof command.jobId!=='string'||!command.jobId)return;
  const error=code=>postMessage({type:'error',jobId:command.jobId,code});
  if(used||command.type!=='resize'){error('invalid-resize-input');return;}used=true;
  let payload,resizer;
  const close=()=>{const previous=resizer;resizer=null;previous?.close();};
  try{payload=resizeTransport(command.image,command.options);}catch{error('invalid-resize-input');return;}
  try{
   resizer=await createResizer(payload.options);
   const image=resizeResult(resizer.resize(payload.image,payload.options),payload.options);
   close();
   postMessage({type:'resized',jobId:command.jobId,image},[image.data]);
  }catch{try{close();}catch{}error('resize-worker-failed');}
  finally{try{close();}catch{}}
 };
}
