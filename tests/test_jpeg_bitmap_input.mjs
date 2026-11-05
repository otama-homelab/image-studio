import test from 'node:test';
import assert from 'node:assert/strict';
import {createJpegBitmapInput} from '../tools/browser-library-adapter/jpeg-bitmap-input.mjs';
function setup({swap=false,badSize=false,fail=false,transparent=false,lateAbort=false}={}){
 let closed=0,canvases=0,options;const abort=new AbortController(),canvas={width:0,height:0,getContext:()=>({drawImage(){if(fail)throw Error('private file details');},getImageData:()=>({data:Uint8ClampedArray.of(1,2,3,255,4,5,6,transparent?0:255)})})};
 const read=createJpegBitmapInput({inspect:async()=>({type:'jpeg',width:2,height:1}),createBitmap:async(_,opts)=>{options=opts;if(lateAbort)abort.abort();return {width:badSize?3:swap?1:2,height:swap?2:1,close(){closed++;}};},createCanvas:(w,h)=>{canvases++;canvas.width=w;canvas.height=h;return canvas;}});
 return {read,abort,canvas,get closed(){return closed;},get canvases(){return canvases;},get options(){return options;}};
}
test('native options are explicit, RGB packing owns bytes, bitmap and canvas are closed',async()=>{
 const f=setup(),image=await f.read(new Blob());assert.deepEqual([...new Uint8Array(image.data)],[1,2,3,4,5,6]);assert.equal(image.format,'rgb-u8');assert.deepEqual(f.options,{imageOrientation:'from-image',premultiplyAlpha:'none',colorSpaceConversion:'default'});assert.equal(f.closed,1);assert.equal(f.canvas.width,0);assert.equal(f.canvas.height,0);
});
test('orientation-swapped dimensions accepted without another manual rotation',async()=>{const f=setup({swap:true}),image=await f.read(new Blob());assert.deepEqual([image.width,image.height],[1,2]);assert.equal(f.closed,1);});
test('unexpected size rejected before canvas allocation and bitmap closed',async()=>{const f=setup({badSize:true});await assert.rejects(f.read(new Blob()),e=>e.code==='image-dimensions-changed');assert.equal(f.canvases,0);assert.equal(f.closed,1);});
test('native failure redacted and resources disposed',async()=>{const f=setup({fail:true});await assert.rejects(f.read(new Blob()),e=>e.code==='jpeg-decode-failed'&&e.message==='jpeg-decode-failed');assert.equal(f.closed,1);assert.equal(f.canvas.width,0);});
test('late bitmap after abort is closed before canvas allocation',async()=>{const f=setup({lateAbort:true});await assert.rejects(f.read(new Blob(),{signal:f.abort.signal}),e=>e.code==='aborted');assert.equal(f.closed,1);assert.equal(f.canvases,0);});
test('nonopaque native JPEG output is rejected instead of silently flattening',async()=>{const f=setup({transparent:true});await assert.rejects(f.read(new Blob()),e=>e.code==='invalid-jpeg-pixels');assert.equal(f.closed,1);});

test('bitmap cleanup failure is fixed and still clears canvas storage',async()=>{
 let cleared=false;const canvas={height:1,get width(){return 1;},set width(value){cleared=value===0;},getContext:()=>({drawImage(){},getImageData:()=>({data:Uint8ClampedArray.of(1,2,3,255)})})};
 const read=createJpegBitmapInput({inspect:async()=>({type:'jpeg',width:1,height:1}),createBitmap:async()=>({width:1,height:1,close(){throw Error('private cleanup');}}),createCanvas:()=>canvas});
 await assert.rejects(read(new Blob()),e=>e.code==='jpeg-cleanup-failed'&&e.message==='jpeg-cleanup-failed');assert.equal(cleared,true);assert.equal(canvas.height,0);
});
