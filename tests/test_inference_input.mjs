import test from 'node:test';
import assert from 'node:assert/strict';
import {inferenceTransport} from '../tools/browser-library-adapter/inference-input.mjs';
const command=()=>({type:'infer',key:{inputId:'input-1',inferenceRevision:1,modelVersion:'set-1'},rgb:{width:2,height:1,layout:'rgb-u8-interleaved',data:new ArrayBuffer(6)},hrAlpha:{width:2,height:1,layout:'alpha-u8',data:new ArrayBuffer(2)},refine:true});
test('transport selects each disposable buffer once and discards arbitrary metadata',()=>{
 const c=command();c.photoName='private';c.rgb.path='private';c.key.filename='private';
 const out=inferenceTransport(c);assert.deepEqual(out.transfer,[c.rgb.data,c.hrAlpha.data]);
 assert.equal(new Set(out.transfer).size,2);assert.equal(JSON.stringify(out.request).includes('private'),false);
 assert.equal(out.request.rgb.data,c.rgb.data);assert.notEqual(out.request.key,c.key);
 delete c.hrAlpha;assert.equal(inferenceTransport(c).transfer.length,1);
});
test('invalid dimensions, layouts, keys and buffers are refused before sending',()=>{
 const mutations=[c=>{c.rgb.width=2001;},c=>{c.rgb.height=0;},c=>{c.rgb.width=1.5;},c=>{c.rgb.layout='alpha-u8';},c=>{c.rgb.data=new ArrayBuffer(5);},c=>{c.rgb.data=new SharedArrayBuffer(6);},c=>{structuredClone(c.rgb.data,{transfer:[c.rgb.data]});},c=>{c.hrAlpha.width=1;},c=>{c.hrAlpha.data=new ArrayBuffer(1);},c=>{c.key.inferenceRevision=-1;},c=>{c.key.inputId='';},c=>{c.refine='true';}];
 for(const mutate of mutations){const c=command();mutate(c);assert.throws(()=>inferenceTransport(c),e=>e.message==='invalid-input');}
});

test('actual structured-clone transfer detaches only disposable copies, preserving originals',()=>{
 const originalRgb=Uint8Array.of(10,20,30,40,50,60),originalAlpha=Uint8Array.of(0,255);
 const c=command();c.rgb.data=originalRgb.slice().buffer;c.hrAlpha.data=originalAlpha.slice().buffer;
 const transport=inferenceTransport(c),received=structuredClone(transport.request,{transfer:transport.transfer});
 assert.equal(c.rgb.data.byteLength,0);assert.equal(c.hrAlpha.data.byteLength,0);
 assert.deepEqual([...new Uint8Array(received.rgb.data)],[...originalRgb]);assert.deepEqual([...new Uint8Array(received.hrAlpha.data)],[...originalAlpha]);
 assert.equal(originalRgb.byteLength,6);assert.equal(originalAlpha.byteLength,2);
});

test('trimap is transferred separately and invalid values or aliased planes are rejected',()=>{
 const c=command();c.trimap={width:2,height:1,layout:'trimap-u8',data:Uint8Array.of(0,128).buffer};
 assert.equal(inferenceTransport(c).transfer.length,3);
 new Uint8Array(c.trimap.data)[1]=127;assert.throws(()=>inferenceTransport(c),e=>e.message==='invalid-input');
 new Uint8Array(c.trimap.data)[1]=255;c.hrAlpha.data=c.trimap.data;
 assert.throws(()=>inferenceTransport(c),e=>e.message==='invalid-input');assert.equal(c.rgb.data.byteLength,6);
});
