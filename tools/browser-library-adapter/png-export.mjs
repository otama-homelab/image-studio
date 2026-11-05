const signature=Uint8Array.of(137,80,78,71,13,10,26,10);
import {PAPER_PIXELS as papers} from './paper-contract.mjs';
export class PngExportError extends Error {
 constructor(code){super(code);this.name='PngExportError';this.code=code;}
}
const invalid=()=>{throw new PngExportError('png-output-invalid');};
function frames(bytes,crc32,width,height,channels){
 if(!(bytes instanceof Uint8Array)||signature.some((b,i)=>bytes[i]!==b))invalid();
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),result=[];let at=8,idat=false,ended=false;
 while(at<bytes.length){
  if(bytes.length-at<12)invalid();const length=view.getUint32(at),end=at+length+12;
  if(end>bytes.length)invalid();
  const type=String.fromCharCode(...bytes.subarray(at+4,at+8));
  if(!['IHDR','IDAT','IEND','pHYs'].includes(type))invalid();
  if((crc32(bytes.subarray(at+4,end-4))>>>0)!==view.getUint32(end-4))invalid();
  if(result.length===0&&type!=='IHDR')invalid();
  if(type==='IHDR'){
   if(result.length||length!==13||view.getUint32(at+8)!==width||view.getUint32(at+12)!==height
    ||bytes[at+16]!==8||bytes[at+17]!== (channels===3?2:6)||bytes[at+18]!==0||bytes[at+19]!==0||bytes[at+20]!==0)invalid();
  }else if(type==='IDAT'){idat=true;}
  else if(type==='pHYs'){if(idat||length!==9||bytes[at+16]>1)invalid();}
  else if(type==='IEND'){if(!idat||length!==0||end!==bytes.length)invalid();ended=true;}
  result.push({type,start:at,end});at=end;
 }
 if(!ended)invalid();return result;
}
function densityChunk(crc32){
 const data=new Uint8Array(21),view=new DataView(data.buffer);
 view.setUint32(0,9);data.set([112,72,89,115],4);view.setUint32(8,11811);view.setUint32(12,11811);data[16]=1;
 view.setUint32(17,crc32(data.subarray(4,17))>>>0);return data;
}

/** Existing encoder handles pixels; only the fixed output metadata/container policy lives here. */
export function createPngExporter({encode,crc32}){
 return function exportPng(image,{kind,paper}={}){
  const channels=image?.format==='rgb-u8'?3:image?.format==='rgba-u8'?4:0;
  if(!['background','transparent','crop','paper'].includes(kind)||(kind==='paper'&&(!Object.hasOwn(papers,paper)||image?.width!==papers[paper][0]||image?.height!==papers[paper][1]))
   ||!channels||(kind==='transparent'?channels!==4:channels!==3)||!Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)
   ||image.width<1||image.height<1||!Number.isSafeInteger(image.width*image.height*channels)
   ||!(image.data instanceof ArrayBuffer)||image.data.byteLength!==image.width*image.height*channels)throw new PngExportError('invalid-export-input');
  let encoded;try{encoded=encode({width:image.width,height:image.height,channels,depth:8,data:new Uint8Array(image.data)});}catch{throw new PngExportError('png-encode-failed');}
  try{
   const chunks=frames(encoded,crc32,image.width,image.height,channels),dpi=kind==='crop'||kind==='paper',density=dpi?densityChunk(crc32):null;
   const size=8+chunks.filter(c=>c.type!=='pHYs').reduce((sum,c)=>sum+c.end-c.start,0)+(density?.length??0);
   const bytes=new Uint8Array(size);bytes.set(signature);let at=8;
   for(const chunk of chunks){
    if(chunk.type==='pHYs')continue;bytes.set(encoded.subarray(chunk.start,chunk.end),at);at+=chunk.end-chunk.start;
    if(chunk.type==='IHDR'&&density){bytes.set(density,at);at+=density.length;}
   }
   const filename=kind==='paper'?`image-studio-paper-${paper}-300dpi.png`:kind==='crop'?'image-studio-crop-300dpi.png':`image-studio-${kind}.png`;
   return {bytes,mime:'image/png',filename,width:image.width,height:image.height};
  }catch{throw new PngExportError('png-output-invalid');}
 };
}
