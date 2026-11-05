/** Browser entry candidate: build embeds a verified artifact and fixed diagnostic memory budget. */
import wasmBytes from 'pillow-artifact';
import {createPillowResizeRuntime} from './pillow-resize-runtime.mjs';
import {createResizeWorkerHandler} from './resize-worker-handler.mjs';
const handle=createResizeWorkerHandler({
 createResizer:()=>createPillowResizeRuntime(wasmBytes,{maxMemoryBytes:__PILLOW_MEMORY_BUDGET__}),
 postMessage:(event,transfer)=>self.postMessage(event,transfer),
});
self.addEventListener('message',event=>{void handle(event.data);});
