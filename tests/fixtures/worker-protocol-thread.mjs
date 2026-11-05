/** Transport fixture only: synthetic bytes, no model, GPU, image algorithm or network. */
import {parentPort,workerData} from 'node:worker_threads';
import {createWorkerHandler} from '../../tools/browser-library-adapter/worker-handler.mjs';
const handle=createWorkerHandler({trustedModels:[workerData.release],
 prepare:async()=>({async dispose(){}}),
 infer:async(_,request)=>{
  if(workerData.crash){
   setImmediate(()=>{throw Error('private worker exception payload');});
   return new Promise(()=>{});
  }
  const rgb=new Uint8Array(request.rgb.data),alpha=new Uint8Array(request.rgb.width*request.rgb.height);
  for(let i=0;i<alpha.length;i++)alpha[i]=rgb[3*i];
  return {width:request.rgb.width,height:request.rgb.height,layout:'alpha-u8',data:alpha.buffer};
 },postMessage:(event,transfer=[])=>parentPort.postMessage(event,transfer)});
parentPort.on('message',command=>{void handle(command);});
