const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname,'../tools/browser-webgpu-poc/model-worker.js'),'utf8')
  .replace("import * as ort from '/runtime/ort.webgpu.min.mjs';",'const ort = mockOrt;')
  .replace("import {readWarmModel} from './stored-model.mjs';",'const readWarmModel=()=>{throw Error("Unexpected warm model read in CPU worker contract");};');

async function execute(dtype, bits, precision=dtype) {
  let input, disposed=0;
  const context = vm.createContext({Uint8Array,Uint16Array,Float32Array,performance,crypto:webcrypto,
    mockOrt:{Tensor:class {constructor(type,data,dims) {input={type,data,dims};} dispose(){disposed++;}}},
    self:{postMessage(){}},console});
  vm.runInContext(source,context);
  context.bytes = new Uint8Array(bits.buffer);
  context.dtype=dtype; context.precision=precision;
  vm.runInContext(`config={precision,inputName:'pixels',outputName:'alpha',cases:[{id:'test',file:'test',dtype,shape:[1,1,1,2]}]};
    verifiedFetch=async()=>bytes;
    session={run:async()=>({alpha:{type:'float32',dims:[1,1,1,2],getData:async()=>new Float32Array([0,1]),dispose(){}}})};`,context);
  await vm.runInContext("run({caseId:'test'})",context);
  return {input,disposed};
}

test('FP16 keeps raw half bits and releases its tensor',async()=>{
  const {input,disposed}=await execute('float16',new Uint16Array([0x3c00,0xbc00]));
  assert.equal(input.type,'float16'); assert.ok(input.data instanceof Uint16Array);
  assert.deepEqual([...input.data],[0x3c00,0xbc00]); assert.equal(disposed,1);
});
test('FP32 retains existing input semantics',async()=>{
  const {input,disposed}=await execute('float32',new Float32Array([1,-1]));
  assert.equal(input.type,'float32'); assert.deepEqual([...input.data],[1,-1]); assert.equal(disposed,1);
});
test('mixed precision contract is rejected',async()=>{
  await assert.rejects(execute('float16',new Uint16Array([0,1]),'float32'),/dtype contract mismatch/);
});

test('diagnostic half statistics decode raw bits without numeric reinterpretation',()=>{
  const context=vm.createContext({Uint8Array,Uint16Array,Float32Array,performance,crypto:webcrypto,mockOrt:{},self:{},console});
  vm.runInContext(source,context);
  context.values=new Uint16Array([0x3c00,0xbc00,0x7c00,0xfc00,0x7e00,0x0001,0x8000]);
  const stats=vm.runInContext("summarizeTensor('float16',values,[7])",context);
  assert.equal(stats.elements,7);assert.equal(stats.finite,4);assert.equal(stats.nan,1);
  assert.equal(stats.positiveInfinity,1);assert.equal(stats.negativeInfinity,1);
  assert.equal(stats.firstNonfiniteIndex,2);assert.equal(stats.min,-1);assert.equal(stats.max,1);
});
test('diagnostic full float statistics retain nonfinite counts and reject byte mismatch',()=>{
  const context=vm.createContext({Uint8Array,Uint16Array,Float32Array,performance,crypto:webcrypto,mockOrt:{},self:{},console});
  vm.runInContext(source,context);context.values=new Float32Array([NaN,Infinity,-Infinity]);
  const stats=vm.runInContext("summarizeTensor('float32',values,[3])",context);
  assert.equal(stats.finite,0);assert.equal(stats.min,null);assert.equal(stats.max,null);assert.equal(stats.nan,1);
  assert.throws(()=>vm.runInContext("summarizeTensor('float16',values,[3])",context),/byte\/shape mismatch/);
});

test('dispose awaits session release before device destruction and acknowledges after cleanup',async()=>{
  const order=[],events=[];
  const context=vm.createContext({Uint8Array,Uint16Array,Float32Array,performance,crypto:webcrypto,mockOrt:{},self:{postMessage:event=>events.push(event)},console});
  vm.runInContext(source,context);context.release=async()=>{await Promise.resolve();order.push('release');};context.destroy=()=>order.push('destroy');
  vm.runInContext("session={release};device={destroy};config={};runNumber=2;totalBytes=42",context);
  await context.self.onmessage({data:{type:'dispose',jobId:8}});
  assert.deepEqual(order,['release','destroy']);assert.equal(events.at(-1).type,'disposed');assert.equal(events.at(-1).jobId,8);
  assert.equal(vm.runInContext('session===undefined && device===undefined && config===undefined && runNumber===0 && totalBytes===0',context),true);
});
test('failed release still destroys the device, clears ownership and reports failure rather than disposed',async()=>{
  let destroyed=false;const events=[];
  const context=vm.createContext({Uint8Array,Uint16Array,Float32Array,performance,crypto:webcrypto,mockOrt:{},self:{postMessage:event=>events.push(event)},console});
  vm.runInContext(source,context);context.destroy=()=>{destroyed=true;};
  vm.runInContext("session={release:async()=>{throw Error('release failed')}};device={destroy};config={}",context);
  await context.self.onmessage({data:{type:'dispose',jobId:9}});
  assert.equal(destroyed,true);assert.equal(events.at(-1).type,'error');assert.equal(events.some(e=>e.type==='disposed'),false);
  assert.equal(vm.runInContext('session===undefined && device===undefined && config===undefined',context),true);
});
test('a second model load cannot silently overwrite an existing live session',async()=>{
  const context=vm.createContext({Uint8Array,Uint16Array,Float32Array,performance,crypto:webcrypto,mockOrt:{},self:{},console});
  vm.runInContext(source,context);vm.runInContext('session={}',context);
  await assert.rejects(vm.runInContext('load({config:{}})',context),/Dispose the existing session/);
});

test('storage cache experiment preserves the default and only permits documented experimental overrides',()=>{
 const context=vm.createContext({Uint8Array,Uint16Array,Float32Array,performance,crypto:webcrypto,mockOrt:{},self:{},console});
 vm.runInContext(source,context);
 assert.equal(vm.runInContext('JSON.stringify(storageCacheOptions(undefined))',context),'{}');
 assert.equal(vm.runInContext("JSON.stringify(storageCacheOptions('default'))",context),'{}');
 assert.equal(vm.runInContext("JSON.stringify(storageCacheOptions('disabled'))",context),'{"storageBufferCacheMode":"disabled"}');
 assert.equal(vm.runInContext("JSON.stringify(storageCacheOptions('lazyRelease'))",context),'{"storageBufferCacheMode":"lazyRelease"}');
 assert.throws(()=>vm.runInContext("storageCacheOptions('unknown')",context),/Unsupported/);
});
