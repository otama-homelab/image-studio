import {createCooperativeWorkerStop} from './cooperative-worker-stop.mjs';
import {foregroundPixels,foregroundRgbaResult} from './foreground-pixels.mjs';
import {createSingleWorkerTask} from './single-worker-task.mjs';
import {foregroundInput} from './foreground-memory.mjs';
import {foregroundResult} from './foreground-worker-handler.mjs';
class ForegroundWorkerError extends Error{constructor(code){super(code);this.name='ForegroundWorkerError';this.code=code;}}
export function createForegroundWorkerClient({createWorker,gate,rgba=false,cancellationProtocol}){
 if(cancellationProtocol!==undefined&&cancellationProtocol!=='cooperative-foreground-cancel-v1')throw Error('invalid-foreground-cancellation-protocol');
 const stopWorker=cancellationProtocol?createCooperativeWorkerStop({requestType:'cancel-foreground',responseType:'foreground-cancelled',timeoutMs:120000}):undefined;
 const task=createSingleWorkerTask({createWorker,gate,...(stopWorker?{stopWorker}:{}),ErrorClass:ForegroundWorkerError,prefix:'foreground-worker',requestType:rgba?'recover-foreground':'foreground',responseType:rgba?'foreground-rgba-ready':'foreground-ready',errorCodes:['invalid-foreground-input','foreground-worker-failed'],
  prepare(input){let checked;try{checked=rgba?foregroundPixels(input):foregroundInput(input);}catch{throw new ForegroundWorkerError('invalid-foreground-input');}return {request:{input:checked},transfer:[...new Set([checked.rgb.buffer,checked.alpha.buffer])],context:{width:checked.width,height:checked.height}};},
  validate(event,expected){return rgba?foregroundRgbaResult(event.result,expected):foregroundResult(event.result,expected);},
 });
 return Object.freeze({estimate:task.run,close:task.close,getState:task.getState});
}
