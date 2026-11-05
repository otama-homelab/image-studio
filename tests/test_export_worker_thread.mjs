import test from 'node:test';
import assert from 'node:assert/strict';
import {createExportWorkerClient} from '../tools/browser-library-adapter/export-worker-client.mjs';
import {nodeExportWorker} from './fixtures/node-export-worker.mjs';
const image=()=>({width:2,height:1,format:'rgb-u8',data:Uint8Array.of(10,20,30,40,50,60).buffer});
test('actual export thread transfers input and returns only encoded bytes before exiting',{timeout:5000},async()=>{
 let stops=0;
 const client=createExportWorkerClient({createWorker:()=>{const worker=nodeExportWorker();return {...worker,async terminate(){await worker.terminate();stops++;}};}});
 try{
  const input=image(),pending=client.encode(input,{kind:'background'});assert.equal(input.data.byteLength,0);
  const file=await pending;assert.deepEqual([...file.bytes],[10,60]);assert.equal(file.bytes.buffer.byteLength,2);
  assert.equal(stops,1);assert.equal(client.getState().busy,false);
 }finally{await client.close();}
});
test('uncaught export thread error terminates and returns a fixed error',{timeout:5000},async()=>{
 const client=createExportWorkerClient({createWorker:()=>nodeExportWorker({crash:true})});
 try{await assert.rejects(client.encode(image(),{kind:'background'}),e=>e.code==='export-worker-failed'&&e.message==='export-worker-failed');assert.equal(client.getState().busy,false);}
 finally{await client.close();}
});

test('abort of a real export thread waits for termination before releasing the client',{timeout:5000},async()=>{
 let stopped=false;const controller=new AbortController();
 const client=createExportWorkerClient({createWorker:()=>{const worker=nodeExportWorker();return {...worker,async terminate(){await worker.terminate();stopped=true;}};}});
 try{
  const pending=client.encode(image(),{kind:'background'},{signal:controller.signal});
  const rejection=assert.rejects(pending,e=>e.code==='aborted');controller.abort('private reason');await rejection;
  assert.equal(stopped,true);assert.equal(client.getState().busy,false);
 }finally{await client.close();}
});
