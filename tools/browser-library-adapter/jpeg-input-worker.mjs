import {createSingleWorkerTask} from './single-worker-task.mjs';
export class JpegInputWorkerError extends Error{
 constructor(code){super(code);this.name='JpegInputWorkerError';this.code=code;}
}
const validFile=file=>file instanceof Blob&&file.size>0&&file.size<=20*1024*1024;
const result=(image,header)=>{
 const channels=image?.format==='rgb-u8'?3:0;
 const same=image?.width===header.width&&image?.height===header.height,swapped=image?.width===header.height&&image?.height===header.width;
 if(!channels||!(same||swapped)||!(image.data instanceof ArrayBuffer)||image.data.byteLength!==header.width*header.height*channels)throw new JpegInputWorkerError('invalid-jpeg-input');
 return {width:image.width,height:image.height,format:image.format,data:image.data};
};
/** inspect is metadata-only; decoding and file byte reads remain in the owned Worker. */
export function createJpegInputWorkerClient({inspect,createWorker,gate}){
 const task=createSingleWorkerTask({createWorker,gate,ErrorClass:JpegInputWorkerError,prefix:'jpeg-input-worker',requestType:'decode-jpeg',responseType:'jpeg-decoded',errorCodes:['invalid-jpeg-input','jpeg-input-worker-failed'],
  prepare({file,header}){
   if(!validFile(file)||header?.type!=='jpeg'||![header.width,header.height].every(n=>Number.isSafeInteger(n)&&n>0)||!Number.isSafeInteger(header.width*header.height*4))throw new JpegInputWorkerError('invalid-jpeg-input');
   return {request:{file:new Blob([file],{type:'image/jpeg'})},transfer:[],context:header};
  },validate:(event,header)=>result(event.image,header),
 });
 return Object.freeze({
  async read(file,{signal}={}){
   if(!validFile(file))throw new JpegInputWorkerError('invalid-jpeg-input');
   if(signal?.aborted)throw new JpegInputWorkerError('aborted');
   let header;try{header=await inspect(file,{signal});}catch{throw new JpegInputWorkerError(signal?.aborted?'aborted':'invalid-jpeg-input');}
   return task.run({file,header},{signal});
  },close:task.close,getState:task.getState,
 });
}
/** read is the independently guarded createJpegBitmapInput instance, configured inside the Worker. */
export function createJpegInputWorkerHandler({read,postMessage}){
 let used=false;
 return async command=>{
  if(typeof command?.jobId!=='string'||!command.jobId)return;
  const error=code=>postMessage({type:'error',jobId:command.jobId,code});
  if(used||command.type!=='decode-jpeg'||!validFile(command.file)){error('invalid-jpeg-input');return;}used=true;
  try{const image=await read(command.file);postMessage({type:'jpeg-decoded',jobId:command.jobId,image},[image.data]);}
  catch{error('jpeg-input-worker-failed');}
 };
}
