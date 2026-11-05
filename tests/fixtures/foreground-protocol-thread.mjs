/** Node-only off-thread fixture, not the browser entry or app. */
import {parentPort,workerData} from 'node:worker_threads';
import fs from 'node:fs';
import {createForegroundRuntime} from '../../tools/browser-library-adapter/foreground-runtime.mjs';
import {createForegroundWorkerHandler} from '../../tools/browser-library-adapter/foreground-worker-handler.mjs';
const trace=workerData.trace?new BigInt64Array(workerData.trace):null;
const mark=index=>{if(trace)Atomics.store(trace,index,process.hrtime.bigint());};
const handle=createForegroundWorkerHandler({createRuntime:async()=>{
 const runtime=await createForegroundRuntime(fs.readFileSync(workerData.wasm),{maxMemoryBytes:workerData.maxMemoryBytes});
 if(!trace)return runtime;
 return {estimate(input){mark(0);try{return runtime.estimate(input);}finally{mark(1);}},close(){try{return runtime.close();}finally{mark(2);}}};
},postMessage:(event,transfer)=>parentPort.postMessage(event,transfer)});
parentPort.on('message',command=>{void handle(command);});
