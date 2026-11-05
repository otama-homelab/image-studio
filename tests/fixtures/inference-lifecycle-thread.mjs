/** Protocol/lifecycle fixture only: no model, weights, tensor, GPU or inference. */
import {parentPort,workerData} from 'node:worker_threads';
parentPort.on('message',command=>{
 const base={workerId:command.workerId,jobId:command.jobId};
 if(command.type==='prepare')parentPort.postMessage(workerData?.fail?{...base,type:'error',code:'runtime-error',retryable:true,message:'private test payload'}:{...base,type:'prepared',model:command.model,modelVersion:command.modelVersion});
 else if(command.type==='dispose')parentPort.postMessage({...base,type:'disposed'});
});
