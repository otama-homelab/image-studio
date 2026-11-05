import {inferenceTransport} from './inference-input.mjs';
import {alphaToUint8} from './alpha-u8.mjs';
const size=2048;
/** Fixed HR contract. Resize must be the verified Pillow bilinear implementation. */
export function createHrInference({RawImage,ImageProcessor,Tensor,interpolate,createBilinearResizer}){
 if(typeof Float16Array!=='function'||[RawImage,ImageProcessor,Tensor,interpolate,createBilinearResizer].some(value=>typeof value!=='function'))throw Error('hr-preprocessing-unavailable');
 const processor=new ImageProcessor({do_resize:false,do_pad:false,do_rescale:true,do_normalize:true,image_mean:[.485,.456,.406],image_std:[.229,.224,.225]});
 return async function infer(handle,command,release,{signal}={}){
  const request=inferenceTransport(command).request;
  if(release?.model!=='hr'||typeof handle?.model!=='function')throw Error('invalid-hr-input');
  const owned=new Set();let resizer,releaseFailed=false;
  const track=record=>{if(record&&typeof record==='object')for(const value of Object.values(record))if(typeof value?.dispose==='function')owned.add(value);return record;};
  const drop=async tensor=>{owned.delete(tensor);try{await tensor.dispose();}catch{throw Error('hr-tensor-release-failed');}};
  const closeResize=()=>{const previous=resizer;resizer=null;previous?.close();};
  try{
   resizer=await createBilinearResizer();
   let resized=resizer.resize({width:request.rgb.width,height:request.rgb.height,format:'rgb-u8',data:request.rgb.data},{width:size,height:size});closeResize();
   if(resized?.format!=='rgb-u8'||resized.width!==size||resized.height!==size||!(resized.data instanceof ArrayBuffer)||resized.data.byteLength!==size*size*3)throw Error('invalid-hr-resize');
   const inputs=track(await processor(new RawImage(new Uint8Array(resized.data),size,size,3)));resized=null;
   const full=inputs?.pixel_values;
   if(full?.type!=='float32'||JSON.stringify(full.dims)!==JSON.stringify([1,3,size,size]))throw Error('invalid-hr-processor-output');
   const pixels=full.to('float16');owned.add(pixels);
   if(pixels===full||pixels?.type!=='float16'||JSON.stringify(pixels.dims)!==JSON.stringify([1,3,size,size])||pixels.data.length!==3*size*size)throw Error('invalid-hr-fp16');
   await drop(full);
   const outputs=track(await (handle.runStaged?handle.runStaged({pixels},{signal}):handle.model({pixels})));await drop(pixels);
   const alpha=outputs?.alpha;
   if(alpha?.type!=='float32'||JSON.stringify(alpha.dims)!==JSON.stringify([1,1,size,size])||!(alpha.data instanceof Float32Array)||alpha.data.length!==size*size||alpha.data.some(value=>!Number.isFinite(value)))throw Error('invalid-hr-model-output');
   // The exported graph already applies sigmoid. Only reshape/interpolate/quantize here.
   const plane=new Tensor('float32',alpha.data,[1,size,size]);owned.add(plane);
   const restored=interpolate(plane,[request.rgb.height,request.rgb.width],'bilinear',false);owned.add(restored);
   if(restored?.type!=='float32'||JSON.stringify(restored.dims)!==JSON.stringify([1,request.rgb.height,request.rgb.width])||!(restored.data instanceof Float32Array)||restored.data.length!==request.rgb.width*request.rgb.height)throw Error('invalid-hr-alpha-resize');
   return {width:request.rgb.width,height:request.rgb.height,layout:'alpha-u8',data:alphaToUint8(restored.data).buffer};
  }finally{
   try{closeResize();}catch{releaseFailed=true;}
   for(const tensor of [...owned].reverse())try{await tensor.dispose();}catch{releaseFailed=true;}
   if(releaseFailed)throw Error('hr-resource-release-failed');
  }
 };
}
