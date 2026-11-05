import test from 'node:test';import assert from 'node:assert/strict';
import {createModnetInference} from '../tools/browser-library-adapter/modnet-inference.mjs';
const command=()=>({type:'infer',key:{inputId:'fixed',inferenceRevision:1,modelVersion:'modnet'},refine:false,rgb:{width:2,height:1,layout:'rgb-u8-interleaved',data:Uint8Array.of(1,2,3,4,5,6).buffer}});
function fixture(mode){const freed=[],calls=[];
 class Tensor{constructor(type,data,dims){Object.assign(this,{type,data,dims});}dispose(){freed.push(this);this.data=null;}}
 const pixels=new Tensor('float32',new Float32Array(3*32*64),[1,3,32,64]);
 class ImageProcessor{constructor(config){assert.equal(config.size.shortest_edge,512);assert.equal(config.do_resize,false);const f=async()=>{calls.push('processor');return {pixel_values:pixels};};f.get_resize_output_image_size=image=>image.width===1?[32,64000]:[64,32];return f;}}
 const infer=createModnetInference({RawImage:class{constructor(data,width,height){Object.assign(this,{data,width,height});}},ImageProcessor,Tensor,processorConfig:{size:{shortest_edge:512},size_divisibility:32,resample:2},createBilinearResizer:async()=>({resize:(_,size)=>{calls.push('resize');return {...size,format:'rgb-u8',data:new ArrayBuffer(size.width*size.height*3)};},close(){calls.push('resize-close');}}),interpolate(t,shape,method,align){assert.deepEqual(t.dims,[1,32,64]);assert.deepEqual(shape,[1,2]);assert.equal(method,'bilinear');assert.equal(align,false);return new Tensor('float32',Float32Array.of(.5,.25),[1,1,2]);}});
 const handle={model:async feeds=>{calls.push('model');assert.equal(feeds.input,pixels);const alpha=new Tensor('float32',new Float32Array(32*64).fill(.5),[1,1,32,64]);if(mode==='nonfinite')alpha.data[0]=NaN;if(mode==='shape')alpha.dims=[1,1,64,32];if(mode==='throw')throw Error('private model failure');return {output:alpha};}};
 return {infer,handle,freed,calls};}
test('published MODNet input/output contract uses existing interpolation and releases all tensors',async()=>{
 const f=fixture(),c=command(),out=await f.infer(f.handle,c,{model:'modnet'});assert.deepEqual([...new Uint8Array(out.data)],[128,64]);assert.equal(out.width,2);assert.deepEqual(f.calls,['resize','resize-close','processor','model']);assert.equal(f.freed.length,4);assert.deepEqual([...new Uint8Array(c.rgb.data)],[1,2,3,4,5,6]);
});
for(const mode of ['nonfinite','shape','throw'])test('MODNet '+mode+' failure cannot publish a matte and releases available tensors',async()=>{const f=fixture(mode);await assert.rejects(f.infer(f.handle,command(),{model:'modnet'}));assert.equal(f.freed.length,mode==='throw'?1:2);});
test('unsupported roles, refinement and extreme resize requests fail before processing',async()=>{
 const f=fixture();await assert.rejects(f.infer(f.handle,command(),{model:'hr'}));await assert.rejects(f.infer(f.handle,{...command(),refine:true},{model:'modnet'}));const c=command();c.rgb={width:1,height:2000,layout:'rgb-u8-interleaved',data:new ArrayBuffer(6000)};await assert.rejects(f.infer(f.handle,c,{model:'modnet'}),/aspect-budget/);assert.deepEqual(f.calls,[]);
});
