import {compositeOpaqueBackground} from './composite-rgb.mjs';
import {exportTransport,exportResult} from './export-transport.mjs';
export function createExportWorkerHandler({encodePng,encodePdf,postMessage}){
 let busy=false;
 return async function handle(command){
  if(!command||typeof command.jobId!=='string'||!command.jobId)return;
  const error=code=>postMessage({type:'error',jobId:command.jobId,code});
  if(busy||command.type!=='encode'){error('invalid-export-input');return;}
  busy=true;
  try{
   let payload;try{payload=exportTransport(command.image,command.options);}catch{error('invalid-export-input');return;}
   if(payload.options.backgroundColor){const data=compositeOpaqueBackground(new Uint8Array(payload.image.data),payload.options.backgroundColor).buffer;payload.image={...payload.image,format:'rgb-u8',data};}
   const encoder=payload.options.format==='pdf'?encodePdf:encodePng;
   const encoded=await encoder(payload.image,payload.options),file=exportResult(encoded,payload.image,payload.options);
   postMessage({type:'encoded',jobId:command.jobId,file},[file.bytes.buffer]);
  }catch{error('export-worker-failed');}
  finally{busy=false;}
 };
}
