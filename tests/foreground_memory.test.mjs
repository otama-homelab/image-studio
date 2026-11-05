import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createForegroundMemory} from '../tools/browser-library-adapter/foreground-memory.mjs';
const input=()=>({width:2,height:1,rgb:new Float32Array(6).fill(0.5),alpha:Float32Array.of(0,1)});
function fixture(mode){
 const memory=new WebAssembly.Memory({initial:1,maximum:2}),calls=[];let next=16;
 const exports={memory,malloc(size){calls.push('malloc');if(mode==='malloc-trap')throw Error('private');const pointer=next;next+=size;return mode==='null'?0:pointer;},free(){calls.push('free');if(mode==='free-trap')throw Error('private');},pymatting_ml_rgb(ip,ap,w,h,fp,bp){calls.push('run');if(mode==='trap')throw Error('private');for(const pointer of [fp,bp])new Float32Array(memory.buffer,pointer,w*h*3).fill(mode==='nan'?NaN:0.25);return mode==='allocation-failure'?-3:0;}};
 return {adapter:createForegroundMemory(exports),calls,exports};
}
test('invalid dimensions/planes/values reject before touching module exports',()=>{
 const {adapter,calls}=fixture();for(const change of [{width:2001},{width:1,height:1},{rgb:new Float32Array(5)},{alpha:Float32Array.of(NaN,1)},{alpha:Float32Array.of(-1,1)}])assert.throws(()=>adapter.estimate({...input(),...change}),/invalid-foreground-input/);assert.deepEqual(calls,[]);
});
test('outputs own copied planes; inputs preserved and all four allocations released',()=>{
 const {adapter,calls,exports}=fixture(),source=input(),before=source.rgb.slice(),result=adapter.estimate(source);assert.deepEqual(source.rgb,before);assert.ok(result.foreground.every(value=>value===0.25));assert.notEqual(result.foreground.buffer,exports.memory.buffer);assert.equal(calls.filter(call=>call==='free').length,4);adapter.close();assert.throws(()=>adapter.estimate(source),/unavailable/);
});
for(const mode of ['malloc-trap','null','trap','nan','free-trap'])test('failed module cannot be reentered: '+mode,()=>{
 const {adapter,calls}=fixture(mode);assert.throws(()=>adapter.estimate(input()));const count=calls.length;assert.equal(adapter.getState().closed,true);assert.throws(()=>adapter.estimate(input()),/unavailable/);assert.equal(calls.length,count);assert.equal(calls.filter(call=>call==='free').length,mode==='free-trap'?1:0);
});
test('native allocation failure returns fixed error and releases ABI allocations',()=>{
 const {adapter,calls}=fixture('allocation-failure');assert.throws(()=>adapter.estimate(input()),/foreground-memory-failed/);assert.equal(calls.filter(call=>call==='free').length,4);assert.equal(adapter.getState().closed,false);
});
