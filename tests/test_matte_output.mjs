import test from 'node:test';
import assert from 'node:assert/strict';
import {matteOutputToAlpha} from '../tools/browser-library-adapter/matte-output.mjs';

test('right/bottom padding is cropped using padded row stride, with no resize',()=>{
 const data=new Float32Array(32*32).fill(NaN);
 data.set([0,0.5,1],0);data.set([1,0.5,0],32);
 const trimap=Uint8Array.of(255,128,0,0,128,255),before=trimap.slice();
 const result=matteOutputToAlpha({data,dims:[1,1,32,32]},3,2,trimap);
 assert.deepEqual([...result],[255,128,0,0,128,255]);
 assert.deepEqual(trimap,before);assert.equal(data[0],0);assert.equal(data[32],1);assert.ok(Number.isNaN(data[3]));
});
test('a padded stride wider than 32 keeps row positions and output ownership',()=>{
 const data=new Float32Array(32*64).fill(0.5),trimap=new Uint8Array(33*2).fill(128);
 data[32]=1;data[64]=0;
 const result=matteOutputToAlpha({data,dims:[1,1,32,64]},33,2,trimap);
 assert.equal(result.length,66);assert.equal(result[32],255);assert.equal(result[33],0);
 result[0]=0;assert.equal(data[0],0.5);
});
test('wrong shape, dtype, dimensions and non-finite cropped values are rejected',()=>{
 const data=new Float32Array(1024),dims=[1,1,32,32],trimap=Uint8Array.of(128);
 for(const wrong of [[1,32,32],[2,1,32,32],[1,2,32,32],[1,1,64,32]])assert.throws(()=>matteOutputToAlpha({data,dims:wrong},1,1,trimap),/shape/);
 assert.throws(()=>matteOutputToAlpha({data:new Float64Array(1024),dims},1,1,trimap),/dtype/);
 for(const width of [0,-1,1.5,2001,Infinity])assert.throws(()=>matteOutputToAlpha({data,dims},width,1,trimap),/dimensions/);
 assert.throws(()=>matteOutputToAlpha({data,dims},1,1,new Uint8Array(2)),/trimap/);
 data[0]=NaN;assert.throws(()=>matteOutputToAlpha({data,dims},1,1,Uint8Array.of(255)),/Non-finite/);
});
