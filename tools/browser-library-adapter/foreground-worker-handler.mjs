import {foregroundPixels} from './foreground-pixels.mjs';
import {foregroundToRgba} from './foreground-rgba.mjs';
import {foregroundInput} from './foreground-memory.mjs';
export function foregroundResult(result,expected){
 if(result?.width!==expected.width||result?.height!==expected.height||['foreground','background'].some(name=>!(result[name] instanceof Float32Array)||!(result[name].buffer instanceof ArrayBuffer)||result[name].length!==expected.width*expected.height*3||result[name].some(value=>!Number.isFinite(value)||value<0||value>1)))throw Error('invalid-foreground-result');
 return {width:result.width,height:result.height,foreground:result.foreground,background:result.background};
}
/** One request per Worker; cancellation ACK follows runtime cleanup. */
export function createForegroundWorkerHandler({createRuntime,postMessage}){
 let used=false,active=null,finished=null;
 return async command=>{
  if(typeof command?.jobId!=='string'||!command.jobId)return;
  const jobId=command.jobId,error=code=>postMessage({type:'error',jobId,code});
  if(command.type==='cancel-foreground'){
   if(active?.jobId===jobId)active.cancelled=true;
   else if(finished?.jobId===jobId)postMessage(finished.failed?{type:'error',jobId,code:'foreground-worker-failed'}:{type:'foreground-cancelled',jobId});
   return;
  }
  if(used||!['foreground','recover-foreground'].includes(command.type)){error('invalid-foreground-input');return;}used=true;
  let input,runtime,response,transfer=[],failed=false;const recover=command.type==='recover-foreground';
  try{input=recover?foregroundPixels(command.input):foregroundInput(command.input);}catch{error('invalid-foreground-input');return;}
  const job={jobId,cancelled:false};active=job;
  const close=async()=>{const previous=runtime;runtime=null;if(previous)await previous.close();};
  try{
   runtime=await createRuntime();if(job.cancelled)return;
   const normalized=recover?{width:input.width,height:input.height,rgb:Float32Array.from(input.rgb,value=>value/255),alpha:Float32Array.from(input.alpha,value=>value/255)}:input;
   const result=foregroundResult(runtime.estimate(normalized),input);await close();
   if(recover){const data=foregroundToRgba(input.rgb,input.alpha,result.foreground).buffer;response={type:'foreground-rgba-ready',jobId,result:{width:input.width,height:input.height,format:'rgba-u8',data}};transfer=[data];}
   else{response={type:'foreground-ready',jobId,result};transfer=[...new Set([result.foreground.buffer,result.background.buffer])];}
   // Allow a cancel queued during synchronous WASM to arrive before publishing.
   await new Promise(resolve=>setTimeout(resolve,0));
  }catch{failed=true;response={type:'error',jobId,code:'foreground-worker-failed'};}
  finally{
   try{await close();}catch{failed=true;response={type:'error',jobId,code:'foreground-worker-failed'};}
   active=null;finished={jobId,failed};
   if(job.cancelled)postMessage(failed?{type:'error',jobId,code:'foreground-worker-failed'}:{type:'foreground-cancelled',jobId});
   else if(response)postMessage(response,transfer);
  }
 };
}
