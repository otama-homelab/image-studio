import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVitMatteInference} from '../tools/browser-library-adapter/vitmatte-inference.mjs';
const config={do_normalize:true,do_rescale:true,do_pad:true,size_divisibility:32};
const command=()=>({type:'infer',key:{inputId:'synthetic',inferenceRevision:1,modelVersion:'test'},refine:true,rgb:{width:3,height:1,layout:'rgb-u8-interleaved',data:new Uint8Array(9).buffer},hrAlpha:{width:3,height:1,layout:'alpha-u8',data:Uint8Array.of(0,128,255).buffer},trimap:{width:3,height:1,layout:'trimap-u8',data:Uint8Array.of(0,128,255).buffer}});
function setup(mode){
 const disposed=[],input={type:'float32',dims:[1,4,32,32],dispose(){disposed.push('input');}},output={type:'float32',dims:[1,1,32,32],data:new Float32Array(1024).fill(0.5),dispose(){disposed.push('output');if(mode==='release')throw Error('private');}};
 let calls=0;class RawImage{constructor(data,width,height,channels){Object.assign(this,{data,width,height,channels});}}
 class Processor{constructor(options){assert.equal(options.do_resize,false);return async(image,trimap)=>{assert.equal(image.channels,3);assert.equal(trimap.channels,1);return {pixel_values:input,original_sizes:[[1,3]]};};}}
 const infer=createVitMatteInference({RawImage,VitMatteImageProcessor:Processor,processorConfig:config}),handle={model:async feeds=>{calls++;assert.equal(feeds.pixel_values,input);if(mode==='run')throw Error('private');if(mode==='shape')output.dims=[1,1,1,3];return {alphas:output};}};
 return {infer,handle,disposed,calls:()=>calls};
}
test('processor/model/postprocess connect without resize and release input/output tensors',async()=>{
 const f=setup(),request=command(),before=new Uint8Array(request.trimap.data).slice(),result=await f.infer(f.handle,request,{model:'matte'});assert.deepEqual([...new Uint8Array(result.data)],[0,128,255]);assert.deepEqual(new Uint8Array(request.trimap.data),before);assert.deepEqual(f.disposed,['output','input']);
});
test('phased CPU handle receives the inference signal while retaining normal processor and alpha rules',async()=>{
 const f=setup(),controller=new AbortController(),legacy=f.handle.model;let calls=0;
 f.handle.model=()=>{throw Error('legacy route must not run');};
 f.handle.runStaged=async(feeds,{signal})=>{assert.equal(signal,controller.signal);calls++;return legacy(feeds);};
 const result=await f.infer(f.handle,command(),{model:'matte'},{signal:controller.signal});
 assert.equal(calls,1);assert.deepEqual([...new Uint8Array(result.data)],[0,128,255]);assert.deepEqual(f.disposed,['output','input']);
});
for(const mode of ['run','shape','release'])test('failed '+mode+' still releases every available tensor',async()=>{
 const f=setup(mode);await assert.rejects(f.infer(f.handle,command(),{model:'matte'}));assert.deepEqual(f.disposed,mode==='run'?['input']:['output','input']);
});
test('missing trimap/refinement and wrong role cannot invoke the model',async()=>{
 const f=setup();for(const change of [{trimap:undefined},{refine:false}])await assert.rejects(f.infer(f.handle,{...command(),...change},{model:'matte'}));await assert.rejects(f.infer(f.handle,command(),{model:'hr'}));assert.equal(f.calls(),0);assert.deepEqual(f.disposed,[]);
});
