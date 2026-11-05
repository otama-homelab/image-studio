export class JpegBitmapInputError extends Error{
 constructor(code){super(code);this.name='JpegBitmapInputError';this.code=code;}
}
/** Native JPEG decoding candidate; color/orientation fidelity requires real browser fixtures. */
export function createJpegBitmapInput({inspect,createBitmap,createCanvas}){
 const aborted=signal=>{if(signal?.aborted)throw new JpegBitmapInputError('aborted');};
 return async function read(file,{signal}={}){
  aborted(signal);const header=await inspect(file,{signal});
  if(header.type!=='jpeg')throw new JpegBitmapInputError('jpeg-input-required');
  let bitmap,canvas;
  try{
   bitmap=await createBitmap(file,{imageOrientation:'from-image',premultiplyAlpha:'none',colorSpaceConversion:'default'});
   aborted(signal);
   const {width,height}=bitmap;
   if(![width,height].every(n=>Number.isSafeInteger(n)&&n>0)||!((width===header.width&&height===header.height)||(width===header.height&&height===header.width)))throw new JpegBitmapInputError('image-dimensions-changed');
   canvas=createCanvas(width,height);const ctx=canvas.getContext('2d',{willReadFrequently:true});
   if(!ctx)throw new JpegBitmapInputError('image-context-unavailable');
   ctx.drawImage(bitmap,0,0);const pixels=ctx.getImageData(0,0,width,height).data;
   aborted(signal);
   if(!(pixels instanceof Uint8ClampedArray)||pixels.length!==width*height*4)throw new JpegBitmapInputError('invalid-jpeg-pixels');
   const data=new Uint8Array(width*height*3);
   for(let i=0,j=0;i<pixels.length;i+=4,j+=3){
    if(pixels[i+3]!==255)throw new JpegBitmapInputError('invalid-jpeg-pixels');
    data[j]=pixels[i];data[j+1]=pixels[i+1];data[j+2]=pixels[i+2];
   }
   return {width,height,format:'rgb-u8',data:data.buffer};
  }catch(error){
   if(error instanceof JpegBitmapInputError)throw error;
   aborted(signal);throw new JpegBitmapInputError('jpeg-decode-failed');
  }finally{
   // Explicit native resource disposal; the owning Worker must still terminate.
   let cleanupFailed=false;
   try{bitmap?.close();}catch{cleanupFailed=true;}
   if(canvas){try{canvas.width=0;canvas.height=0;}catch{cleanupFailed=true;}}
   if(cleanupFailed)throw new JpegBitmapInputError('jpeg-cleanup-failed');
  }
 };
}
