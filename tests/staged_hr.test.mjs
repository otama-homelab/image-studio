import test from 'node:test';
import assert from 'node:assert/strict';
import {createStagedHr} from '../tools/browser-library-adapter/staged-hr.mjs';
import {createStageWorkerHandler} from '../tools/browser-library-adapter/stage-worker-handler.mjs';
import {stagePorts,stageFeatures} from '../tools/browser-library-adapter/stage-tensors.mjs';
import {createWorkerGate} from '../tools/browser-library-adapter/worker-gate.mjs';
const port=name=>({name,dtype:'float32',dims:[2]});
const catalog=[{inputs:[port('pixels')],outputs:[port('a'),port('skip')]},{inputs:[port('a')],outputs:[port('b')]},{inputs:[port('a'),port('b'),port('skip')],outputs:[port('alpha')]}];
const input=()=>[{...port('pixels'),data:Float32Array.of(1,2).buffer}];
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture({waitStop=false,stopFails=false,prepareFails=false,releaseFails=false,preparationTiming,resourceTiming,workerLifetime,maxStagesPerWorker}={}){
 const order=[],posted=[],stopping=deferred(),allowStop=deferred(),gate=createWorkerGate();let created=0;
 class Tensor{constructor(type,data,dims){this.type=type;this.data=data;this.dims=dims;}async dispose(){this.data=null;}}
 const createWorker=()=>{
  const index=created++,listeners=new Map();let terminated=false;
  const postMessage=(event,transfer=[])=>{const message=structuredClone(event,{transfer});queueMicrotask(()=>{if(!terminated)listeners.get('message')?.({data:message});});};
  const handle=createStageWorkerHandler({catalog,Tensor,postMessage,maxJobs:workerLifetime==='per-run'?(maxStagesPerWorker??catalog.length):1,async prepareStage(i){
   order.push('prepare:'+i);if(prepareFails&&i===1)throw Error('private payload');
   return {...(resourceTiming?{resourceTiming}:{}),...(preparationTiming?{preparationTiming}:{}),async model(feeds){
    order.push('run:'+i);
    const make=(name,fn)=>new Tensor('float32',Float32Array.from([0,1],fn),[2]);
    return i===0?{a:make('a',j=>feeds.pixels.data[j]*2),skip:make('skip',j=>feeds.pixels.data[j]+1)}:i===1?{b:make('b',j=>feeds.a.data[j]+3)}:{alpha:make('alpha',j=>feeds.a.data[j]+feeds.b.data[j]+feeds.skip.data[j])};
   },async dispose(){order.push('dispose:'+i);if(releaseFails)throw Error('private release');}};
  }});
  return {addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type),
   postMessage(command,transfer){posted.push({stage:command.stageIndex,features:(command.features??[]).map(f=>({name:f.name,data:f.data}))});const copy=structuredClone(command,{transfer});queueMicrotask(()=>{void handle(copy);});},
   async terminate(){order.push('stop:'+index);stopping.resolve();if(waitStop&&index===0)await allowStop.promise;if(stopFails)throw Error('private stop');terminated=true;order.push('stopped:'+index);}};
 };
 const events=[],runner=createStagedHr({catalog,createWorker,gate,onStage:e=>events.push(e),...(workerLifetime?{workerLifetime,maxStagesPerWorker,cancellationProtocol:'cooperative-stage-cancel-v1'}:{})});
 return {runner,order,posted,events,gate,stopping,allowStop,created:()=>created};
}
test('whole pipeline uses existing gate/Worker shutdown and copies only a feature with later consumers',async()=>{
 const f=fixture({waitStop:true}),features=input(),done=f.runner.run(features);
 await f.stopping.promise;assert.equal(f.created(),1);assert.equal(f.gate.getState().busy,true);assert.ok(f.order.indexOf('dispose:0')<f.order.indexOf('stop:0'));
 f.allowStop.resolve();const result=await done;
 assert.deepEqual([...new Float32Array(result[0].data)],[9,14]);assert.equal(features[0].data.byteLength,0);
 assert.equal(f.created(),3);assert.equal(f.gate.getState().busy,false);
 assert.ok(f.order.indexOf('stopped:0')<f.order.indexOf('prepare:1'));
 assert.ok(f.order.indexOf('stopped:1')<f.order.indexOf('prepare:2'));
 const copied=f.posted[1].features.find(x=>x.name==='a').data,original=f.posted[2].features.find(x=>x.name==='a').data;
 assert.notEqual(copied,original);assert.equal(copied.byteLength,0);assert.equal(original.byteLength,0);
 assert.deepEqual(f.events.filter(e=>e.phase==='complete').map(e=>e.index),[0,1,2]);
});
test('cancel while successful Worker is stopping waits and prevents the next stage',async()=>{
 const f=fixture({waitStop:true}),controller=new AbortController(),done=f.runner.run(input(),{signal:controller.signal});
 await f.stopping.promise;controller.abort();assert.equal(f.gate.getState().busy,true);f.allowStop.resolve();
 await assert.rejects(done,e=>e.code==='aborted');assert.equal(f.created(),1);assert.equal(f.gate.getState().busy,false);assert.equal(f.runner.getState().busy,false);
});
for(const [options,code] of [[{prepareFails:true},'stage-prepare-failed'],[{releaseFails:true},'stage-release-failed'],[{stopFails:true},'stage-stop-failed']])test('failure never publishes later stages or private text: '+code,async()=>{
 const f=fixture(options);await assert.rejects(f.runner.run(input()),e=>e.code===code&&!e.message.includes('private'));
 assert.ok(f.created()<3);assert.equal(f.runner.getState().busy,false);assert.equal(f.gate.getState().blocked,!!options.stopFails);
 if(options.stopFails)await assert.rejects(f.runner.run(input()),e=>e.code==='stage-unavailable');
});
test('gate conflict preserves input; malformed catalog is refused before creating a Worker',async()=>{
 const f=fixture(),lease=f.gate.tryAcquire(),features=input();await assert.rejects(f.runner.run(features),e=>e.code==='stage-busy');assert.equal(features[0].data.byteLength,8);assert.equal(f.created(),0);lease.release();
 const invalid=structuredClone(catalog);invalid[1].inputs[0].dims=[3];assert.throws(()=>createStagedHr({catalog:invalid,createWorker:()=>{throw Error();}}),/stage-input-not-produced/);
});
test('feature protocol rejects nonfinite FP16/FP32, aliases and oversized shapes',()=>{
 for(const [dtype,data] of [['float16',Uint16Array.of(0x7c00,0x3c00).buffer],['float32',Float32Array.of(NaN,1).buffer]]){
  const ports=stagePorts([{name:'x',dtype,dims:[2]}]);assert.throws(()=>stageFeatures([{name:'x',dtype,dims:[2],data}],ports,{finite:true}),/nonfinite/);
 }
 const data=Float32Array.of(1,2).buffer;assert.throws(()=>stageFeatures([{...port('x'),data},{...port('y'),data}],stagePorts([port('x'),port('y')])));
 assert.throws(()=>stagePorts([{name:'x',dtype:'float32',dims:[1024**3]}]));
});
test('malformed stage request never prepares a model',async()=>{
 let prepares=0;const events=[],handle=createStageWorkerHandler({catalog,Tensor:class{},prepareStage(){prepares++;},postMessage:e=>events.push(e)});
 await handle({type:'run-stage',jobId:'bad',stageIndex:0,features:[]});assert.equal(prepares,0);assert.equal(events[0].type,'error');assert.equal(events[0].code,'stage-input-failed');
});
test('complete independent CPU output is transferred without a second allocation and remains valid after dispose',async()=>{
 const source=Float32Array.of(3,4);let event,disposed=0;
 class Tensor{constructor(type,data,dims){this.type=type;this.data=data;this.dims=dims;}dispose(){disposed++;this.data=null;}}
 const handle=createStageWorkerHandler({catalog:[{inputs:[port('pixels')],outputs:[port('alpha')]}],Tensor,
  prepareStage:async()=>({model:async()=>({alpha:new Tensor('float32',source,[2])}),dispose:async()=>{}}),postMessage:e=>{event=e;}});
 const command={type:'run-stage',jobId:'one',stageIndex:0,features:input()};await handle(command);
 assert.equal(event.type,'stage-result');assert.equal(event.features[0].data,source.buffer);assert.deepEqual([...new Float32Array(event.features[0].data)],[3,4]);assert.equal(disposed,2);assert.equal(command.features.length,0);
});

