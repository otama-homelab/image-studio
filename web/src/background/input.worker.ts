import {inspectImage} from '../imageInput';
import {readSourceImage,sourceRgb} from '../sourceImage';
let used=false;
self.addEventListener('message',async(event:MessageEvent)=>{
 const command=event.data;
 if(typeof command?.jobId!=='string'||!command.jobId)return;
 const post=self.postMessage.bind(self) as (value:unknown,transfer?:Transferable[])=>void;
 const error=(code:string)=>post({type:'error',jobId:command.jobId,code});
 if(used||command.type!=='decode-background-photo'||!(command.file instanceof Blob)){error('invalid-background-photo');return;}used=true;
 try{
  const header=await inspectImage(command.file);
  if(header.type==='jpeg'&&(typeof OffscreenCanvas!=='function'||typeof createImageBitmap!=='function')){error('unsupported-browser');return;}
  const {image}=await readSourceImage(command.file,header);
  const rgb=sourceRgb(image);
  post({type:'background-photo-decoded',jobId:command.jobId,image:rgb},[rgb.data]);
 }catch(failure){const code=(failure as {code?:string})?.code;error(code==='png-pixels-unsupported'?'unsupported-png-format':['png-dimensions-too-large','image-file-too-large','image-dimensions-too-large'].includes(code??'')?code!:'background-photo-decode-failed');}
});
