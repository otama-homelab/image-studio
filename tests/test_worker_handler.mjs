import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkerHandler} from '../tools/browser-library-adapter/worker-handler.mjs';
const release={model:'hr',modelVersion:'set-1',releaseId:'r1',cacheNamespace:'studio-r1',resources:[{name:'model.onnx',url:'https://assets.invalid/r1/model.onnx',sha256:'a'.repeat(64),bytes:3}]};
const prepare=()=>({type:'prepare',workerId:'worker-1',jobId:'job-1',model:'hr',modelVersion:'set-1',source:{mode:'library-resources',releaseId:'r1',cacheNamespace:'studio-r1',resources:structuredClone(release.resources)}});
const infer=()=>({type:'infer',workerId:'worker-1',jobId:'job-2',key:{inputId:'input-1',inferenceRevision:1,modelVersion:'set-1'},rgb:{width:2,height:1,layout:'rgb-u8-interleaved',data:new ArrayBuffer(6)},refine:false});
function setup(options={}){
 const events=[];let loads=0,runs=0,releases=0;
 const handle=createWorkerHandler({trustedModels:[release],prepare:async()=>{loads++;return {async dispose(){releases++;}};},infer:async()=>{runs++;return {width:2,height:1,layout:'alpha-u8',data:Uint8Array.of(0,255).buffer};},postMessage:(event,transfer)=>events.push({event,transfer}),...options});
 return {handle,events,counts:()=>({loads,runs,releases})};
}
test('prepare/infer/dispose validates and transfers only final alpha',async()=>{
 const f=setup();await f.handle(prepare());await f.handle(infer());
 const result=f.events[1];assert.equal(result.event.type,'result');assert.deepEqual([...new Uint8Array(result.event.alpha.data)],[0,255]);assert.deepEqual(result.transfer,[result.event.alpha.data]);
 await f.handle({workerId:'worker-1',jobId:'job-3',type:'dispose'});
 assert.deepEqual(f.counts(),{loads:1,runs:1,releases:1});assert.equal(f.events[2].event.type,'disposed');
});
test('substituted resources and bad input are rejected before the corresponding operation',async()=>{
 const bad=setup(),request=prepare();request.source.resources[0].url='https://private.invalid/photo';await bad.handle(request);
 assert.equal(bad.counts().loads,0);assert.equal(bad.events[0].event.code,'unsupported-model');
 const f=setup();await f.handle(prepare());const input=infer();input.rgb.data=new ArrayBuffer(1);await f.handle(input);
 assert.equal(f.counts().runs,0);assert.equal(f.events[1].event.code,'invalid-input');
});
test('arbitrary exceptions and malformed output produce only fixed failure events',async()=>{
 for(const operation of [async()=>{throw Error('private photo name');},async()=>({width:2,height:1,layout:'alpha-u8',data:new ArrayBuffer(1)})]){
  const f=setup({infer:operation});await f.handle(prepare());await f.handle(infer());
  assert.equal(f.events[1].event.type,'error');assert.equal(JSON.stringify(f.events).includes('private'),false);
  assert.ok(['runtime-error','invalid-result'].includes(f.events[1].event.code));
 }
});
test('private runtime failure observation preserves the original exception without changing public errors or cleanup',async()=>{
 const cause=Error('private runtime diagnostic'),seen=[];
 const f=setup({infer:async()=>{throw cause;},onRuntimeFailure:(error,context)=>{seen.push({error,context});throw Error('observer failed');}});
 await f.handle(prepare());await f.handle(infer());
 assert.equal(seen.length,1);assert.equal(seen[0].error,cause);assert.deepEqual(seen[0].context,{phase:'infer',model:'hr'});
 assert.equal(f.events.at(-1).event.code,'runtime-error');assert.equal(JSON.stringify(f.events).includes('private'),false);
 await f.handle({type:'cancel',workerId:'worker-1',jobId:'job-2'});
 assert.equal(f.counts().releases,1);assert.equal(f.events.at(-1).event.type,'cancelled');
});
test('concurrent calls never queue another load or inference',async()=>{
 let finish;const waiting=new Promise(r=>{finish=r;});
 const f=setup({prepare:async()=>{await waiting;return {async dispose(){}};}});
 const first=f.handle(prepare());await f.handle(infer());assert.equal(f.events[0].event.code,'runtime-error');
 finish();await first;assert.equal(f.events.some(e=>e.event.type==='prepared'),false);
});

test('matte role requires enabled refinement and same-size HR alpha before invoking inference',async()=>{
 for(const valid of [false,true]){
  const f=setup({trustedModels:[{...release,model:'matte'}]});
  const prep=prepare();prep.model='matte';await f.handle(prep);
  const input=infer();input.refine=true;
  if(valid)input.hrAlpha={width:2,height:1,layout:'alpha-u8',data:new ArrayBuffer(2)};
  await f.handle(input);
  assert.equal(f.counts().runs,valid?1:0);assert.equal(f.events[1].event.type,valid?'result':'error');
 }
});

