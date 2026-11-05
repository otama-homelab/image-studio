import {createSingleWorkerTask} from './single-worker-task.mjs';
import {paperTransport,paperResult,PaperWorkerError} from './paper-transport.mjs';
export function createPaperWorkerClient({createWorker,gate}){
 const task=createSingleWorkerTask({createWorker,gate,ErrorClass:PaperWorkerError,prefix:'paper-worker',requestType:'render-paper',responseType:'paper-rendered',errorCodes:['invalid-paper-input','paper-worker-failed'],
  prepare({image,options}){const p=paperTransport(image,options);return {request:{image:p.image,options:p.options},transfer:[p.image.data],context:p.layout};},
  validate(event,layout){return paperResult(event.image,layout);},
 });
 return Object.freeze({render(image,options,hooks){return task.run({image,options},hooks);},close:task.close,getState:task.getState});
}
