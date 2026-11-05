import {paperTransport,paperResult} from './paper-transport.mjs';
import {renderPaperRgb} from './paper-rgb.mjs';
export function createPaperWorkerHandler({postMessage}){
 let used=false;
 return command=>{
  if(!command||typeof command.jobId!=='string'||!command.jobId)return;
  const error=code=>postMessage({type:'error',jobId:command.jobId,code});
  if(used||command.type!=='render-paper'){error('invalid-paper-input');return;}used=true;
  let p;try{p=paperTransport(command.image,command.options);}catch{error('invalid-paper-input');return;}
  try{const result=paperResult(renderPaperRgb(p.image,p.options).image,p.layout);postMessage({type:'paper-rendered',jobId:command.jobId,image:result.image},[result.image.data]);}
  catch{error('paper-worker-failed');}
 };
}
