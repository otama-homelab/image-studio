import {createCooperativeWorkerStop} from '../../../tools/browser-library-adapter/cooperative-worker-stop.mjs';
/** Keep the shared gate until synchronous work has unwound and cleanup is acknowledged. */
export const stopCropWorker=createCooperativeWorkerStop({requestType:'cancel-crop',responseType:'crop-cancelled',timeoutMs:10000});
