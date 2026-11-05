/** Node-only real WASM fixture. No browser bootstrap/model/image decoder. */
import {parentPort,workerData} from 'node:worker_threads';
import fs from 'node:fs';
import {createResizeWorkerHandler} from '../../tools/browser-library-adapter/resize-worker-handler.mjs';
import {createPillowResizeRuntime} from '../../tools/browser-library-adapter/pillow-resize-runtime.mjs';
import {createPillowResizeMemory} from '../../tools/browser-library-adapter/pillow-resize-memory.mjs';
const handle=createResizeWorkerHandler({
 async createResizer(){
  if(workerData.bounded){
   // Test-only import fault injection, isolated to this Node Worker.
   const originalSin=Math.sin;let runtime;
   try{if(workerData.trap)Math.sin=()=>{throw Error('private trap');};runtime=await createPillowResizeRuntime(fs.readFileSync(workerData.wasm),{maxMemoryBytes:workerData.maxMemoryBytes});}
   finally{Math.sin=originalSin;}
   if(!workerData.probeMemory)return runtime;
   return {resize:runtime.resize,close(){const state=runtime.getState();runtime.close();parentPort.postMessage({type:'resize-memory-proof',state});}};
  }
  const module=await WebAssembly.compile(fs.readFileSync(workerData.wasm));
  const instance=await WebAssembly.instantiate(module,{env:{sin:workerData.trap?()=>{throw Error('private trap');}:Math.sin,cos:Math.cos,__assert_fail(){throw Error('private assert');}}});
  return createPillowResizeMemory(instance.exports);
 },
 postMessage:(message,transfer)=>parentPort.postMessage(message,transfer),
});
parentPort.on('message',command=>{void handle(command);});
