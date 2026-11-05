import {createCooperativeWorkerStop} from './cooperative-worker-stop.mjs';
import {createSingleWorkerTask} from './single-worker-task.mjs';
import {createOpenCvTrimap} from './opencv-trimap.mjs';
class TrimapWorkerError extends Error{constructor(code){super(code);this.code=code;}}
const plane=(image,layout)=>{
 if(image?.layout!==layout||![image.width,image.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=2000)
  ||!(image.data instanceof ArrayBuffer)||image.data.byteLength!==image.width*image.height)throw new TrimapWorkerError('invalid-trimap-input');
 return {width:image.width,height:image.height,layout,data:image.data};
};
export function createTrimapWorkerClient({createWorker,gate,cancellationProtocol}){
 if(cancellationProtocol!==undefined&&cancellationProtocol!=='cooperative-trimap-cancel-v1')throw Error('invalid-trimap-cancellation-protocol');
 const stopWorker=cancellationProtocol?createCooperativeWorkerStop({requestType:'cancel-trimap',responseType:'trimap-cancelled',timeoutMs:120000}):undefined;
 const task=createSingleWorkerTask({createWorker,gate,...(stopWorker?{stopWorker}:{}),ErrorClass:TrimapWorkerError,prefix:'trimap-worker',
  requestType:'make-trimap',responseType:'trimap-ready',errorCodes:['invalid-trimap-input','trimap-worker-failed'],
  prepare(alpha){
   const checked=plane(alpha,'alpha-u8'),input={...checked,data:checked.data.slice(0)};
   // HR alpha is still required for refinement input/skip decisions. Transfer a job-owned copy.
   return {request:{alpha:input},transfer:[input.data],context:{width:input.width,height:input.height}};
  },validate(event,expected){
   const image=plane(event.trimap,'trimap-u8');
   if(image.width!==expected.width||image.height!==expected.height||new Uint8Array(image.data).some(value=>value!==0&&value!==128&&value!==255))throw new TrimapWorkerError('invalid-trimap-output');
   return image;
  }});
 return Object.freeze({make:task.run,close:task.close,getState:task.getState});
}
export function createTrimapWorkerHandler({createCv,postMessage}){
 let used=false,active=null,finished=null;
 return async command=>{
  if(typeof command?.jobId!=='string'||!command.jobId)return;
  const jobId=command.jobId,error=code=>postMessage({type:'error',jobId,code});
  if(command.type==='cancel-trimap'){
   if(active?.jobId===jobId)active.cancelled=true;
   else if(finished?.jobId===jobId)postMessage(finished.failed?{type:'error',jobId,code:'trimap-worker-failed'}:{type:'trimap-cancelled',jobId});
   return;
  }
  if(used||command.type!=='make-trimap'){error('invalid-trimap-input');return;}used=true;
  let alpha;try{alpha=plane(command.alpha,'alpha-u8');}catch{error('invalid-trimap-input');return;}
  const job={jobId,cancelled:false};active=job;let response,transfer=[],failed=false;
  try{
   const cv=await createCv();if(job.cancelled)return;
   // Existing OpenCV adapter disposes every owned Mat before returning.
   const trimap=createOpenCvTrimap(cv)(alpha);
   response={type:'trimap-ready',jobId,trimap};transfer=[trimap.data];
   await new Promise(resolve=>setTimeout(resolve,0));
  }catch{failed=true;response={type:'error',jobId,code:'trimap-worker-failed'};}
  finally{
   active=null;finished={jobId,failed};
   if(job.cancelled)postMessage(failed?{type:'error',jobId,code:'trimap-worker-failed'}:{type:'trimap-cancelled',jobId});
   else if(response)postMessage(response,transfer);
  }
 };
}