test('stage cancel waits real model return and deferred disposal, suppressing result and stale cancel',async()=>{
 const entered=deferred(),inferred=deferred(),releasing=deferred(),released=deferred(),events=[];let disposed=0,signal;
 class Tensor{constructor(type,data,dims){Object.assign(this,{type,data,dims});}dispose(){this.data=null;}}
 const handler=createStageWorkerHandler({catalog:[{inputs:[port('pixels')],outputs:[port('alpha')]}],Tensor,postMessage:e=>events.push(e),
  prepareStage:async(_index,hooks)=>{signal=hooks.signal;return {async model(){entered.resolve();await inferred.promise;return {alpha:new Tensor('float32',Float32Array.of(1,2),[2])};},async dispose(){disposed++;releasing.resolve();await released.promise;}};}});
 const done=handler({type:'run-stage',jobId:'one',stageIndex:0,features:input()});await entered.promise;
 await handler({type:'cancel-stage',jobId:'stale'});assert.equal(signal.aborted,false);
 await handler({type:'cancel-stage',jobId:'one'});assert.equal(signal.aborted,true);assert.deepEqual(events,[]);assert.equal(disposed,0);
 inferred.resolve();await releasing.promise;assert.deepEqual(events,[]);released.resolve();await done;
 assert.deepEqual(events,[{type:'stage-cancelled',jobId:'one'}]);assert.equal(disposed,1);
});
test('cancel during stage preparation disposes the late owner and does not start inference',async()=>{
 const entered=deferred(),ready=deferred(),events=[];let ran=0,disposed=0;
 const handler=createStageWorkerHandler({catalog:[{inputs:[port('pixels')],outputs:[port('alpha')]}],Tensor:class{},postMessage:e=>events.push(e),prepareStage:async()=>{entered.resolve();await ready.promise;return {model(){ran++;},dispose(){disposed++;}};}});
 const done=handler({type:'run-stage',jobId:'prepare',stageIndex:0,features:input()});await entered.promise;await handler({type:'cancel-stage',jobId:'prepare'});assert.deepEqual(events,[]);ready.resolve();await done;
 assert.equal(ran,0);assert.equal(disposed,1);assert.deepEqual(events,[{type:'stage-cancelled',jobId:'prepare'}]);
});
test('stage cancellation never acknowledges successful cleanup when disposal fails',async()=>{
 const entered=deferred(),ready=deferred(),events=[];
 const handler=createStageWorkerHandler({catalog:[{inputs:[port('pixels')],outputs:[port('alpha')]}],Tensor:class{},postMessage:e=>events.push(e),prepareStage:async()=>{entered.resolve();await ready.promise;return {dispose(){throw Error('private');}};}});
 const done=handler({type:'run-stage',jobId:'failed',stageIndex:0,features:input()});await entered.promise;await handler({type:'cancel-stage',jobId:'failed'});ready.resolve();await done;
 assert.deepEqual(events,[{type:'error',jobId:'failed',code:'stage-release-failed'}]);await handler({type:'cancel-stage',jobId:'failed'});assert.equal(events.at(-1).type,'error');
});
test('cancel arriving during normal stage disposal emits ACK after one disposal, never a result',async()=>{
 const releasing=deferred(),released=deferred(),events=[];let disposed=0;
 class Tensor{constructor(type,data,dims){Object.assign(this,{type,data,dims});}dispose(){this.data=null;}}
 const handler=createStageWorkerHandler({catalog:[{inputs:[port('pixels')],outputs:[port('alpha')]}],Tensor,postMessage:e=>events.push(e),prepareStage:async()=>({model:async()=>({alpha:new Tensor('float32',Float32Array.of(1,2),[2])}),async dispose(){disposed++;releasing.resolve();await released.promise;}})});
 const done=handler({type:'run-stage',jobId:'release',stageIndex:0,features:input()});await releasing.promise;await handler({type:'cancel-stage',jobId:'release'});assert.deepEqual(events,[]);released.resolve();await done;assert.equal(disposed,1);assert.deepEqual(events,[{type:'stage-cancelled',jobId:'release'}]);
});
test('cooperative runner cancellation holds outer gate through child return/disposal and prevents later stages',async()=>{
 const entered=deferred(),returned=deferred(),releaseEntered=deferred(),released=deferred(),gate=createWorkerGate(),order=[];let created=0;
 class Tensor{constructor(type,data,dims){Object.assign(this,{type,data,dims});}dispose(){this.data=null;}}
 const runner=createStagedHr({catalog,gate,cancellationProtocol:'cooperative-stage-cancel-v1',createWorker(){created++;const listeners=new Map();let dead=false;
  const handle=createStageWorkerHandler({catalog,Tensor,postMessage:event=>{queueMicrotask(()=>{if(!dead)listeners.get('message')?.({data:event});});},prepareStage:async()=>({async model(){entered.resolve();await returned.promise;order.push('return');return {a:new Tensor('float32',Float32Array.of(1,2),[2]),skip:new Tensor('float32',Float32Array.of(1,2),[2])};},async dispose(){releaseEntered.resolve();await released.promise;order.push('dispose');}})});
  return {addEventListener:(t,f)=>listeners.set(t,f),removeEventListener:t=>listeners.delete(t),postMessage:c=>{queueMicrotask(()=>void handle(c));},terminate(){dead=true;order.push('terminate');}};
 }});
 const controller=new AbortController(),done=runner.run(input(),{signal:controller.signal});const rejected=assert.rejects(done,e=>e.code==='aborted');await entered.promise;controller.abort();await Promise.resolve();assert.equal(gate.getState().busy,true);assert.equal(created,1);returned.resolve();await releaseEntered.promise;assert.equal(gate.getState().busy,true);assert.deepEqual(order,['return']);released.resolve();await rejected;assert.deepEqual(order,['return','dispose','terminate']);assert.equal(created,1);assert.equal(gate.getState().busy,false);assert.equal(gate.getState().blocked,false);await runner.close();
});

