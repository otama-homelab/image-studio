import {createPaperWorkerHandler} from './paper-worker-handler.mjs';
const handle=createPaperWorkerHandler({postMessage:(event,transfer)=>self.postMessage(event,transfer)});
self.addEventListener('message',event=>handle(event.data));
