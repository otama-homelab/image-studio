import test from 'node:test';
import assert from 'node:assert/strict';
import {createResizeWorkerHandler} from '../tools/browser-library-adapter/resize-worker-handler.mjs';
import {createResizeWorkerClient} from '../tools/browser-library-adapter/resize-worker-client.mjs';
const image=()=>({width:2,height:1,format:'rgb-u8',data:Uint8Array.of(1,2,3,4,5,6).buffer});
const command=()=>({type:'resize',jobId:'current',image:image(),options:{width:1,height:1}});
test('worker validates planes, strips extra metadata, transfers RGB result and closes resizer',async()=>{
 const messages=[];let closed=0;
 const handler=createResizeWorkerHandler({createResizer:async()=>({resize:()=>({...image(),width:1,data:Uint8Array.of(9,8,7).buffer,privateMetadata:'secret'}),close:()=>closed++}),postMessage:(event,transfer)=>messages.push({event,transfer})});
 await handler(command());assert.equal(closed,1);assert.equal(messages[0].event.type,'resized');assert.deepEqual(Object.keys(messages[0].event.image).sort(),['data','format','height','width']);assert.deepEqual([...new Uint8Array(messages[0].event.image.data)],[9,8,7]);assert.equal(messages[0].transfer[0],messages[0].event.image.data);
 await handler(command());assert.equal(messages[1].event.code,'invalid-resize-input');assert.equal(closed,1);
});
test('malformed input is rejected on both sides before runtime/Worker creation',async()=>{
 let created=0;const events=[],handler=createResizeWorkerHandler({createResizer:()=>{created++;},postMessage:event=>events.push(event)});
 const bad={...command(),image:{...image(),data:new ArrayBuffer(1)}};await handler(bad);assert.equal(created,0);assert.equal(events[0].code,'invalid-resize-input');
 const client=createResizeWorkerClient({createWorker:()=>{created++;}});await assert.rejects(client.resize(bad.image,bad.options),e=>e.code==='invalid-resize-input');assert.equal(created,0);await client.close();
});
test('runtime and close exceptions send only a fixed error and close is not retried',async()=>{
 for(const duringClose of [false,true]){
  const events=[];let closes=0;
  const handler=createResizeWorkerHandler({createResizer:async()=>({resize(){if(!duringClose)throw Error('private pixels');return {width:1,height:1,format:'rgb-u8',data:new ArrayBuffer(3)};},close(){closes++;if(duringClose)throw Error('private close');}}),postMessage:event=>events.push(event)});
  await handler(command());assert.equal(closes,1);assert.deepEqual(events,[{type:'error',jobId:'current',code:'resize-worker-failed'}]);
 }
});
test('failure cleanup finishes before terminal error lets the owner terminate the Worker',async()=>{
 const order=[];
 const handler=createResizeWorkerHandler({createResizer:async()=>({resize(){throw Error('private');},close(){order.push('closed');}}),postMessage:event=>{assert.deepEqual(order,['closed']);order.push(event.code);}});
 await handler(command());assert.deepEqual(order,['closed','resize-worker-failed']);
});
