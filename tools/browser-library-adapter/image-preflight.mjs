export class ImagePreflightError extends Error{
 constructor(code){super(code);this.name='ImagePreflightError';this.code=code;}
}
/** Bounded header probe using an injected existing library, never a pixel decoder. */
export function createImagePreflight({probe,maxPixels,maxAxis,headerBytes=256*1024}){
 if(typeof probe!=='function'||![maxPixels,maxAxis,headerBytes].every(n=>Number.isSafeInteger(n)&&n>0)||headerBytes>20*1024*1024)throw new ImagePreflightError('invalid-input-policy');
 const aborted=signal=>{if(signal?.aborted)throw new ImagePreflightError('aborted');};
 return async function inspect(file,{signal}={}){
  aborted(signal);
  if(!file||!Number.isSafeInteger(file.size)||file.size<=0||typeof file.slice!=='function')throw new ImagePreflightError('invalid-image-file');
  if(file.size>20*1024*1024)throw new ImagePreflightError('image-file-too-large');
  let bytes;
  try{bytes=new Uint8Array(await file.slice(0,Math.min(file.size,headerBytes)).arrayBuffer());}
  catch{aborted(signal);throw new ImagePreflightError('image-header-read-failed');}
  aborted(signal);
  if(bytes.byteLength>headerBytes)throw new ImagePreflightError('image-header-read-failed');
  let result;try{result=probe(bytes);}catch{throw new ImagePreflightError('image-header-unavailable');}
  if(!result||!['png','jpeg'].includes(result.type))throw new ImagePreflightError('image-header-unavailable');
  const {width,height,type}=result;
  if(![width,height].every(n=>Number.isSafeInteger(n)&&n>0))throw new ImagePreflightError('invalid-image-dimensions');
  if(width>maxAxis||height>maxAxis||width>Math.floor(maxPixels/height))throw new ImagePreflightError('image-dimensions-too-large');
  return Object.freeze({width,height,type,fileBytes:file.size});
 };
}
