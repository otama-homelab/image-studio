import test from 'node:test';
import assert from 'node:assert/strict';
import {createRvmInference} from '../tools/browser-library-adapter/rvm-inference.mjs';
function fixture({bad=false,abort=false}={}){
 const tensors=[],calls=[],controller=new AbortController();let closed=0;
 class Tensor{constructor(type,data,dims){Object.assign(this,{type,data,dims});tensors.push(this);}dispose(){this.freed=true;}}
 const infer=createRvmInference({Tensor,createBilinearResizer:async()=>({resize:(rgb,size)=>{calls.push({rgb,size});return {format:'rgb-u8',...size,data:new Uint8Array(size.width*size.height*3).fill(255).buffer};},close(){closed++;}})});
 const handle={model:async({src})=>{calls.push({src});if(abort)controller.abort();return {'754':new Tensor('float32',new Float32Array(src.dims[2]*src.dims[3]).fill(1.2),[1,1,src.dims[2],src.dims[3]])};},restore:async feeds=>{calls.push(feeds);return {alpha:new Tensor('float32',Float32Array.of(-.1,.25,.75,1.1),bad?[1,1,1,4]:[1,1,2,2])};}};
 const rgb=Uint8Array.of(255,0,0,0,255,0,0,0,255,255,255,255);
 const command={type:'infer',key:{inputId:'test',inferenceRevision:1,modelVersion:'rvm-test'},refine:false,rgb:{width:2,height:2,layout:'rgb-u8-interleaved',data:rgb.buffer}};
 return {infer,handle,command,tensors,calls,controller,closed:()=>closed};
}
test('RVM keeps raw alpha for scalar restoration and disposes all tensors',async()=>{
 const f=fixture();const result=await f.infer(f.handle,f.command,{model:'rvm'});
 assert.deepEqual({...result,data:[...new Uint8Array(result.data)]},{width:2,height:2,layout:'alpha-u8',data:[0,64,191,255]});
 assert.deepEqual(f.calls[1].src.dims,[1,3,2,2]);assert.ok(f.calls[1].src.data.every(x=>x===1));
 assert.deepEqual(f.calls[2].lr_x.dims,[1,1,2,2]);assert.ok(f.calls[2].lr_y.data[0]>1);assert.deepEqual([...f.calls[2].hr_x.data],[Math.fround(1/3),Math.fround(1/3),Math.fround(1/3),1]);
 assert.equal(f.command.rgb.data.byteLength,12);assert.equal(f.closed(),1);assert.ok(f.tensors.every(x=>x.freed));
});
test('RVM bounds long-side input without changing original output geometry',async()=>{
 const f=fixture();f.command.rgb={width:1024,height:512,layout:'rgb-u8-interleaved',data:new Uint8Array(1024*512*3).buffer};
 f.handle.restore=async feeds=>{assert.deepEqual(feeds.lr_x.dims,[1,1,256,512]);assert.deepEqual(feeds.hr_x.dims,[1,1,512,1024]);return {alpha:{type:'float32',dims:[1,1,512,1024],data:new Float32Array(1024*512),dispose(){}}};};
 const result=await f.infer(f.handle,f.command,{model:'rvm'});assert.equal(result.data.byteLength,1024*512);assert.deepEqual(f.calls[0].size,{width:512,height:256});
});
test('RVM rejects malformed restore output and releases resources',async()=>{
 const f=fixture({bad:true});await assert.rejects(f.infer(f.handle,f.command,{model:'rvm'}),/invalid-rvm-restoration/);assert.ok(f.tensors.every(x=>x.freed));assert.equal(f.closed(),1);
});
test('RVM abort after model prevents restoration and frees raw alpha',async()=>{
 const f=fixture({abort:true});await assert.rejects(f.infer(f.handle,f.command,{model:'rvm'},{signal:f.controller.signal}),/aborted/);assert.equal(f.calls.length,2);assert.ok(f.tensors.every(x=>x.freed));
});
test('RVM rejects refine and wrong role before resize/model work',async()=>{
 const f=fixture();await assert.rejects(f.infer(f.handle,f.command,{model:'modnet'}),/invalid-rvm-input/);f.command.refine=true;await assert.rejects(f.infer(f.handle,f.command,{model:'rvm'}),/invalid-rvm-input/);assert.equal(f.calls.length,0);
});
