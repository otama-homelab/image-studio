import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHrInference} from '../tools/browser-library-adapter/hr-inference.mjs';
const command=()=>({type:'infer',key:{inputId:'fixture',inferenceRevision:1,modelVersion:'test'},refine:false,rgb:{width:2,height:1,layout:'rgb-u8-interleaved',data:Uint8Array.of(10,20,30,40,50,60).buffer}});
function setup(mode){
 const order=[];let modelCalls=0;
 const half={type:'float16',dims:[1,3,2048,2048],data:new Float16Array(3*2048*2048),dispose(){order.push('half-free');this.data=null;}};
 const input={type:'float32',dims:[1,3,2048,2048],to(type){assert.equal(type,'float16');return half;},dispose(){order.push('float-free');}};
 class RawImage{constructor(data,w,h,c){assert.equal(w,2048);assert.equal(h,2048);assert.equal(c,3);}}
 class Processor{constructor(options){assert.equal(options.do_resize,false);assert.deepEqual(options.image_mean,[.485,.456,.406]);return async()=>({pixel_values:input});}}
 class Tensor{constructor(type,data,dims){Object.assign(this,{type,data,dims});}dispose(){order.push('view-free');}}
 const infer=createHrInference({RawImage,ImageProcessor:Processor,Tensor,createBilinearResizer:async()=>({resize(image,options){order.push('resize');assert.deepEqual(options,{width:2048,height:2048});assert.equal(image.width,2);if(mode==='resize')throw Error('resize failure');return {width:2048,height:2048,format:'rgb-u8',data:new ArrayBuffer(2048*2048*3)};},close(){order.push('resize-close');}}),interpolate(plane,dimensions,method,align){assert.deepEqual(plane.dims,[1,2048,2048]);assert.deepEqual(dimensions,[1,2]);assert.equal(method,'bilinear');assert.equal(align,false);return {type:'float32',dims:[1,1,2],data:Float32Array.of(.5,.25),dispose(){order.push('restored-free');}};}});
 const handle={model:async feeds=>{modelCalls++;order.push('model');assert.equal(feeds.pixels,half);assert.ok(order.indexOf('float-free')<order.indexOf('model'));if(mode==='run')throw Error('model failure');const output={type:'float32',dims:mode==='shape'?[1,1,1,1]:[1,1,2048,2048],data:new Float32Array(2048*2048),dispose(){order.push('output-free');this.data=null;}};if(mode==='nonfinite')output.data[100]=NaN;return {alpha:output};}};
 return {infer,handle,order,modelCalls:()=>modelCalls};
}
test('fixed2048 HR path uses pixels, no second sigmoid, returns original dimensions and releases resources',async()=>{
 const f=setup(),request=command(),result=await f.infer(f.handle,request,{model:'hr'});assert.deepEqual([...new Uint8Array(result.data)],[128,64]);assert.equal(result.width,2);assert.equal(result.height,1);assert.deepEqual([...new Uint8Array(request.rgb.data)],[10,20,30,40,50,60]);assert.equal(f.order.filter(x=>x==='resize-close').length,1);for(const name of ['float-free','half-free','output-free','view-free','restored-free'])assert.equal(f.order.filter(x=>x===name).length,1);
});
for(const mode of ['resize','run','shape','nonfinite'])test('HR '+mode+' failure releases available resources and never publishes alpha',async()=>{
 const f=setup(mode);await assert.rejects(f.infer(f.handle,command(),{model:'hr'}));assert.equal(f.order.filter(x=>x==='resize-close').length,1);if(mode!=='resize'){assert.equal(f.order.filter(x=>x==='float-free').length,1);assert.equal(f.order.filter(x=>x==='half-free').length,1);}if(['shape','nonfinite'].includes(mode))assert.equal(f.order.filter(x=>x==='output-free').length,1);
});
