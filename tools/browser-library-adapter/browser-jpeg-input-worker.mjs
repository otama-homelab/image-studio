/** Native JPEG entry, diagnostic policy only. Native decode fidelity is unaccepted. */
import {imageDimensionsFromData} from 'image-dimensions';
import {createImagePreflight} from './image-preflight.mjs';
import {createJpegBitmapInput} from './jpeg-bitmap-input.mjs';
import {createJpegInputWorkerHandler} from './jpeg-input-worker.mjs';
const inspect=createImagePreflight({probe:imageDimensionsFromData,maxAxis:4096,maxPixels:4_000_000});
const read=createJpegBitmapInput({inspect,createBitmap:(file,options)=>self.createImageBitmap(file,options),createCanvas:(width,height)=>new OffscreenCanvas(width,height)});
const handle=createJpegInputWorkerHandler({read,postMessage:(event,transfer)=>self.postMessage(event,transfer)});
self.addEventListener('message',event=>{void handle(event.data);});
