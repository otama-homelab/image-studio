import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareStoredModel} from '../tools/browser-library-adapter/prepared-model.mjs';
const file={bytes:3,sha256:'a'.repeat(64)};
const good={...file,stored:true,networkVerified:true,cacheVerified:false};
const setup=(state=good)=>({requiredFiles:[file],policy:{getState:()=>[state]}});
test('identical content at separate resource URLs needs a verified stored state for each',async()=>{
 for(const states of [[good],[good,{...good,stored:false}],[good,{...good,networkVerified:false}]]){
  let released=0;
  await assert.rejects(prepareStoredModel({requiredFiles:[file,{...file}],policy:{getState:()=>states},load:async()=>({async dispose(){released++;}})}),e=>e.code==='model-resources-not-stored');
  assert.equal(released,1);
 }
 const model={async dispose(){}};
 assert.equal(await prepareStoredModel({requiredFiles:[file,{...file}],policy:{getState:()=>[good,{...good,networkVerified:false,cacheVerified:true}]},load:async()=>model}),model);
});
test('only verified and stored resources permit model publication',async()=>{
 const model={async dispose(){throw Error('Should retain the successful model');}};
 assert.equal(await prepareStoredModel({...setup(),load:async()=>model}),model);
 assert.equal(await prepareStoredModel({...setup({...good,networkVerified:false,cacheVerified:true}),load:async()=>model}),model);
 for(const state of [{...good,stored:false},{...good,networkVerified:false},{...good,sha256:'b'.repeat(64)},{...good,bytes:4}]){
  let released=0;
  await assert.rejects(prepareStoredModel({...setup(state),load:async()=>({async dispose(){released++;}})}),e=>e.code==='model-resources-not-stored');
  assert.equal(released,1);
 }
});
test('abort or stale operation after a slow load releases the returned model before rejecting',async()=>{
 for(const stale of [false,true]){
  const controller=new AbortController();let current=true,resolveLoad,resolveRelease,released=false,settled=false;
  const load=new Promise(r=>{resolveLoad=r;}),release=new Promise(r=>{resolveRelease=r;});
  const pending=prepareStoredModel({...setup(),signal:controller.signal,isCurrent:()=>current,load:()=>load});
  const rejection=assert.rejects(pending,e=>e.code===(stale?'operation-stale':'aborted')).then(()=>{settled=true;});
  if(stale)current=false;else controller.abort('private reason');
  resolveLoad({async dispose(){await release;released=true;}});
  await new Promise(r=>setImmediate(r));assert.equal(settled,false);
  resolveRelease();await rejection;assert.equal(released,true);
 }
});
test('already aborted or stale requests never call the model loader',async()=>{
 const controller=new AbortController();controller.abort();let calls=0;
 for(const options of [{signal:controller.signal},{isCurrent:()=>false}])await assert.rejects(prepareStoredModel({...setup(),...options,load:()=>{calls++;}}));
 assert.equal(calls,0);
});
test('load/release errors expose fixed codes and empty resource requirements are refused',async()=>{
 await assert.rejects(prepareStoredModel({...setup(),load:async()=>{throw Error('private load payload');}}),e=>e.code==='model-load-failed'&&e.message==='model-load-failed');
 await assert.rejects(prepareStoredModel({...setup({...good,stored:false}),load:async()=>({async dispose(){throw Error('private release payload');}})}),e=>e.code==='model-release-failed'&&e.message==='model-release-failed');
 await assert.rejects(prepareStoredModel({...setup(),requiredFiles:[],load:async()=>{throw Error('Must not run');}}),e=>e.code==='invalid-preparation-policy');
});
