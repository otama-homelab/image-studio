/** Test-only EventTarget facade; terminate returns Node's actual termination promise. */
import {Worker} from 'node:worker_threads';
export function nodeExportWorker(workerData={},heapMiB=16,onDiagnostic=()=>{}){
 return nodeTaskWorker(new URL(workerData.browserBundle?'./browser-export-thread.mjs':'./export-protocol-thread.mjs',import.meta.url),workerData,heapMiB,onDiagnostic);
}
export function nodeTaskWorker(entry,workerData={},heapMiB=16,onDiagnostic=()=>{}){
 const thread=new Worker(entry,{workerData,resourceLimits:{maxOldGenerationSizeMb:heapMiB}}),listeners=new Map();let termination;
 thread.on('message',event=>{if(['sandbox-proof','resize-memory-proof'].includes(event?.type))onDiagnostic(event);});
 return {
  addEventListener(type,fn){const wrapped=type==='message'?data=>fn({data}):()=>fn({});listeners.set(fn,wrapped);thread.on(type,wrapped);},
  removeEventListener(type,fn){const wrapped=listeners.get(fn);if(wrapped){thread.off(type,wrapped);listeners.delete(fn);}},
  postMessage(message,transfer){thread.postMessage(message,transfer);},
  terminate(){return termination??=thread.terminate();},
 };
}
