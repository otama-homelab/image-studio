import {exportTransport,exportResult} from './export-transport.mjs';
import {createSingleWorkerTask} from './single-worker-task.mjs';
export class ExportWorkerError extends Error {
 constructor(code){super(code);this.name='ExportWorkerError';this.code=code;}
}
export function createExportWorkerClient({createWorker,gate}){
 const task=createSingleWorkerTask({createWorker,gate,ErrorClass:ExportWorkerError,prefix:'export-worker',requestType:'encode',responseType:'encoded',errorCodes:['invalid-export-input','export-worker-failed'],
  prepare({image,options}){const payload=exportTransport(image,options);return {request:{image:payload.image,options:payload.options},transfer:payload.transfer,context:payload};},
  validate(event,payload){return exportResult(event.file,payload.image,payload.options);},
 });
 return Object.freeze({encode(image,options,hooks){return task.run({image,options},hooks);},close:task.close,getState:task.getState});
}
