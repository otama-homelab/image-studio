import test from 'node:test';
import assert from 'node:assert/strict';
import {foregroundToRgba} from '../tools/browser-library-adapter/foreground-rgba.mjs';
test('foreground truncates after float64 scale and preserves straight RGB at zero alpha',()=>{
 const result=foregroundToRgba(Uint8Array.of(20,30,40,50,60,70),Uint8Array.of(0,128),Float32Array.of(0.5,-0.1,1.1,0.3,0.5,0.7));
 assert.deepEqual([...result],[127,0,255,0,76,127,178,128]);
 // 0.7f32 * 255 is below 178.5; this checks truncation, not alpha rounding.
});
test('opaque RGB is exactly original and all 256 alpha bytes are unchanged',()=>{
 const alpha=Uint8Array.from({length:256},(_,i)=>i),rgb=Uint8Array.from({length:768},(_,i)=>(i*37)%256),foreground=new Float32Array(768).fill(0.5);
 const before=rgb.slice(),result=foregroundToRgba(rgb,alpha,foreground);
 for(let i=0;i<256;i++)assert.equal(result[i*4+3],i);
 assert.deepEqual([...result.slice(255*4,255*4+3)],[...rgb.slice(255*3)]);
 assert.deepEqual(rgb,before);assert.ok(foreground.every(v=>v===0.5));
});
test('invalid dimensions and non-finite estimates fail before accepting a cutout',()=>{
 assert.throws(()=>foregroundToRgba(new Uint8Array(2),new Uint8Array(1),new Float32Array(3)),TypeError);
 for(const value of [NaN,Infinity,-Infinity])assert.throws(()=>foregroundToRgba(new Uint8Array(3),Uint8Array.of(255),Float32Array.of(value,0,0)),/Non-finite/);
});
