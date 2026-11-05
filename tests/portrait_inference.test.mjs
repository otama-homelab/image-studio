import test from 'node:test';import assert from 'node:assert/strict';
import {createPortraitInference} from '../tools/browser-library-adapter/portrait-inference.mjs';
import {createLiteInference} from '../tools/browser-library-adapter/birefnet-inference.mjs';
for(const [role,createInference,size] of [['portrait',createPortraitInference,1024],['lite',createLiteInference,1024],['lite',createLiteInference,512]])test(role+' '+size+' contract keeps FP32 IO and applies sigmoid once to raw logits, releasing every tensor',async()=>{
 let sigmoidCalls=0,closed=0;const freed=new Set();
 class Tensor{constructor(type,data,dims){Object.assign(this,{type,data,dims});}sigmoid(){sigmoidCalls++;return new Tensor('float32',this.data.map(x=>1/(1+Math.exp(-x))),this.dims);}dispose(){assert.equal(freed.has(this),false);freed.add(this);}}
 const pixels=new Tensor('float32',new Float32Array(3*size*size),[1,3,size,size]);
 const raw=new Tensor('float32',new Float32Array(size*size).fill(-2),[1,1,size,size]);
 class ImageProcessor{constructor(config){assert.equal(config.do_resize,false);assert.deepEqual(config.image_mean,[.485,.456,.406]);const callable=async()=>({pixel_values:pixels});callable.get_resize_output_image_size=()=>[size,size];return callable;}}
 const infer=createInference({inputSize:size,RawImage:class{},ImageProcessor,Tensor,interpolate(plane,shape){assert.ok(Math.abs(plane.data[0]-.11920292)<1e-7);assert.deepEqual(shape,[1,2]);return new Tensor('float32',Float32Array.of(.5,.9),[1,1,2]);},createBilinearResizer:async()=>({resize:()=>({width:size,height:size,format:'rgb-u8',data:new ArrayBuffer(3*size*size)}),close(){closed++;}})});
 const request={type:'infer',key:{inputId:'fixed',modelVersion:'portrait',inferenceRevision:1},refine:false,rgb:{width:2,height:1,layout:'rgb-u8-interleaved',data:new ArrayBuffer(6)}};
 const out=await infer({model:async feeds=>{assert.deepEqual(Object.keys(feeds),['input_image']);assert.equal(feeds.input_image,pixels);return {output_image:raw};}},request,{model:role});
 assert.deepEqual([...new Uint8Array(out.data)],[128,230]);assert.equal(sigmoidCalls,1);assert.equal(closed,1);assert.equal(freed.size,5);
 await assert.rejects(infer({model:()=>{throw Error('must not run');}},{...request,refine:true},{model:role}),new RegExp('invalid-'+role+'-input'));
});

test('unsupported lite input sizes reject before creating processor or runtime',()=>{for(const inputSize of [0,256,768,2048,'512'])assert.throws(()=>createLiteInference({inputSize}),/invalid-lite-input-size/);});
