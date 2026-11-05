import {createSingleWorkerTask} from './single-worker-task.mjs';
export class PngInputWorkerError extends Error{
 constructor(code){super(code);this.name='PngInputWorkerError';this.code=code;}
}
const validFile=file=>file instanceof Blob&&file.size>0&&file.size<=20*1024*1024;
const result=(image,header)=>{
 const channels={'rgb-u8':3,'rgba-u8':4}[image?.format];
 if(!channels||image.width!==header.width||image.height!==header.height||!(image.data instanceof ArrayBuffer)||image.data.byteLength!==header.width*header.height*channels)throw new PngInputWorkerError('invalid-png-input');
 return {width:image.width,height:image.height,format:image.format,data:image.data};
};
/** inspect is metadata-only; decoding and file byte reads remain in the owned Worker. */
export function createPngInputWorkerClient({inspect,createWorker,gate}){
 const task=createSingleWorkerTask({createWorker,gate,ErrorClass:PngInputWorkerError,prefix:'png-input-worker',requestType:'decode-png',responseType:'png-decoded',errorCodes:['invalid-png-input','png-input-worker-failed'],
  prepare({file,header}){
   if(!validFile(file)||header?.type!=='png'||![header.width,header.height].every(n=>Number.isSafeInteger(n)&&n>0)||!Number.isSafeInteger(header.width*header.height*4))throw new PngInputWorkerError('invalid-png-input');
   return {request:{file:new Blob([file],{type:'image/png'})},transfer:[],context:header};
  },validate:(event,header)=>result(event.image,header),
 });
 return Object.freeze({
  async read(file,{signal}={}){
   if(!validFile(file))throw new PngInputWorkerError('invalid-png-input');
   if(signal?.aborted)throw new PngInputWorkerError('aborted');
   let header;try{header=await inspect(file,{signal});}catch{throw new PngInputWorkerError(signal?.aborted?'aborted':'invalid-png-input');}
   return task.run({file,header},{signal});
  },close:task.close,getState:task.getState,
 });
}
/** read is the independently guarded createPngInput instance, configured inside the Worker. */
export function createPngInputWorkerHandler({read,postMessage}){
 let used=false;
 return async command=>{
  if(typeof command?.jobId!=='string'||!command.jobId)return;
  const error=code=>postMessage({type:'error',jobId:command.jobId,code});
  if(used||command.type!=='decode-png'||!validFile(command.file)){error('invalid-png-input');return;}used=true;
  try{const image=await read(command.file);postMessage({type:'png-decoded',jobId:command.jobId,image},[image.data]);}
  catch{error('png-input-worker-failed');}
 };
}