test('device lost after preparation reports a fixed failure and blocks subsequent inference',async()=>{
 let lost;
 const f=setup({prepare:async(_,hooks)=>{lost=hooks.onDeviceLost;return {async dispose(){}};}});
 await f.handle(prepare());lost();
 assert.equal(f.events[1].event.code,'device-lost');assert.equal(f.events[1].event.jobId,'job-1');
 await f.handle(infer());assert.equal(f.counts().runs,0);
});
test('normal model disposal suppresses the associated device-lost notification',async()=>{
 let lost;
 const f=setup({prepare:async(_,hooks)=>{lost=hooks.onDeviceLost;return {async dispose(){lost();}};}});
 await f.handle(prepare());await f.handle({type:'dispose',workerId:'worker-1',jobId:'job-3'});
 assert.deepEqual(f.events.map(x=>x.event.type),['prepared','disposed']);
});
test('prepare callbacks cannot publish completion before returning a validated model handle',async()=>{
 const f=setup({prepare:async(_,hooks)=>{hooks.emit({type:'prepared',model:'hr',modelVersion:'set-1'});return {async dispose(){}};}});
 await f.handle(prepare());assert.deepEqual(f.events.map(x=>x.event.type),['error']);assert.equal(f.events[0].event.code,'runtime-error');
});

test('inference progress uses the current command envelope and cannot publish unvalidated results',async()=>{
 const f=setup({infer:async(_,__,___,{emit})=>{emit({type:'progress',phase:'hr',elapsedMs:1,completedStages:4,totalStages:46,private:'discard'});return {width:2,height:1,layout:'alpha-u8',data:new ArrayBuffer(2)};}});
 await f.handle(prepare());await f.handle(infer());assert.deepEqual(f.events.map(e=>e.event.type),['prepared','progress','result']);assert.equal(f.events[1].event.jobId,'job-2');assert.equal(f.events[1].event.completedStages,4);assert.equal('private' in f.events[1].event,false);
 const bad=setup({infer:async(_,__,___,{emit})=>emit({type:'result',alpha:{data:new ArrayBuffer(2)}})});await bad.handle(prepare());await bad.handle(infer());assert.deepEqual(bad.events.map(e=>e.event.type),['prepared','error']);
});
test('cancel during inference waits for return and disposal before acknowledgement and hides the old result',async()=>{
 const order=[];let finishRun,finishDispose,signal;
 const f=setup({prepare:async()=>({dispose(){order.push('dispose');return new Promise(resolve=>{finishDispose=resolve;});}}),infer:async(_model,_input,_release,hooks)=>{signal=hooks.signal;await new Promise(resolve=>{finishRun=resolve;});order.push('run-return');return {width:2,height:1,layout:'alpha-u8',data:new ArrayBuffer(2)};}});
 await f.handle(prepare());const running=f.handle(infer());await f.handle({type:'cancel',workerId:'worker-1',jobId:'job-2'});assert.equal(signal.aborted,true);assert.deepEqual(f.events.map(e=>e.event.type),['prepared']);
 finishRun();await Promise.resolve();await Promise.resolve();assert.deepEqual(order,['run-return','dispose']);assert.equal(f.events.length,1);finishDispose();await running;
 assert.deepEqual(f.events.map(e=>e.event.type),['prepared','cancelled']);assert.equal(f.events[1].event.jobId,'job-2');
});
test('cancel during preparation disposes a late handle and never publishes prepared',async()=>{
 let finish,signal;const order=[];const f=setup({prepare:async(_release,hooks)=>{signal=hooks.signal;await new Promise(resolve=>{finish=resolve;});return {async dispose(){order.push('disposed');}};}});
 const pending=f.handle(prepare());await f.handle({type:'cancel',workerId:'worker-1',jobId:'job-1'});assert.equal(signal.aborted,true);assert.equal(f.events.length,0);finish();await pending;
 assert.deepEqual(order,['disposed']);assert.deepEqual(f.events.map(e=>e.event.type),['cancelled']);
});
test('stale cancel cannot abort another active job and disposal failure cannot acknowledge success',async()=>{
 let finish,signal;const f=setup({infer:async(_m,_r,_l,hooks)=>{signal=hooks.signal;await new Promise(resolve=>{finish=resolve;});return {width:2,height:1,layout:'alpha-u8',data:new ArrayBuffer(2)};}});await f.handle(prepare());const pending=f.handle(infer());await f.handle({type:'cancel',workerId:'worker-1',jobId:'old-job'});assert.equal(signal.aborted,false);finish();await pending;assert.equal(f.events.at(-1).event.type,'result');
 const bad=setup({prepare:async()=>({async dispose(){throw Error('private');}})});await bad.handle(prepare());await bad.handle({type:'cancel',workerId:'worker-1',jobId:'cancel-id'});assert.deepEqual(bad.events.map(e=>e.event.type),['prepared','error']);assert.equal(bad.events.at(-1).event.code,'runtime-error');assert.ok(!JSON.stringify(bad.events).includes('private'));
});
test('cancel during model disposal does not dispose twice or acknowledge before cleanup',async()=>{
 let finish;let releases=0;const f=setup({prepare:async()=>({dispose(){releases++;return new Promise(resolve=>{finish=resolve;});}})});await f.handle(prepare());const pending=f.handle({type:'dispose',workerId:'worker-1',jobId:'job-3'});await f.handle({type:'cancel',workerId:'worker-1',jobId:'job-3'});assert.equal(f.events.length,1);finish();await pending;assert.equal(releases,1);assert.deepEqual(f.events.map(e=>e.event.type),['prepared','cancelled']);
});