test('parent round trip includes Worker termination wait while worker timings exclude it',async t=>{
 let clock=100;t.mock.method(performance,'now',()=>clock);
 const f=fixture({waitStop:true}),done=f.runner.run(input());await f.stopping.promise;
 clock=600;f.allowStop.resolve();await done;
 const timing=f.events.find(event=>event.phase==='complete'&&event.index===0).timing;
 assert.equal(timing.roundTripMs,500);assert.equal(timing.feedPreparationMs,0);
 assert.equal(timing.prepareMs+timing.inferMs+timing.exportMs+timing.releaseMs,0);
 assert.ok(Object.isFrozen(timing));assert.equal(f.created(),3);assert.equal(f.gate.getState().busy,false);
});

test('stage preparation detail survives Worker transfer and parent timing sanitization',async()=>{
 const f=fixture({preparationTiming:{runtimeConfigureMs:3,modelLoadMs:17,private:'sentinel'}});await f.runner.run(input());
 const completed=f.events.filter(e=>e.phase==='complete');assert.equal(completed.length,3);
 for(const event of completed){assert.equal(event.timing.runtimeConfigureMs,3);assert.equal(event.timing.modelLoadMs,17);assert.ok(!JSON.stringify(event.timing).includes('sentinel'));}
});

test('resource timing crosses Worker and parent with only bounded counters',async()=>{
 const f=fixture({resourceTiming:{readWaitSumMs:7,hashWorkSumMs:11,verifiedBytes:64,verifiedStreams:2,url:'private-sentinel'}});await f.runner.run(input());
 for(const event of f.events.filter(e=>e.phase==='complete')){assert.equal(event.timing.resourceReadWaitSumMs,7);assert.equal(event.timing.resourceHashWorkSumMs,11);assert.equal(event.timing.resourceVerifiedBytes,64);assert.equal(event.timing.resourceVerifiedStreams,2);assert.ok(!JSON.stringify(event.timing).includes('private-sentinel'));}
});

