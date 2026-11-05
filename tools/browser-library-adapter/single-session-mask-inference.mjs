import {inferenceTransport} from './inference-input.mjs';
import {alphaToUint8} from './alpha-u8.mjs';
/** Existing published processor/model/Tensor APIs; no new resize or matting kernel. */
export function createSingleSessionMaskInference({RawImage,ImageProcessor,Tensor,interpolate,processorConfig,createBilinearResizer},{role,inputName,outputName,sigmoid=false}){
 if([RawImage,ImageProcessor,Tensor,interpolate,createBilinearResizer].some(value=>typeof value!=='function'))throw Error(role+'-preprocessing-unavailable');
 const processor=new ImageProcessor({...processorConfig,do_resize:false});
 return async function infer(handle,command,release){
  const request=inferenceTransport(command).request;
  if(release?.model!==role||typeof handle?.model!=='function'||request.refine)throw Error('invalid-'+role+'-input');
  const source=new RawImage(new Uint8Array(request.rgb.data),request.rgb.width,request.rgb.height,3);
  // Published size/aspect/divisibility policy; bound it before pixel allocation.
  const dimensions=processor.get_resize_output_image_size(source,processorConfig.size);
  if(!Array.isArray(dimensions)||dimensions.length!==2||!dimensions.every(n=>Number.isSafeInteger(n)&&n>=32&&n<=2048&&n%32===0))throw Error(role+'-aspect-budget-exceeded');
  const [width,height]=dimensions;
  const owned=new Set();let releaseFailed=false,resizer;
  const closeResize=()=>{const previous=resizer;resizer=null;previous?.close();};
  const track=record=>{if(record&&typeof record==='object')for(const value of Object.values(record))if(typeof value?.dispose==='function')owned.add(value);return record;};
  try{
   // The published browser RawImage.resize currently uses Canvas regardless of
   // resample. Reuse the already-verified Pillow bilinear implementation.
   resizer=await createBilinearResizer();
   const resized=resizer.resize({width:request.rgb.width,height:request.rgb.height,format:'rgb-u8',data:request.rgb.data},{width,height});closeResize();
   if(resized?.format!=='rgb-u8'||resized.width!==width||resized.height!==height||!(resized.data instanceof ArrayBuffer)||resized.data.byteLength!==width*height*3)throw Error('invalid-'+role+'-resize');
   const inputs=track(await processor(new RawImage(new Uint8Array(resized.data),width,height,3)));
   const pixels=inputs?.pixel_values,dims=pixels?.dims;
   if(pixels?.type!=='float32'||!Array.isArray(dims)||dims.length!==4||dims[0]!==1||dims[1]!==3
    ||!dims.slice(2).every(n=>Number.isSafeInteger(n)&&n>=32&&n<=2048&&n%32===0)||!(pixels.data instanceof Float32Array)||pixels.data.length!==3*dims[2]*dims[3])throw Error('invalid-'+role+'-processor-output');
   const outputs=track(await handle.model({[inputName]:pixels})),raw=outputs?.[outputName];
   if(raw?.type!=='float32'||JSON.stringify(raw.dims)!==JSON.stringify([1,1,dims[2],dims[3]])||!(raw.data instanceof Float32Array)||raw.data.length!==dims[2]*dims[3]||raw.data.some(value=>!Number.isFinite(value)))throw Error('invalid-'+role+'-model-output');
   const alpha=sigmoid?raw.sigmoid():raw;if(sigmoid)owned.add(alpha);
   if(alpha?.type!=='float32'||JSON.stringify(alpha.dims)!==JSON.stringify([1,1,dims[2],dims[3]])||!(alpha.data instanceof Float32Array)||alpha.data.length!==dims[2]*dims[3]
    ||alpha.data.some(value=>!Number.isFinite(value)||value<0||value>1))throw Error('invalid-'+role+'-model-output');
   // Apply sigmoid exactly once only for a fixed logits contract, then reuse existing
   // float-alpha interpolation/quantization contract at the original size.
   const plane=new Tensor('float32',alpha.data,[1,dims[2],dims[3]]);owned.add(plane);
   const restored=interpolate(plane,[request.rgb.height,request.rgb.width],'bilinear',false);owned.add(restored);
   if(restored?.type!=='float32'||JSON.stringify(restored.dims)!==JSON.stringify([1,request.rgb.height,request.rgb.width])||!(restored.data instanceof Float32Array)||restored.data.length!==request.rgb.width*request.rgb.height)throw Error('invalid-'+role+'-alpha-resize');
   return {width:request.rgb.width,height:request.rgb.height,layout:'alpha-u8',data:alphaToUint8(restored.data).buffer};
  }finally{
   try{closeResize();}catch{releaseFailed=true;}
   for(const tensor of [...owned].reverse())try{await tensor.dispose();}catch{releaseFailed=true;}
   if(releaseFailed)throw Error(role+'-resource-release-failed');
  }
 };
}
