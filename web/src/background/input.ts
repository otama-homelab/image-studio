import {inspectImage} from '../imageInput';
import {imageWorkGate} from '../imageWorkGate';
import {createSingleWorkerTask} from '../../../tools/browser-library-adapter/single-worker-task.mjs';
type Rgb={width:number;height:number;format:'rgb-u8';data:ArrayBuffer};
class BackgroundInputError extends Error{code:string;constructor(code:string){super(code);this.code=code;}}
/** Decoder Workers finish before resize admission. The release supplies the Pillow thumbnail step. */
export function createBackgroundInput({resizeOriginal}:{resizeOriginal:(image:Rgb,signal:AbortSignal)=>Promise<Rgb>}){
 const task=createSingleWorkerTask({gate:imageWorkGate,createWorker:()=>new Worker(new URL('./input.worker.ts',import.meta.url),{type:'module'}),
  ErrorClass:BackgroundInputError,prefix:'background-input',requestType:'decode-background-photo',responseType:'background-photo-decoded',
  errorCodes:['invalid-background-photo','background-photo-decode-failed','unsupported-browser','unsupported-png-format','png-dimensions-too-large','image-file-too-large','image-dimensions-too-large'],
  prepare({file,header}:{file:File;header:{type:string;width:number;height:number}}){return {request:{file:new Blob([file],{type:header.type==='png'?'image/png':'image/jpeg'})},transfer:[],context:header};},
  validate(event:{image:Rgb},header:{type:string;width:number;height:number}){
   const image=event.image,same=image?.width===header.width&&image?.height===header.height;
   const rotated=header.type==='jpeg'&&image?.width===header.height&&image?.height===header.width;
   if(!(same||rotated)||image.format!=='rgb-u8'||!(image.data instanceof ArrayBuffer)||image.data.byteLength!==header.width*header.height*3)throw Error();return image;
  }});
 return {async read(file:File,signal:AbortSignal){
  if(signal.aborted)throw new BackgroundInputError('aborted');
  if(typeof Worker!=='function')throw new BackgroundInputError('unsupported-browser');
  const header=await inspectImage(file,{signal});
  const image:Rgb=await task.run({file,header},{signal});
  if(signal.aborted)throw new BackgroundInputError('aborted');
  const result=Math.max(image.width,image.height)>2000?await resizeOriginal(image,signal):image;
  if(signal.aborted)throw new BackgroundInputError('aborted');
  if(result?.format!=='rgb-u8'||![result.width,result.height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=2000)
   ||!(result.data instanceof ArrayBuffer)||result.data.byteLength!==result.width*result.height*3)throw new BackgroundInputError('invalid-background-photo');
  if(Math.max(image.width,image.height)>2000&&(Math.max(result.width,result.height)!==2000
   ||result.width>image.width||result.height>image.height
   ||Math.abs(result.width*image.height-result.height*image.width)>Math.max(image.width,image.height)))throw new BackgroundInputError('invalid-background-photo');
  return result;
 },close:task.close};
}