function reusableStageFixture({maxJobs=2,waitRelease=false,failRelease=false,waitRun=false,failRun=false}={}){
 const events=[],entered=deferred(),returned=deferred(),releasing=deferred(),released=deferred();let prepared=0,disposed=0;
 class Tensor{constructor(type,data,dims){Object.assign(this,{type,data,dims});}dispose(){this.data=null;}}
 const handler=createStageWorkerHandler({maxJobs,catalog:[{inputs:[port('pixels')],outputs:[port('alpha')]}],Tensor,postMessage:event=>events.push(event),async prepareStage(){const index=prepared++;return {async model(){if(index===0){entered.resolve();if(waitRun)await returned.promise;if(failRun)throw Error('private backend');}return {alpha:new Tensor('float32',Float32Array.of(1,2),[2])};},async dispose(){disposed++;if(index===0){releasing.resolve();if(waitRelease)await released.promise;if(failRelease)throw Error('private cleanup');}}};}});
 return {handler,events,entered,returned,releasing,released,prepared:()=>prepared,disposed:()=>disposed,run:jobId=>handler({type:'run-stage',jobId,stageIndex:0,features:input()})};
}
test('bounded stage reuse rejects overlap until owner disposal and stops at its job limit',async()=>{
 const f=reusableStageFixture({waitRelease:true});const first=f.run('first');await f.releasing.promise;await f.run('second');assert.equal(f.prepared(),1);assert.equal(f.events.at(-1).code,'stage-input-failed');f.released.resolve();await first;await f.run('second');assert.equal(f.prepared(),2);assert.equal(f.disposed(),2);assert.deepEqual(f.events.filter(e=>e.type==='stage-result').map(e=>e.jobId),['first','second']);await f.run('third');assert.equal(f.prepared(),2);assert.equal(f.events.at(-1).code,'stage-input-failed');
});
test('clean cancellation ACK precedes next reusable stage and suppresses the cancelled result',async()=>{
 const f=reusableStageFixture({waitRun:true,waitRelease:true});const first=f.run('cancelled');await f.entered.promise;await f.handler({type:'cancel-stage',jobId:'cancelled'});f.returned.resolve();await f.releasing.promise;assert.deepEqual(f.events,[]);assert.equal(f.disposed(),1);f.released.resolve();await first;assert.deepEqual(f.events,[{type:'stage-cancelled',jobId:'cancelled'}]);await f.run('next');assert.equal(f.events.at(-1).type,'stage-result');assert.equal(f.prepared(),2);assert.equal(f.disposed(),2);
});
for(const [options,code] of [[{failRun:true},'stage-run-failed'],[{failRelease:true},'stage-release-failed']])test('reusable stage Worker refuses another session after '+code,async()=>{
 const f=reusableStageFixture(options);await f.run('failed');assert.equal(f.events.at(-1).code,code);await f.run('next');assert.equal(f.events.at(-1).code,'stage-input-failed');assert.equal(f.prepared(),1);assert.equal(f.disposed(),1);
});
test('default stage lifetime remains one job and reuse rejects duplicate IDs',async()=>{
 const single=reusableStageFixture({maxJobs:1});await single.run('one');await single.run('two');assert.equal(single.prepared(),1);const duplicate=reusableStageFixture();await duplicate.run('same');await duplicate.run('same');assert.equal(duplicate.prepared(),1);assert.equal(duplicate.events.at(-1).code,'stage-input-failed');
});

