import {createSingleWorkerTask} from './single-worker-task.mjs';
import {resizeTransport,resizeResult,ResizeWorkerError} from './resize-transport.mjs';
export function createResizeWorkerClient({createWorker,gate}){
 const task=createSingleWorkerTask({createWorker,gate,ErrorClass:ResizeWorkerError,prefix:'resize-worker',requestType:'resize',responseType:'resized',errorCodes:['invalid-resize-input','resize-worker-failed'],
  prepare({image,options}){const payload=resizeTransport(image,options);return {request:payload,transfer:[payload.image.data],context:payload.options};},
  validate(event,options){return resizeResult(event.image,options);},
 });
 return Object.freeze({resize(image,options,hooks){return task.run({image,options},hooks);},close:task.close,getState:task.getState});
}
