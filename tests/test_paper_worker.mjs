import test from 'node:test';
import assert from 'node:assert/strict';
import {paperTransport,paperResult} from '../tools/browser-library-adapter/paper-transport.mjs';
import {createPaperWorkerHandler} from '../tools/browser-library-adapter/paper-worker-handler.mjs';
import {createPaperWorkerClient} from '../tools/browser-library-adapter/paper-worker-client.mjs';
const photo=()=>({width:354,height:472,format:'rgb-u8',data:new Uint8Array(354*472*3).fill(77).buffer,privateMetadata:'secret'});
test('transport shares source bytes but rebuilds metadata and uses fixed existing layout',()=>{
 const image=photo(),p=paperTransport(image,{paper:'l',dpi:[300,300],private:'secret'});
 assert.equal(p.image.data,image.data);assert.equal(p.layout.count,3);assert.deepEqual(Object.keys(p.image).sort(),['data','format','height','width']);assert.deepEqual(Object.keys(p.options).sort(),['dpi','paper']);
 assert.throws(()=>paperResult(image,p.layout),e=>e.code==='invalid-paper-result');
});
test('invalid metadata/planes are rejected before Worker creation',async()=>{
 let created=0;const client=createPaperWorkerClient({createWorker:()=>{created++;}});
 for(const [image,options] of [[photo(),{paper:'l',dpi:[72,72]}],[{...photo(),format:'rgba-u8'},{paper:'l'}],[photo(),{paper:'unknown'}]])await assert.rejects(client.render(image,options),e=>e.code==='invalid-paper-input');
 assert.equal(created,0);await client.close();
});
test('receiver draws L paper at reference positions and transfers only canonical RGB',()=>{
 const replies=[],handler=createPaperWorkerHandler({postMessage:(event,transfer)=>replies.push({event,transfer})}),input=photo();
 handler({type:'render-paper',jobId:'current',image:input,options:{paper:'l',dpi:[300,300]}});
 const {event,transfer}=replies[0];assert.equal(event.type,'paper-rendered');assert.deepEqual([event.image.width,event.image.height],[1500,1051]);assert.equal(transfer[0],event.image.data);
 assert.deepEqual(Object.keys(event.image).sort(),['data','format','height','width']);const pixels=new Uint8Array(event.image.data);
 for(const [x,y] of [[184,289],[573,289],[962,289]])assert.deepEqual([...pixels.subarray((y*1500+x)*3,(y*1500+x)*3+3)],[77,77,77]);
 assert.deepEqual([...pixels.subarray(0,3)],[255,255,255]);assert.equal(new Uint8Array(input.data)[0],77);
 handler({type:'render-paper',jobId:'second',image:input,options:{paper:'l'}});assert.equal(replies[1].event.code,'invalid-paper-input');
});
test('malformed receiver message cannot allocate a sheet',()=>{
 const replies=[],handler=createPaperWorkerHandler({postMessage:event=>replies.push(event)});
 handler({type:'render-paper',jobId:'bad',image:{...photo(),data:new ArrayBuffer(1)},options:{paper:'l'}});
 assert.deepEqual(replies,[{type:'error',jobId:'bad',code:'invalid-paper-input'}]);
});
