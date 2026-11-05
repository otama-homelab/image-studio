/** Diagnostic browser entry. Production input policy and color handling remain unaccepted. */
import PngDecoder from 'fast-png-decoder';
import {readKeyword} from 'fast-png-keyword';
import {unzlibSync} from 'fflate';
import adler32 from 'pako-adler32';
import {createBoundedPngDecode} from './bounded-png-decode.mjs';
import {imageDimensionsFromData} from 'image-dimensions';
import {createImagePreflight} from './image-preflight.mjs';
import {createPngInput} from './png-input.mjs';
import {createPngInputWorkerHandler} from './png-input-worker.mjs';
const inspect=createImagePreflight({probe:imageDimensionsFromData,maxAxis:4096,maxPixels:4_000_000});
const decode=createBoundedPngDecode({PngDecoder,readKeyword,unzlibSync,adler32});
const read=createPngInput({inspect,decode});
const handle=createPngInputWorkerHandler({read,postMessage:(event,transfer)=>self.postMessage(event,transfer)});
self.addEventListener('message',event=>{void handle(event.data);});
