import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkerClient} from '../tools/browser-library-adapter/worker-client.mjs';
import {createWorkerHandler} from '../tools/browser-library-adapter/worker-handler.mjs';
const trusted={model:'hr',modelVersion:'set-1',releaseId:'r1',cacheNamespace:'studio-r1',resources:[{name:'model.onnx',url:'https://assets.invalid/r1/model.onnx',sha256:'a'.repeat(64),bytes:3}]};

test('client and receiver complete prepare/infer/dispose through real structured-clone transfers',async()=>{
 const listeners=new Map();let terminated=false,releases=0,receivedRgb,returnedBuffer;
 const postBack=(event,transfer=[])=>{
  const copy=structuredClone(event,{transfer});
  queueMicrotask(()=>{if(!terminated)for(const fn of listeners.get('message')||[])fn({data:copy});});
 };
 const handle=createWorkerHandler({trustedModels:[trusted],prepare:async()=>({async dispose(){releases++;}}),
  infer:async(_,request)=>{
   receivedRgb=[...new Uint8Array(request.rgb.data)];returnedBuffer=Uint8Array.of(0,255).buffer;
   return {width:2,height:1,layout:'alpha-u8',data:returnedBuffer};
  },postMessage:postBack});
 const worker={
  addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
  removeEventListener(type,fn){listeners.get(type)?.delete(fn);},
  postMessage(request,transfer=[]){const copy=structuredClone(request,{transfer});queueMicrotask(()=>{if(!terminated)void handle(copy);});},
  terminate(){terminated=true;},
 };
 const client=createWorkerClient({createWorker:()=>worker});
 await client.request({type:'prepare',model:'hr',modelVersion:'set-1',source:{mode:'library-resources',releaseId:'r1',cacheNamespace:'studio-r1',resources:trusted.resources}});
 const original=Uint8Array.of(10,20,30,40,50,60),copy=original.slice().buffer;
 const pending=client.request({type:'infer',key:{inputId:'input-1',inferenceRevision:1,modelVersion:'set-1'},rgb:{width:2,height:1,layout:'rgb-u8-interleaved',data:copy},refine:false});
 assert.equal(copy.byteLength,0);
 const result=await pending;assert.deepEqual(receivedRgb,[...original]);assert.equal(original.byteLength,6);
 assert.equal(returnedBuffer.byteLength,0);assert.deepEqual([...new Uint8Array(result.alpha.data)],[0,255]);
 await client.request({type:'dispose'});assert.equal(releases,1);assert.equal(terminated,true);
});
