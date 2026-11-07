import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRvmPreparation} from '../tools/browser-library-adapter/rvm-prepare.mjs';
function fixture({failSecond=false,quota=false,waitRun,afterCreate}={}){
 const stored=new Map(),calls=[];let created=0,owners=0;
 const resources=['model.onnx','restore.onnx'].map((name,i)=>({name,url:'https://fixture.invalid/rvm/'+name,bytes:1,sha256:createHash('sha256').update(Uint8Array.of(i+1)).digest('hex')}));
 const cache={match:async url=>stored.get(String(url))?.clone(),put:async(url,response)=>{if(quota)throw Error('quota');stored.set(String(url),new Response(await response.arrayBuffer()));}};
 const makeHasher=async()=>{const h=createHash('sha256');return {update:x=>h.update(x),digestHex:()=>h.digest('hex')};};
 const prepare=createRvmPreparation({ort:{InferenceSession:{create:async(bytes,options)=>{const id=++created;assert.deepEqual(options.executionProviders,['wasm']);assert.equal(bytes[0],id);if(id===2&&failSecond)throw Error('load');await afterCreate?.(id);return {run:async feeds=>{calls.push('run'+id);await waitRun?.();return feeds;},release:async()=>calls.push('release'+id)};}}},env:{},cache,makeHasher,fetchImpl:async url=>new Response(Uint8Array.of(resources.findIndex(x=>x.url===String(url))+1)),configureRuntime:async()=>({executionProvider:'wasm',sessionOptions:{executionProviders:['wasm']},dispose:async()=>owners++})});
 return {prepare,release:{model:'rvm',modelVersion:'fixed',resources},calls,stats:()=>({created,owners,stored:stored.size})};
}
test('RVM prepares verified cached pair and disposes both sessions once',async()=>{
 const f=fixture(),h=await f.prepare(f.release);assert.deepEqual(f.stats(),{created:2,owners:0,stored:2});assert.deepEqual(await h.model({src:1}),{src:1});assert.deepEqual(await h.restore({lr_x:1}),{lr_x:1});await h.dispose();await h.dispose();assert.deepEqual(f.calls,['run1','run2','release2','release1']);assert.equal(f.stats().owners,1);await assert.rejects(h.model({}),/unavailable/);
});
test('RVM second-session failure releases first session and runtime',async()=>{
 const f=fixture({failSecond:true});await assert.rejects(f.prepare(f.release),/model-load-failed/);assert.deepEqual(f.calls,['release1']);assert.equal(f.stats().owners,1);
});
test('RVM disposal waits for in-flight native work',async()=>{
 let enter,finish;const started=new Promise(r=>enter=r),waiting=new Promise(r=>finish=r);const f=fixture({waitRun:async()=>{enter();await waiting;}}),h=await f.prepare(f.release);const run=h.model({});await started;const closing=h.dispose();await Promise.resolve();assert.deepEqual(f.calls,['run1']);finish();await run;await closing;assert.deepEqual(f.calls,['run1','release2','release1']);
});
test('RVM failed cache storage cannot create sessions',async()=>{
 const f=fixture({quota:true});await assert.rejects(f.prepare(f.release));assert.equal(f.stats().created,0);assert.equal(f.stats().owners,0);
});

test('RVM abort during session creation releases the completed session before rejecting',async()=>{
 const controller=new AbortController(),f=fixture({afterCreate:async id=>{if(id===1)controller.abort();}});await assert.rejects(f.prepare(f.release,{signal:controller.signal}),/aborted/);assert.deepEqual(f.calls,['release1']);assert.equal(f.stats().created,1);assert.equal(f.stats().owners,1);
});
