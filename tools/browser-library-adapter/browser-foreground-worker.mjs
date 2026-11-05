/** Diagnostic browser entry; build pins embedded artifact SHA and memory budget. */
import wasmBytes from 'foreground-artifact';
import {createForegroundRuntime} from './foreground-runtime.mjs';
import {createForegroundWorkerHandler} from './foreground-worker-handler.mjs';
const handle=createForegroundWorkerHandler({createRuntime:()=>createForegroundRuntime(wasmBytes,{maxMemoryBytes:__FOREGROUND_MEMORY_BUDGET__}),postMessage:(event,transfer)=>self.postMessage(event,transfer)});
self.addEventListener('message',event=>{void handle(event.data);});
