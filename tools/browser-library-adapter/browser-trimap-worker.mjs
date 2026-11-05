import {createTrimapWorkerHandler} from './trimap-worker.mjs';
const handle=createTrimapWorkerHandler({
 // Use the unchanged browser distribution in a classic Worker. No Node builtin shims.
 createCv:()=>{self.importScripts(__OPENCV_SCRIPT_PATH__);return self.cv;},
 postMessage:(event,transfer)=>self.postMessage(event,transfer),
});
self.addEventListener('message',event=>{void handle(event.data);});
