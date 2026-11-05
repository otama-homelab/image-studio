import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkerGate} from '../tools/browser-library-adapter/worker-gate.mjs';
import {createInferenceOperation} from '../tools/browser-library-adapter/inference-operation.mjs';
import {createSerialInference} from '../tools/browser-library-adapter/serial-inference.mjs';
import {createWorkerClient} from '../tools/browser-library-adapter/worker-client.mjs';
import {createExportWorkerClient} from '../tools/browser-library-adapter/export-worker-client.mjs';
import {createImageRegistry} from '../tools/browser-library-adapter/image-registry.mjs';
import {FakeWorker} from './fixtures/fake-inference-worker.mjs';
const context={key:{inputId:'input',inferenceRevision:1,modelVersion:'set-1'},rgbAssetId:'source',refine:true};
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};};
test('pipeline lease bridges HR disposal, trimap and matte creation without admitting export',async()=>{
 const gate=createWorkerGate(),registry=createImageRegistry(),source=registry.register({width:3,height:1,format:'rgb-u8',data:new ArrayBuffer(9)},'session');
 const workers=[];let client,trimapCalls=0,pixelCreates=0;
 const pixel=createExportWorkerClient({gate,createWorker:()=>{pixelCreates++;throw Error('must not create');}});
 const operation=createInferenceOperation({gate,getCurrent:()=>({...context,rgbAssetId:source.id}),cancelOwned:()=>client?.cancel(),committer:{commit:r=>({status:'committed',key:r.key})},
  execute:(c,{isCurrent,workerGate})=>{
   client=createWorkerClient({gate:workerGate,createWorker:()=>{
    const w=new FakeWorker(),post=w.postMessage.bind(w);workers.push(w);
    w.postMessage=(command,transfer)=>{post(command,transfer);queueMicrotask(()=>{
     if(command.type==='prepare')w.reply({type:'prepared',model:command.model,modelVersion:command.modelVersion});
     else if(command.type==='infer')w.reply({type:'result',key:command.key,alpha:{width:3,height:1,layout:'alpha-u8',data:Uint8Array.of(0,128,255).buffer}});
     else if(command.type==='dispose')w.reply({type:'disposed'});
    });};return w;
   }});
   const source={mode:'library-resources',resources:[]};
   return createSerialInference({registry,client,prepareHr:{type:'prepare',model:'hr',modelVersion:'set-1',source},prepareMatte:{type:'prepare',model:'matte',modelVersion:'set-1',source},makeTrimap:async()=>{
    trimapCalls++;assert.equal(workers[0].terminated,1);assert.equal(workerGate.getState().busy,false);assert.equal(gate.getState().busy,true);
    await assert.rejects(pixel.encode({width:1,height:1,format:'rgb-u8',data:new ArrayBuffer(3)},{kind:'background'}),e=>e.code==='export-worker-busy');
    return {width:3,height:1,layout:'trimap-u8',data:Uint8Array.of(0,128,255).buffer};
   }})(c,{isCurrent});
  },
 });
 assert.equal((await operation.start()).status,'committed');assert.equal(trimapCalls,1);assert.equal(pixelCreates,0);assert.equal(workers.length,2);assert.ok(workers.every(w=>w.terminated===1));
 assert.deepEqual(gate.getState(),{busy:false,blocked:false});await assert.rejects(client.request({type:'prepare',model:'hr',modelVersion:'set-1'}),e=>e.code==='worker-unavailable');
 await pixel.close();registry.release(source.id,'session');
});
test('parent release waits for child termination; closed capability cannot start more children',()=>{
 const gate=createWorkerGate(),parent=gate.tryAcquire(),scoped=parent.createChildGate(),child=scoped.tryAcquire();
 parent.release();assert.equal(gate.getState().busy,true);assert.equal(scoped.tryAcquire(),null);assert.equal(gate.tryAcquire(),null);
 child.release();assert.deepEqual(gate.getState(),{busy:false,blocked:false});assert.equal(scoped.tryAcquire(),null);
 const next=gate.tryAcquire();assert.equal(child.release({failed:true}),false);assert.deepEqual(gate.getState(),{busy:true,blocked:false});next.release();
});
test('cancel holds pipeline admission even if execution finishes before shutdown does',async()=>{
 const gate=createWorkerGate(),work=deferred(),shutdown=deferred();let child;
 const op=createInferenceOperation({gate,getCurrent:()=>context,execute:(_,hooks)=>{child=hooks.workerGate.tryAcquire();return work.promise;},cancelOwned:async()=>{child.release();await shutdown.promise;},committer:{commit:()=>assert.fail('cancelled')}});
 const pending=op.start(),stopping=op.cancel();work.resolve({});assert.equal((await pending).status,'cancelled');
 assert.equal(gate.tryAcquire(),null);shutdown.resolve();await stopping;assert.deepEqual(gate.getState(),{busy:false,blocked:false});
});
test('active Worker resources prevent commit; cleanup releases the pipeline',async()=>{
 const gate=createWorkerGate();let child,commits=0;
 const op=createInferenceOperation({gate,getCurrent:()=>context,execute:async(_,hooks)=>{child=hooks.workerGate.tryAcquire();return {};},cancelOwned:async()=>child.release(),committer:{commit:()=>{commits++;}}});
 await assert.rejects(op.start(),e=>e.code==='runtime-error');assert.equal(commits,0);assert.deepEqual(gate.getState(),{busy:false,blocked:false});
});
test('child shutdown failure poisons global admission and survives parent release',()=>{
 const gate=createWorkerGate(),parent=gate.tryAcquire(),child=parent.createChildGate().tryAcquire();child.release({failed:true});assert.equal(gate.getState().blocked,true);
 parent.release();assert.deepEqual(gate.getState(),{busy:false,blocked:true});assert.equal(gate.tryAcquire(),null);
});

test('context read failure after execution disposes ownership and cannot strand the pipeline',async()=>{
 const gate=createWorkerGate();let broken=false,child,stops=0;
 const op=createInferenceOperation({gate,getCurrent:()=>{if(broken)throw Error('private context');return context;},execute:async(_,hooks)=>{child=hooks.workerGate.tryAcquire();broken=true;return {};},cancelOwned:async()=>{stops++;child.release();},committer:{commit:()=>assert.fail('stale context')}});
 assert.deepEqual(await op.start(),{status:'stale'});assert.equal(stops,1);assert.deepEqual(gate.getState(),{busy:false,blocked:false});
});