test('device loss poisons reusable handler even when owner disposal succeeds',async()=>{
 const events=[];let prepared=0,disposed=0,ran=0;
 const handler=createStageWorkerHandler({maxJobs:2,catalog:[{inputs:[port('pixels')],outputs:[port('alpha')]}],Tensor:class{},postMessage:event=>events.push(event),async prepareStage(index,{onDeviceLost}){prepared++;onDeviceLost();return {model(){ran++;},dispose(){disposed++;}};}});
 await handler({type:'run-stage',jobId:'lost',stageIndex:0,features:input()});assert.deepEqual(events,[{type:'error',jobId:'lost',code:'stage-device-lost'}]);assert.equal(disposed,1);await handler({type:'run-stage',jobId:'next',stageIndex:0,features:input()});assert.equal(events.at(-1).code,'stage-input-failed');assert.equal(prepared,1);assert.equal(ran,0);
});

test('per-run parent reuses one Worker and keeps gate until final termination',async()=>{
 const f=fixture({workerLifetime:'per-run',waitStop:true}),done=f.runner.run(input());await f.stopping.promise;assert.equal(f.created(),1);assert.deepEqual(f.order.filter(x=>x.startsWith('dispose:')),['dispose:0','dispose:1','dispose:2']);assert.equal(f.gate.getState().busy,true);assert.equal(f.runner.getState().busy,true);f.allowStop.resolve();const result=await done;assert.deepEqual([...new Float32Array(result[0].data)],[9,14]);assert.equal(f.gate.getState().busy,false);assert.equal(f.created(),1);await f.runner.run(input());assert.equal(f.created(),2);
});
test('per-run parent ends failed Worker without running later stages',async()=>{
 const f=fixture({workerLifetime:'per-run',prepareFails:true});await assert.rejects(f.runner.run(input()),e=>e.code==='stage-prepare-failed');assert.equal(f.created(),1);assert.equal(f.order.includes('prepare:2'),false);assert.equal(f.gate.getState().busy,false);assert.equal(f.order.filter(x=>x.startsWith('stop:')).length,1);
});
test('per-run final termination failure blocks parent and outer gate',async()=>{
 const f=fixture({workerLifetime:'per-run',stopFails:true});await assert.rejects(f.runner.run(input()),e=>e.code==='stage-stop-failed');assert.equal(f.created(),1);assert.equal(f.gate.getState().blocked,true);assert.equal(f.runner.getState().blocked,true);await assert.rejects(f.runner.run(input()),e=>e.code==='stage-unavailable');
});
test('per-run lifetime requires cooperative cancellation and a bounded catalog',()=>{
 assert.throws(()=>createStagedHr({catalog,workerLifetime:'per-run'}),/invalid-stage-worker-lifetime/);assert.throws(()=>createStagedHr({catalog,workerLifetime:'pool'}),/invalid-stage-worker-lifetime/);
});

