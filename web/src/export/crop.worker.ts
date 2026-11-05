import {cropResizeConfigured,prepareCropResize} from './cropResize';
import {encode} from 'fast-png';
import crc32 from 'crc-32';
import {inspectImage as inspect} from '../imageInput';
import {renderPaperRgb} from '../../../tools/browser-library-adapter/paper-rgb.mjs';
import {createPaperPdfExporter} from '../../../tools/browser-library-adapter/pdf-export.mjs';
import {createPngExporter} from '../../../tools/browser-library-adapter/png-export.mjs';
import {readSourceImage,sourceRgb} from '../sourceImage';
import type {ExportRequest} from './types';
import {jpegPrintDensity,pngPrintDensity,PrintMetadataError} from './printDensity';
const exportPng=createPngExporter({encode,crc32:crc32.buf});
let used=false;
let activeJob:{id:string;cancelled:boolean;controller:AbortController}|null=null,finishedJob:string|null=null;
self.addEventListener('message',async(event:MessageEvent<ExportRequest&{jobId:string;type:string}>)=>{
 const command=event.data;const post=self.postMessage.bind(self) as (value:unknown,transfer?:Transferable[])=>void;
 if(typeof command?.jobId!=='string'||!command.jobId)return;
 if(command.type==='cancel-crop'){
  if(activeJob?.id===command.jobId){activeJob.cancelled=true;activeJob.controller.abort();}
  else if(finishedJob===command.jobId)post({type:'crop-cancelled',jobId:command.jobId});
  return;
 }
 let job:NonNullable<typeof activeJob>|undefined,response:unknown,transfer:Transferable[]=[];
 const error=(code:string)=>{const value={type:'error',jobId:command.jobId,code};if(job)response=value;else post(value);};
 if(!command.output||!['crop','paper'].includes(command.output.kind)||!['png','pdf'].includes(command.output.format)||(command.output.kind==='crop'&&command.output.format!=='png')){error('invalid-crop-input');return;}
 if(used||command.type!=='crop-png'||!(command.file instanceof Blob)||!['crop','original'].includes(command.mode)||(command.mode==='original'&&command.output.kind!=='paper')||(command.mode==='crop'&&![command.width,command.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=4096))){error('invalid-crop-input');return;}used=true;
 job={id:command.jobId,cancelled:false,controller:new AbortController()};activeJob=job;
 const checkCancelled=()=>{if(job!.cancelled)throw new DOMException('aborted','AbortError');};
 const yieldToCancel=async()=>{await new Promise(resolve=>setTimeout(resolve,0));checkCancelled();};
 let source:OffscreenCanvas|undefined,target:OffscreenCanvas|undefined;
 let cropResize:Awaited<ReturnType<typeof prepareCropResize>>=null;
 try{
  const header=await inspect(command.file,{signal:job.controller.signal});checkCancelled();
  // Check APIs in the Worker realm before pixel decode or Canvas allocation.
  const canvasAvailable=typeof OffscreenCanvas==='function';
  if((command.mode==='crop'&&!cropResizeConfigured()&&(!canvasAvailable||typeof ImageData!=='function'))||(header.type==='jpeg'&&(!canvasAvailable||typeof createImageBitmap!=='function'))){error('unsupported-browser');return;}
  // Load the optional PDF dependency before decoding pixels or allocating a sheet.
  let pdfExporter:ReturnType<typeof createPaperPdfExporter>|undefined;
  if(command.output.format==='pdf'){
   try{const {PDFDocument}=await import('pdf-lib');pdfExporter=createPaperPdfExporter({PDFDocument,exportPng});}
   catch{error('pdf-module-unavailable');return;}
  }
  if(command.mode==='crop')cropResize=await prepareCropResize(job.controller.signal);checkCancelled();
  let dpi:[number,number]|null=command.mode==='original'&&header.type==='jpeg'?await jpegPrintDensity(new Uint8Array(await command.file.arrayBuffer())):[300,300];
  const {image,resolution:pngResolution}=await readSourceImage(command.file,header,job.controller.signal);checkCancelled();
  if(image.width!==command.sourceWidth||image.height!==command.sourceHeight)throw Error();
  let photo;
  if(command.mode==='original'){
   if(header.type==='png')dpi=pngPrintDensity(pngResolution);
   photo=sourceRgb(image);
  }else{
   const {x,y,width,height}=command.crop;
   if(![x,y,width,height].every(Number.isFinite)||x<0||y<0||width<=0||height<=0||x+width>image.width+1e-6||y+height>image.height+1e-6)throw Error();
   if(cropResize){photo=cropResize.resize(sourceRgb(image),command.width,command.height,[x,y,x+width,y+height]);}else{
   const channels=image.format==='rgba-u8'?4:3,input=new Uint8Array(image.data),opaque=new Uint8ClampedArray(image.width*image.height*4);
   // Layout conversion only: preserve hidden RGB and discard input alpha like Pillow convert RGB.
   for(let i=0,j=0;i<input.length;i+=channels,j+=4){opaque[j]=input[i];opaque[j+1]=input[i+1];opaque[j+2]=input[i+2];opaque[j+3]=255;}
   source=new OffscreenCanvas(image.width,image.height);target=new OffscreenCanvas(command.width,command.height);
   const from=source.getContext('2d'),to=target.getContext('2d',{willReadFrequently:true});if(!from||!to)throw Error();
   from.putImageData(new ImageData(opaque,image.width,image.height),0,0);to.imageSmoothingEnabled=true;to.imageSmoothingQuality='high';to.drawImage(source,x,y,width,height,0,0,command.width,command.height);
   const rgba=to.getImageData(0,0,command.width,command.height).data,rgb=new Uint8Array(command.width*command.height*3);
   for(let i=0,j=0;i<rgba.length;i+=4,j+=3){rgb[j]=rgba[i];rgb[j+1]=rgba[i+1];rgb[j+2]=rgba[i+2];}
   photo={width:command.width,height:command.height,format:'rgb-u8',data:rgb.buffer};
   }
  }
  await yieldToCancel();
  let file;
  if(command.output.kind==='paper'){
   const {image:paper}=renderPaperRgb(photo,{paper:command.output.paper,dpi});
   if(command.output.format==='pdf'){if(!pdfExporter)throw Error();file=await pdfExporter(paper,{kind:'paper',paper:command.output.paper});}
   else file=exportPng(paper,{kind:'paper',paper:command.output.paper});
  }else file=exportPng(photo,{kind:'crop',paper:undefined});
  if(source){source.width=0;source.height=0;}if(target){target.width=0;target.height=0;}source=undefined;target=undefined;
  await yieldToCancel();
  response={type:'crop-png-ready',jobId:command.jobId,file};transfer=[file.bytes.buffer];
 }catch(failure){const code=(failure as {code?:string})?.code;error(code==='crop-resize-unavailable'?code:failure instanceof PrintMetadataError?failure.code:code==='png-pixels-unsupported'?'unsupported-png-format':code==='png-dimensions-too-large'||code==='photo-does-not-fit'?code:'crop-encode-failed');}
 finally{cropResize?.close();if(source){source.width=0;source.height=0;}if(target){target.width=0;target.height=0;}finishedJob=command.jobId;activeJob=null;if(job.cancelled)post({type:'crop-cancelled',jobId:command.jobId});else if(response){if(transfer.length)post(response,transfer);else post(response);}}
});
