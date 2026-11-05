import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkerGate} from '../tools/browser-library-adapter/worker-gate.mjs';
import {createWorkerClient} from '../tools/browser-library-adapter/worker-client.mjs';
import {createExportWorkerClient} from '../tools/browser-library-adapter/export-worker-client.mjs';
import {FakeWorker} from './fixtures/fake-inference-worker.mjs';
const deferred=()=>{let resolve,reject;return {promise:new Promise((a,b)=>{resolve=a;reject=b;}),resolve:()=>resolve(),reject:()=>reject(Error('private shutdown'))};};
const prep={type:'prepare',model:'hr',modelVersion:'set-1',source:{mode:'library-resources',resources:[]}};
const image=()=>({width:1,height:1,format:'rgb-u8',data:new ArrayBuffer(3)});
function setup({badListeners=false}={}){
 const gate=createWorkerGate(),models=[],pixels=[];
 const client=createWorkerClient({gate,createWorker:()=>{const w=new FakeWorker(),stop=deferred();w.stop=stop;w.terminate=()=>{w.terminated++;return stop.promise;};if(badListeners)w.addEventListener=()=>{throw Error('private setup');};models.push(w);return w;}});
 const exporter=createExportWorkerClient({gate,createWorker:()=>{const w=new FakeWorker();pixels.push(w);return w;}});
 return {gate,models,pixels,client,exporter};
}
test('resident prepared model and asynchronous disposal keep pixel workers out',async()=>{
 const f=setup(),prepared=f.client.request(prep),w=f.models[0];w.reply({type:'prepared',model:'hr',modelVersion:'set-1'});await prepared;
 assert.equal(f.client.getState().busy,false);assert.equal(f.gate.getState().busy,true);
 await assert.rejects(f.exporter.encode(image(),{kind:'background'}),e=>e.code==='export-worker-busy');assert.equal(f.pixels.length,0);
 const disposing=f.client.request({type:'dispose'});w.reply({type:'disposed'});
 assert.equal(f.client.getState().stopping,true);await assert.rejects(f.client.request(prep),e=>e.code==='worker-stopping');
 await assert.rejects(f.exporter.encode(image(),{kind:'background'}),e=>e.code==='export-worker-busy');w.stop.resolve();await disposing;
 const encoded=f.exporter.encode(image(),{kind:'background'});f.pixels[0].reply({type:'encoded',file:{bytes:Uint8Array.of(1),width:1,height:1,mime:'image/png',filename:'image-studio-background.png'}});await encoded;
 assert.deepEqual(f.gate.getState(),{busy:false,blocked:false});await f.exporter.close();await f.client.cancel();
});
test('cancel invalidates ownership immediately but request settles only after termination',async()=>{
 const f=setup(),pending=f.client.request(prep),rejection=assert.rejects(pending,e=>e.code==='aborted');let settled=false;
 const stopping=f.client.cancel().then(()=>{settled=true;});assert.equal(f.client.getState().workerId,null);await Promise.resolve();assert.equal(settled,false);
 await assert.rejects(f.exporter.encode(image(),{kind:'background'}),e=>e.code==='export-worker-busy');f.models[0].stop.resolve();await stopping;await rejection;
 assert.deepEqual(f.gate.getState(),{busy:false,blocked:false});
});
test('termination failure poisons the shared gate and rejects both pending request and cancel',async()=>{
 const f=setup(),pending=f.client.request(prep),rejection=assert.rejects(pending,e=>e.code==='worker-stop-failed');
 const stopping=f.client.cancel(),stopRejected=assert.rejects(stopping,e=>e.code==='worker-stop-failed');f.models[0].stop.reject();await rejection;await stopRejected;
 assert.deepEqual(f.gate.getState(),{busy:false,blocked:true});await assert.rejects(f.client.request(prep),e=>e.code==='worker-unavailable');
 await assert.rejects(f.exporter.encode(image(),{kind:'background'}),e=>e.code==='export-worker-unavailable');assert.equal(f.pixels.length,0);
});
test('listener setup failure still waits for termination and releases only its own lease',async()=>{
 const f=setup({badListeners:true}),pending=f.client.request(prep),rejection=assert.rejects(pending,e=>e.code==='worker-create-failed');
 assert.equal(f.models[0].terminated,1);assert.equal(f.gate.getState().busy,true);f.models[0].stop.resolve();await rejection;assert.deepEqual(f.gate.getState(),{busy:false,blocked:false});
});
