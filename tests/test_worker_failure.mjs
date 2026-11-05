import test from 'node:test';
import assert from 'node:assert/strict';
import {workerFailure,runWorkerOperation} from '../tools/browser-library-adapter/worker-failure.mjs';
const envelope={workerId:'worker-1',jobId:'job-1'};
test('exceptions, including hostile getters, never cross the Worker failure boundary',async()=>{
 const hostile=new Proxy({}, {get(){throw Error('Exception fields must not be inspected');},ownKeys(){throw Error('Exception must not be enumerated');}});
 for(const payload of [Error('private-photo-name.jpg'),{message:'private',pixels:new Uint8Array([1,2,3])},hostile,null,'private']){
  const result=await runWorkerOperation({...envelope,photoName:'private'},async()=>{throw payload;});
  assert.deepEqual(result,{ok:false,event:{...envelope,type:'error',code:'runtime-error',retryable:true}});
  assert.equal(JSON.stringify(result).includes('private'),false);
  assert.deepEqual(structuredClone(result),result);
 }
});
test('trusted failure codes determine retryability without arbitrary metadata',()=>{
 assert.equal(workerFailure(envelope,'gpu-unavailable').retryable,false);
 assert.equal(workerFailure(envelope,'device-lost').retryable,true);
 assert.equal(workerFailure(envelope,'unsupported-model').retryable,false);
 assert.equal(workerFailure(envelope,'invalid-input').retryable,false);
 assert.equal(workerFailure(envelope,'private exception text').code,'runtime-error');
 assert.equal(workerFailure(envelope,{toString(){throw Error('Must not coerce');}}).code,'runtime-error');
});
test('successful operations retain their result; no error event is manufactured',async()=>{
 const value={alpha:new Uint8Array([0,255])};
 assert.deepEqual(await runWorkerOperation(envelope,()=>value),{ok:true,value});
});
