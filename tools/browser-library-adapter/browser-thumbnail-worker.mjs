import wasmBytes from 'pillow-artifact';
import {createPillowResizeRuntime} from './pillow-resize-runtime.mjs';
import {createResizeWorkerHandler} from './resize-worker-handler.mjs';
const handle=createResizeWorkerHandler({
 createResizer:options=>{
  if(options.thumbnail!==true)throw Error('thumbnail-request-required');
  return createPillowResizeRuntime(wasmBytes,{maxMemoryBytes:__PILLOW_MEMORY_BUDGET__,filter:'thumbnail',growthImport:'foreground_memory_grow'});
 },postMessage:(event,transfer)=>self.postMessage(event,transfer),
});
self.addEventListener('message',event=>{void handle(event.data);});
