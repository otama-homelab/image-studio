import {inferenceTransport} from './inference-input.mjs';
import {matteOutputToAlpha} from './matte-output.mjs';
/** Use the published processor/model API; no normalization, padding or inference kernel here. */
export function createVitMatteInference({RawImage,VitMatteImageProcessor,processorConfig}){
 if(typeof RawImage!=='function'||typeof VitMatteImageProcessor!=='function'||processorConfig?.size_divisibility!==32||processorConfig?.do_normalize!==true||processorConfig?.do_rescale!==true||processorConfig?.do_pad!==true)throw Error('invalid-matte-processor');
 const processor=new VitMatteImageProcessor({...processorConfig,do_resize:false});
 return async function infer(handle,command,release,{signal}={}){
  const request=inferenceTransport(command).request;
  if(release?.model!=='matte'||typeof handle?.model!=='function'||!request.refine||!request.hrAlpha||!request.trimap)throw Error('invalid-matte-input');
  const {width,height}=request.rgb,owned=new Set();let releaseFailed=false;
  const track=record=>{if(record&&typeof record==='object')for(const value of Object.values(record))if(typeof value?.dispose==='function')owned.add(value);return record;};
  try{
   const inputs=track(await processor(new RawImage(new Uint8Array(request.rgb.data),width,height,3),new RawImage(new Uint8Array(request.trimap.data),width,height,1)));
   const tensor=inputs?.pixel_values;
   if(tensor?.type!=='float32'||JSON.stringify(tensor.dims)!==JSON.stringify([1,4,Math.ceil(height/32)*32,Math.ceil(width/32)*32]))throw Error('invalid-matte-processor-output');
   const outputs=track(await (handle.runStaged?handle.runStaged({pixel_values:tensor},{signal}):handle.model({pixel_values:tensor}))),alpha=outputs?.alphas;
   if(alpha?.type!=='float32')throw Error('invalid-matte-model-output');
   const data=matteOutputToAlpha(alpha,width,height,new Uint8Array(request.trimap.data));
   return {width,height,layout:'alpha-u8',data:data.buffer};
  }finally{
   for(const tensor of [...owned].reverse())try{await tensor.dispose();}catch{releaseFailed=true;}
   if(releaseFailed)throw Error('matte-tensor-release-failed');
  }
 };
}