test('per-run cancellation during final termination suppresses the completed output',async()=>{
 const f=fixture({workerLifetime:'per-run',waitStop:true}),controller=new AbortController(),done=f.runner.run(input(),{signal:controller.signal});const rejected=assert.rejects(done,e=>e.code==='aborted');await f.stopping.promise;controller.abort();assert.equal(f.gate.getState().busy,true);f.allowStop.resolve();await rejected;assert.equal(f.gate.getState().busy,false);assert.equal(f.runner.getState().busy,false);
});

test('bounded parent groups await termination before next Worker and preserve full result',async()=>{
 const f=fixture({workerLifetime:'per-run',maxStagesPerWorker:2,waitStop:true}),done=f.runner.run(input());await f.stopping.promise;assert.equal(f.created(),1);assert.equal(f.order.includes('prepare:2'),false);assert.equal(f.gate.getState().busy,true);f.allowStop.resolve();const result=await done;assert.deepEqual([...new Float32Array(result[0].data)],[9,14]);assert.equal(f.created(),2);assert.ok(f.order.indexOf('stopped:0')<f.order.indexOf('prepare:2'));assert.equal(f.gate.getState().busy,false);
});
test('cancel at group boundary prevents next Worker and keeps gate until stop completes',async()=>{
 const f=fixture({workerLifetime:'per-run',maxStagesPerWorker:2,waitStop:true}),controller=new AbortController(),done=f.runner.run(input(),{signal:controller.signal}),rejected=assert.rejects(done,e=>e.code==='aborted');await f.stopping.promise;controller.abort();assert.equal(f.gate.getState().busy,true);f.allowStop.resolve();await rejected;assert.equal(f.created(),1);assert.equal(f.gate.getState().busy,false);
});
for(const limit of [0,-1,1.5,47])test('invalid explicit Worker stage limit rejected: '+limit,()=>assert.throws(()=>createStagedHr({catalog,createWorker(){},workerLifetime:'per-run',maxStagesPerWorker:limit,cancellationProtocol:'cooperative-stage-cancel-v1'}),/invalid-stage-worker-limit/));

