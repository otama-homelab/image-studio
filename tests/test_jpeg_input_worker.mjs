import test from 'node:test';
import assert from 'node:assert/strict';
import {createJpegInputWorkerClient,createJpegInputWorkerHandler} from '../tools/browser-library-adapter/jpeg-input-worker.mjs';
import {createPngInputWorkerClient} from '../tools/browser-library-adapter/png-input-worker.mjs';
import {createWorkerGate} from '../tools/browser-library-adapter/worker-gate.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function setup(type='jpeg'){const stop=deferred(),sent=deferred(),gate=createWorkerGate();let request,stops=0;
 class Worker extends EventTarget{postMessage(message){request=message;sent.resolve();}terminate(){stops++;return stop.promise;}}
 const worker=new Worker(),client=(type==='png'?createPngInputWorkerClient:createJpegInputWorkerClient)({gate,inspect:async()=>({type,width:2,height:1}),createWorker:()=>worker});
 return {client,gate,worker,stop,sent,get request(){return request;},get stops(){return stops;}};
}
test('swapped RGB response waits for Worker termination before release',async()=>{
 const f=setup(),pending=f.client.read(new Blob(['jpeg']));await f.sent.promise;
 const event=new Event('message');event.data={type:'jpeg-decoded',jobId:f.request.jobId,image:{width:1,height:2,format:'rgb-u8',data:new ArrayBuffer(6)}};f.worker.dispatchEvent(event);
 assert.equal(f.gate.getState().busy,true);assert.equal(f.client.getState().stopping,true);f.stop.resolve();const image=await pending;assert.deepEqual([image.width,image.height],[1,2]);assert.deepEqual(f.gate.getState(),{busy:false,blocked:false});assert.equal(f.stops,1);await f.client.close();
});
test('abort propagates termination failure and blocks shared admission',async()=>{
 const f=setup(),abort=new AbortController(),pending=f.client.read(new Blob(['jpeg']),{signal:abort.signal});await f.sent.promise;abort.abort();const rejected=assert.rejects(pending,e=>e.code==='jpeg-input-worker-stop-failed');f.stop.reject(Error('private'));await rejected;assert.equal(f.gate.getState().blocked,true);assert.equal(f.client.getState().blocked,true);assert.equal(f.stops,1);await f.client.close();
});
test('wrong pixel format is rejected and owner termination awaited',async()=>{
 const f=setup(),pending=f.client.read(new Blob(['jpeg']));await f.sent.promise;const rejected=assert.rejects(pending,e=>e.code==='jpeg-input-worker-protocol-error');const event=new Event('message');event.data={type:'jpeg-decoded',jobId:f.request.jobId,image:{width:2,height:1,format:'rgba-u8',data:new ArrayBuffer(8)}};f.worker.dispatchEvent(event);f.stop.resolve();await rejected;assert.equal(f.stops,1);await f.client.close();
});
test('handler accepts one Blob request and redacts native decoder errors',async()=>{
 const events=[];const handler=createJpegInputWorkerHandler({read:async()=>{throw Error('private filename');},postMessage:event=>events.push(event)});
 await handler({type:'decode-jpeg',jobId:'one',file:new Blob(['jpeg'])});await handler({type:'decode-jpeg',jobId:'two',file:new Blob(['jpeg'])});assert.deepEqual(events,[{type:'error',jobId:'one',code:'jpeg-input-worker-failed'},{type:'error',jobId:'two',code:'invalid-jpeg-input'}]);
});

for(const type of ['jpeg','png'])test(type+' File metadata is stripped from the cloned Worker payload',async()=>{
 const f=setup(type),file=new File(['jpeg'],'private-person.jpg',{type:'application/private',lastModified:123});file.privateMetadata='secret';
 const pending=f.client.read(file);await f.sent.promise;assert.ok(f.request.file instanceof Blob);assert.equal(f.request.file instanceof File,false);assert.equal('name' in f.request.file,false);assert.equal('lastModified' in f.request.file,false);assert.equal('privateMetadata' in f.request.file,false);assert.equal(f.request.file.type,'image/'+type);assert.equal(await f.request.file.text(),'jpeg');
 const aborted=assert.rejects(pending,e=>e.code==='jpeg-input-worker-aborted'||e.code==='aborted');const closing=f.client.close();f.stop.resolve();await aborted;await closing;
});
