import {parentPort,workerData} from 'node:worker_threads';
import {createPngInputWorkerHandler} from '../../tools/browser-library-adapter/png-input-worker.mjs';
import {createPngInput} from '../../tools/browser-library-adapter/png-input.mjs';
import {createImagePreflight} from '../../tools/browser-library-adapter/image-preflight.mjs';
const {imageDimensionsFromData}=await import(workerData.probeModule);
const {decode}=await import(workerData.codecModule);
const inspect=createImagePreflight({probe:imageDimensionsFromData,maxAxis:4096,maxPixels:4_000_000});
const handler=createPngInputWorkerHandler({read:createPngInput({inspect,decode}),postMessage:(event,transfer)=>parentPort.postMessage(event,transfer)});
parentPort.on('message',handler);