test('CPU-sized catalogs run serially with a fresh worker per stage and remain bounded',async()=>{
 const makeCatalog=count=>Array.from({length:count},(_,i)=>({inputs:[port(i===0?'pixels':'step'+(i-1))],outputs:[port(i===count-1?'alpha':'step'+i)]}));
 const catalog=makeCatalog(406);let created=0,stopped=0;
 const createWorker=()=>{created++;let listener;return {addEventListener(type,fn){if(type==='message')listener=fn;},removeEventListener(){},postMessage(message){const output=catalog[message.stageIndex].outputs[0],data=Float32Array.from(new Float32Array(message.features[0].data),x=>x+1).buffer;queueMicrotask(()=>listener({data:{type:'stage-result',jobId:message.jobId,stageIndex:message.stageIndex,features:[{...output,data}]}}));},async terminate(){stopped++;}};};
 const runner=createStagedHr({catalog,createWorker}),result=await runner.run(input());
 assert.deepEqual([...new Float32Array(result[0].data)],[407,408]);assert.equal(created,406);assert.equal(stopped,406);await runner.close();
 assert.throws(()=>createStagedHr({catalog:makeCatalog(1025),createWorker}),/invalid-stage-catalog/);
 assert.throws(()=>createStagedHr({catalog,createWorker,workerLifetime:'per-run'}),/invalid-stage-worker-lifetime/);
 created=0;stopped=0;const retained=createStagedHr({catalog,createWorker,workerLifetime:'per-run',maxStagesPerWorker:406,cancellationProtocol:'cooperative-stage-cancel-v1'});const retainedResult=await retained.run(input());assert.deepEqual([...new Float32Array(retainedResult[0].data)],[407,408]);assert.equal(created,1);assert.equal(stopped,1);await retained.close();
});

test('CPU Worker reuse remains bounded across a complete large catalog',async()=>{const f=reusableStageFixture({maxJobs:406});for(let i=0;i<406;i++)await f.run('job-'+i);assert.equal(f.prepared(),406);await f.run('too-many');assert.equal(f.prepared(),406);assert.equal(f.events.at(-1).code,'stage-input-failed');assert.throws(()=>reusableStageFixture({maxJobs:1025}),/invalid-stage-worker-job-limit/);});
