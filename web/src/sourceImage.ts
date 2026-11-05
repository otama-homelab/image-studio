import {convertIndexedToRgb} from 'fast-png';
import PngDecoder from 'fast-png-decoder';
import {readKeyword} from 'fast-png-keyword';
import {unzlibSync} from 'fflate';
import adler32 from 'pako-adler32';
import {inspectImage} from './imageInput';
import {createBoundedPngDecode} from '../../tools/browser-library-adapter/bounded-png-decode.mjs';
import {createPngInput} from '../../tools/browser-library-adapter/png-input.mjs';
import {createJpegBitmapInput} from '../../tools/browser-library-adapter/jpeg-bitmap-input.mjs';

export type SourcePixels={width:number;height:number;format:'rgb-u8'|'rgba-u8';data:ArrayBuffer};
const decodePng=createBoundedPngDecode({PngDecoder,readKeyword,unzlibSync,adler32});
const readJpeg=createJpegBitmapInput({inspect:inspectImage,
 createBitmap:(file:Blob,options:ImageBitmapOptions)=>createImageBitmap(file,options),
 createCanvas:(width:number,height:number)=>new OffscreenCanvas(width,height)});

/** Shared Worker-local input path for print/crop and background editing. No Canvas PNG decode. */
export async function readSourceImage(file:Blob,header:Awaited<ReturnType<typeof inspectImage>>,signal?:AbortSignal){
 let resolution:{x:number;y:number;unit:number}|undefined;
 const readPng=createPngInput({inspect:inspectImage,expandIndexed:convertIndexedToRgb,
  decode:(bytes:Uint8Array,options:object)=>{const image=decodePng(bytes,options);resolution=image.resolution;return image;}});
 const image=(header.type==='png'?await readPng(file,{signal}):await readJpeg(file,{signal})) as SourcePixels;
 return {image,resolution};
}

/** Layout conversion only, matching Pillow convert('RGB') even for hidden transparent RGB. */
export function sourceRgb(image:SourcePixels){
 const channels=image.format==='rgba-u8'?4:image.format==='rgb-u8'?3:0;
 if(!channels||![image.width,image.height].every(n=>Number.isSafeInteger(n)&&n>0)
  ||!(image.data instanceof ArrayBuffer)||image.data.byteLength!==image.width*image.height*channels)throw Error('invalid-source-pixels');
 if(channels===3)return {...image,format:'rgb-u8' as const};
 const input=new Uint8Array(image.data),rgb=new Uint8Array(image.width*image.height*3);
 for(let i=0,j=0;i<input.length;i+=4,j+=3){rgb[j]=input[i];rgb[j+1]=input[i+1];rgb[j+2]=input[i+2];}
 return {width:image.width,height:image.height,format:'rgb-u8' as const,data:rgb.buffer};
}
