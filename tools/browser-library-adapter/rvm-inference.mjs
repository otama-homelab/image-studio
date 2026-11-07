import {inferenceTransport} from './inference-input.mjs';
import {alphaToUint8} from './alpha-u8.mjs';

/** Independent stills: low RGB model plus a separate scalar guided-filter graph. */
export function createRvmInference({Tensor,createBilinearResizer}){
 if(typeof Tensor!=='function'||typeof createBilinearResizer!=='function')throw Error('rvm-preprocessing-unavailable');
 return async function infer(handle,command,release,{signal}={}){
  const request=inferenceTransport(command).request;
  if(release?.model!=='rvm'||typeof handle?.model!=='function'||typeof handle?.restore!=='function'||request.refine)throw Error('invalid-rvm-input');
  const checkAbort=()=>{if(signal?.aborted)throw Error('aborted');};
  checkAbort();
  const original=request.rgb,ratio=Math.min(1,512/Math.max(original.width,original.height));
  const width=Math.max(1,Math.floor(original.width*ratio)),height=Math.max(1,Math.floor(original.height*ratio));
  const owned=new Set();let resizer,releaseFailed=false;
  const track=record=>{if(record&&typeof record==='object')for(const value of Object.values(record))if(typeof value?.dispose==='function')owned.add(value);return record;};
  const tensor=(data,dims)=>{const value=new Tensor('float32',data,dims);owned.add(value);return value;};
  const valid=(value,dims)=>value?.type==='float32'&&JSON.stringify(value.dims)===JSON.stringify(dims)&&value.data instanceof Float32Array
   &&value.data.length===dims.reduce((a,b)=>a*b,1)&&value.data.every(Number.isFinite);
  const closeResize=()=>{const previous=resizer;resizer=null;previous?.close();};
  try{
   resizer=await createBilinearResizer();checkAbort();
   const resized=resizer.resize({width:original.width,height:original.height,format:'rgb-u8',data:original.data},{width,height});closeResize();
   if(resized?.format!=='rgb-u8'||resized.width!==width||resized.height!==height||!(resized.data instanceof ArrayBuffer)||resized.data.byteLength!==width*height*3)throw Error('invalid-rvm-resize');
   const count=width*height,bytes=new Uint8Array(resized.data),pixels=new Float32Array(count*3),lowMean=new Float32Array(count);
   for(let i=0;i<count;i++){
    pixels[i]=bytes[3*i]/255;pixels[count+i]=bytes[3*i+1]/255;pixels[2*count+i]=bytes[3*i+2]/255;
    lowMean[i]=(pixels[i]+pixels[count+i]+pixels[2*count+i])/3;
   }
   const outputs=track(await handle.model({src:tensor(pixels,[1,3,height,width])}));checkAbort();
   const raw=outputs?.['754'];if(!valid(raw,[1,1,height,width]))throw Error('invalid-rvm-model-output');
   // The high-resolution guide has one plane; never expand original RGB to float CHW.
   const originalBytes=new Uint8Array(original.data),highMean=new Float32Array(original.width*original.height);
   for(let i=0;i<highMean.length;i++)highMean[i]=(originalBytes[3*i]+originalBytes[3*i+1]+originalBytes[3*i+2])/765;
   const restored=track(await handle.restore({lr_x:tensor(lowMean,[1,1,height,width]),lr_y:raw,hr_x:tensor(highMean,[1,1,original.height,original.width])}));checkAbort();
   const alpha=restored?.alpha;if(!valid(alpha,[1,1,original.height,original.width]))throw Error('invalid-rvm-restoration');
   return {width:original.width,height:original.height,layout:'alpha-u8',data:alphaToUint8(alpha.data).buffer};
  }finally{
   try{closeResize();}catch{releaseFailed=true;}
   for(const value of [...owned].reverse())try{await value.dispose();}catch{releaseFailed=true;}
   if(releaseFailed)throw Error('rvm-resource-release-failed');
  }
 };
}
