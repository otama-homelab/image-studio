import test from 'node:test';
import assert from 'node:assert/strict';
import {createExportWorkerClient} from '../tools/browser-library-adapter/export-worker-client.mjs';
import {createExportWorkerHandler} from '../tools/browser-library-adapter/export-worker-handler.mjs';
const image=()=>({width:2,height:1,format:'rgb-u8',data:Uint8Array.of(10,20,30,40,50,60).buffer});
const options={kind:'background'},file=()=>({bytes:Uint8Array.of(1,2,3),mime:'image/png',filename:'image-studio-background.png',width:2,height:1});
function setup({delayStop,failStop=false}={}){
 const listeners=new Map(),messages=[];let stops=0;
 const worker={addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type){listeners.delete(type);},postMessage(command,transfer){messages.push(structuredClone(command,{transfer}));},async terminate(){stops++;if(delayStop)await delayStop;if(failStop)throw Error('private stop payload');}};
 const client=createExportWorkerClient({createWorker:()=>worker});
 return {client,messages,stops:()=>stops,reply:payload=>listeners.get('message')?.({data:{jobId:messages.at(-1).jobId,...payload}})};
}
test('input copy is transferred and encoded result waits for Worker termination',async()=>{
 let finishStop;const delay=new Promise(r=>{finishStop=r;}),f=setup({delayStop:delay}),input=image(),pending=f.client.encode(input,options);
 assert.equal(input.data.byteLength,0);f.reply({type:'encoded',file:file()});assert.equal(f.client.getState().stopping,true);
 await assert.rejects(f.client.encode(image(),options),e=>e.code==='export-worker-busy');finishStop();
 assert.deepEqual((await pending).bytes,Uint8Array.of(1,2,3));assert.equal(f.stops(),1);assert.equal(f.client.getState().busy,false);
});
test('abort terminates and rejects without forwarding its arbitrary reason',async()=>{
 const f=setup(),controller=new AbortController(),pending=f.client.encode(image(),options,{signal:controller.signal});
 controller.abort('private abort reason');await assert.rejects(pending,e=>e.message==='aborted');assert.equal(f.stops(),1);
});
test('bad result and stop failures cannot publish a ready file',async()=>{
 const f=setup(),pending=f.client.encode(image(),options);f.reply({type:'encoded',file:{...file(),filename:'private-name.png'}});
 await assert.rejects(pending,e=>e.code==='export-worker-protocol-error');
 const broken=setup({failStop:true}),failed=broken.client.encode(image(),options);broken.reply({type:'encoded',file:file()});
 await assert.rejects(failed,e=>e.code==='export-worker-stop-failed');
 await assert.rejects(broken.client.encode(image(),options),e=>e.code==='export-worker-unavailable');
});
test('receiver validates input and transfers only the intended encoded byte span',async()=>{
 for(const source of [Uint8Array.of(99,1,2,3,88),Buffer.from([99,1,2,3,88])]){
  const events=[];
  const handle=createExportWorkerHandler({encodePng:async()=>({...file(),bytes:source.subarray(1,4),private:'private'}),postMessage:(event,transfer)=>events.push({event,transfer})});
  await handle({type:'encode',jobId:'job-1',image:image(),options});
  const result=events[0];assert.deepEqual([...result.event.file.bytes],[1,2,3]);assert.equal(result.event.file.bytes.buffer.byteLength,3);
  assert.deepEqual(result.transfer,[result.event.file.bytes.buffer]);assert.equal(JSON.stringify(result.event).includes('private'),false);
  await handle({type:'encode',jobId:'job-2',image:{...image(),data:new ArrayBuffer(1)},options});assert.equal(events[1].event.code,'invalid-export-input');
 }
});
test('close awaits an already-started shutdown rather than polling or publishing early',async()=>{
 let stop;const delay=new Promise(r=>{stop=r;}),f=setup({delayStop:delay}),pending=f.client.encode(image(),options);
 const rejected=assert.rejects(pending,e=>e.code==='aborted');let closed=false;
 const closing=f.client.close().then(()=>{closed=true;});await Promise.resolve();assert.equal(closed,false);
 stop();await closing;await rejected;assert.equal(f.client.getState().closed,true);
});

test('Worker creation failure preserves the disposable input and redacts exception details',async()=>{
 const client=createExportWorkerClient({createWorker:()=>{throw Error('private worker URL');}}),input=image();
 await assert.rejects(client.encode(input,options),e=>e.code==='export-worker-create-failed'&&e.message==='export-worker-create-failed');
 assert.equal(input.data.byteLength,6);assert.equal(client.getState().busy,false);await client.close();
});
