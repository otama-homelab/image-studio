import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackgroundSession} from '../web/src/background/session.mjs';
import {createWorkerGate} from '../tools/browser-library-adapter/worker-gate.mjs';
import {exportFilename} from '../tools/browser-library-adapter/export-job.mjs';

function setup({defaultRefine=false,withVariants=false,backgroundModel='hr',waitForeground,waitTrimap=false,waitStop,failStop=false,resourceFailure=false,resourceFailureCode='cache-quota-exceeded',stageEvents=false,resourceAliases=false,inferenceFailureCode=null,onChange}={}){
 const gate=createWorkerGate(),events=[];let finishForeground,lastModelEvent,failInference=inferenceFailureCode;
 const session=createBackgroundSession({gate,defaultRefine,modelVariants:withVariants?[{prepareBackground:{type:'prepare',model:'modnet',modelVersion:'light-1',source:{resources:[]}}}]:[],
  prepareBackground:{type:'prepare',model:backgroundModel,modelVersion:'set-1',source:{resources:resourceAliases?[{bytes:8,sha256:"a".repeat(64)},{bytes:8,sha256:"a".repeat(64)}]:[{bytes:8}]}},onChange,
  ...(backgroundModel==='hr'?{prepareMatte:{type:'prepare',model:'matte',modelVersion:'set-1'}}:{}),
  makeTrimap:async alpha=>({...alpha,layout:'trimap-u8',data:Uint8Array.of(0,128,255).buffer}),
  ...(waitTrimap?{createTrimapClient({gate:child}){
   let lease,finish;return {async make(alpha){lease=child.tryAcquire();assert.ok(lease);events.push('trimap');await new Promise(resolve=>{finish=resolve;});return {...alpha,layout:'trimap-u8',data:Uint8Array.of(0,128,255).buffer};},async close(){lease?.release();finish?.();}};
  }}:{}),
  createModelClient({gate:child,onEvent}){
   lastModelEvent=onEvent;
   let lease,role;
   return {async request(command){
    if(command.type==='prepare'){lease=child.tryAcquire();assert.ok(lease);role=command.model;events.push(role);
     if(resourceAliases)onEvent({type:'resource-state',resources:[{bytes:8,sha256:'a'.repeat(64),stored:true,lastError:null}]});
     if(resourceFailure){onEvent({type:'resource-state',resources:[{bytes:8,stored:false,lastError:resourceFailureCode}]});throw Error('private resource detail');}return;}
    if(command.type==='dispose'){lease.release();lease=null;return;}
    assert.equal(command.type,'infer');
    if(failInference){const code=failInference;failInference=null;onEvent({type:'error',code});throw Error('private exception details');}
    if(stageEvents&&role==='hr')for(const completedStages of [0,12,11,typeof stageEvents==='number'?stageEvents:46])onEvent({type:'progress',phase:'hr',completedStages,totalStages:typeof stageEvents==='number'?stageEvents:46});
    return {key:command.key,alpha:{width:3,height:1,layout:'alpha-u8',data:Uint8Array.of(0,128,255).buffer}};
   },async cancel(){if(waitStop)await waitStop;lease?.release({failed:failStop});if(failStop)throw Error('stop');}};
  },
  createForegroundClient({gate:child,rgba}){
   assert.equal(rgba,true);let lease,finish;
   return {async estimate(input){
    lease=child.tryAcquire();assert.ok(lease);events.push('foreground');
    if(waitForeground)await new Promise(resolve=>{finish=resolve;finishForeground=resolve;});
    return {width:input.width,height:input.height,format:'rgba-u8',data:Uint8Array.of(0,0,0,0,40,50,60,128,70,80,90,255).buffer};
   },async close(){lease?.release();finish?.();}};
  },
  createExportClient({gate:shared}){
   assert.equal(shared,gate);
   return {async encode(image,options){
    const lease=shared.tryAcquire();assert.ok(lease);events.push(options.kind);
    try{return {bytes:Uint8Array.of(1),width:image.width,height:image.height,mime:'image/png',filename:exportFilename(options)};}finally{lease.release();}
   },async close(){}};
  },
 });
 const photo=()=>({width:3,height:1,format:'rgb-u8',data:Uint8Array.of(10,20,30,40,50,60,70,80,90).buffer});
 return {session,gate,events,photo,emitModelEvent:value=>lastModelEvent?.(value),finish:()=>finishForeground?.()};
}

test('app session runs HR/refinement/recovery and both PNG modes under shared admission',async()=>{
 const f=setup();assert.deepEqual(f.events,[]);f.session.setPhoto(f.photo());f.session.setRefine(true);
 assert.equal((await f.session.run()).status,'committed');assert.equal(f.session.getState().hasResult,true);
 const transparent={kind:'transparent'},white={kind:'background',backgroundColor:[255,255,255]};
 assert.equal((await f.session.save(transparent)).status,'ready');assert.equal((await f.session.save(white)).status,'ready');
 assert.ok(f.session.getPrepared(transparent));assert.ok(f.session.getPrepared(white));
 assert.equal(f.session.getPrepared({kind:'background',backgroundColor:[0,0,0]}),null);
 assert.deepEqual(f.events,['hr','matte','foreground','transparent','background']);
 f.session.setRefine(false);assert.equal(f.session.getState().hasResult,false);assert.equal(f.session.getPrepared(transparent),null);
 await assert.rejects(f.session.save(transparent));await f.session.close();assert.equal(f.gate.getState().busy,false);
});

test('replacement retains old valid result on invalid input; accepted photo invalidates prepared exports',async()=>{
 const f=setup();f.session.setPhoto(f.photo());await f.session.run();await f.session.save({kind:'transparent'});
 assert.throws(()=>f.session.setPhoto({...f.photo(),data:new ArrayBuffer(1)}));assert.equal(f.session.getState().hasResult,true);
 f.session.setPhoto(f.photo());assert.equal(f.session.getState().hasResult,false);assert.equal(f.session.getPrepared({kind:'transparent'}),null);
 await f.session.close();assert.throws(()=>f.session.setPhoto(f.photo()),/closed/);
});

test('cancel during foreground waits for shutdown, admits no edits, and never commits late result',async()=>{
 const f=setup({waitForeground:true});f.session.setPhoto(f.photo());const running=f.session.run();
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.events,['hr','foreground']);
 assert.throws(()=>f.session.setPhoto(f.photo()),/busy/);
 await f.session.cancel();assert.equal((await running).status,'cancelled');
 assert.equal(f.session.getState().hasResult,false);assert.equal(f.gate.getState().busy,false);
 await f.session.close();
});

test('close during recovery stops ownership and is idempotent',async()=>{
 const f=setup({waitForeground:true});f.session.setPhoto(f.photo());const running=f.session.run();
 await new Promise(resolve=>setImmediate(resolve));const closed=f.session.close();assert.equal(f.session.close(),closed);
 await closed;assert.equal((await running).status,'cancelled');assert.equal(f.session.getState().hasPhoto,false);assert.equal(f.gate.getState().busy,false);
});

test('another editor holding the page gate prevents model work and retains its lease',async()=>{
 const f=setup();f.session.setPhoto(f.photo());const lease=f.gate.tryAcquire();
 await assert.rejects(f.session.run());assert.deepEqual(f.events,[]);assert.equal(f.gate.getState().busy,true);
 lease.release();assert.equal((await f.session.run()).status,'committed');await f.session.close();
});

test('cancel during trimap stops its child Worker and cannot prepare ViTMatte afterward',async()=>{
 const f=setup({waitTrimap:true});f.session.setPhoto(f.photo());f.session.setRefine(true);const running=f.session.run();
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.events,['hr','trimap']);
 await f.session.cancel();assert.equal((await running).status,'cancelled');assert.deepEqual(f.events,['hr','trimap']);
 assert.equal(f.session.getState().hasResult,false);assert.equal(f.gate.getState().busy,false);await f.session.close();
});
test('resource failure reaches UI as fixed quota guidance and loading progress metadata',async()=>{
 const snapshots=[],f=setup({resourceFailure:true,onChange:value=>snapshots.push(value)});f.session.setPhoto(f.photo());
 await assert.rejects(f.session.run());assert.equal(f.session.getState().resourceError,'cache-quota-exceeded');
 const loading=snapshots.find(value=>value.phase==='model-load');assert.equal(loading.modelRole,'hr');assert.deepEqual(loading.resourceProgress,{storedBytes:0,totalBytes:8});
 assert.equal(f.session.getState().phase,'idle');assert.ok(!JSON.stringify(snapshots).includes('private resource detail'));await f.session.close();
});


test('stage progress reaches session state, ignores regression, and repeated content counts every manifest resource',async()=>{
 const states=[],f=setup({stageEvents:true,resourceAliases:true,onChange:s=>states.push(s)});f.session.setPhoto(f.photo());await f.session.run();
 assert.ok(states.some(s=>s.resourceProgress?.storedBytes===16&&s.resourceProgress.totalBytes===16));
 const counts=states.filter(s=>s.phase==='inference'&&s.stageProgress).map(s=>s.stageProgress.completedStages);
 assert.ok(counts.includes(0)&&counts.includes(12)&&counts.includes(46));assert.ok(!counts.includes(11));await f.session.close();
});

for(const role of ['modnet','lite'])test(role+' uses the same app ownership, recovery and PNG export without enabling unvalidated refinement',async()=>{
 const f=setup({backgroundModel:role});f.session.setPhoto(f.photo());assert.throws(()=>f.session.setRefine(true),/refinement-unavailable/);
 assert.equal((await f.session.run()).status,'committed');const options={kind:'transparent'};assert.equal((await f.session.save(options)).status,'ready');assert.ok(f.session.getPrepared(options));assert.deepEqual(f.events,[role,'foreground','transparent']);
 f.session.setPhoto(f.photo());assert.equal(f.session.getPrepared(options),null);await f.session.close();assert.equal(f.gate.getState().busy,false);
});

test('ambiguous model selection and unvalidated MODNet/matte combinations reject before creating resources',()=>{
 const background={model:'modnet',modelVersion:'candidate'};
 for(const options of [{prepareHr:background},{prepareHr:{model:'hr',modelVersion:'hr'},prepareBackground:background},{prepareBackground:background,prepareMatte:{model:'matte',modelVersion:'candidate'}}])assert.throws(()=>createBackgroundSession(options),/invalid-model-set/);
});

test('model switch retains the photo, invalidates old PNG and keys subsequent results to the selected release',async()=>{
 const f=setup({withVariants:true});f.session.setPhoto(f.photo());f.session.setRefine(true);await f.session.run();const png={kind:'transparent'};await f.session.save(png);assert.ok(f.session.getPrepared(png));
 f.session.setModel('light-1');assert.equal(f.session.getState().hasPhoto,true);assert.equal(f.session.getState().hasResult,false);assert.equal(f.session.getState().refine,false);assert.equal(f.session.getState().refineAvailable,false);assert.equal(f.session.getPrepared(png),null);
 assert.throws(()=>f.session.setModel('untrusted'),/unknown-background-model/);assert.equal(f.session.getState().modelId,'light-1');
 assert.equal((await f.session.run()).status,'committed');await f.session.save(png);assert.ok(f.session.getPrepared(png));assert.deepEqual(f.events,['hr','matte','foreground','transparent','modnet','foreground','transparent']);
 f.session.setModel('set-1');assert.equal(f.session.getState().refineAvailable,true);assert.equal(f.session.getPrepared(png),null);await f.session.close();
});
test('model switch during recovery cannot change the active operation',async()=>{
 const f=setup({withVariants:true,waitForeground:true});f.session.setPhoto(f.photo());const pending=f.session.run();while(!f.events.includes('foreground'))await new Promise(resolve=>setImmediate(resolve));
 assert.throws(()=>f.session.setModel('light-1'),/background-session-busy/);assert.equal(f.session.getState().modelId,'set-1');f.finish();await pending;await f.session.close();
});


test('refinement on and off reuse the source mask, while photo and model changes invalidate it',async()=>{
 const f=setup({withVariants:true});f.session.setPhoto(f.photo());await f.session.run();
 assert.equal(f.session.getState().hasBackgroundMask,true);
 f.session.setRefine(true);await f.session.run();
 assert.deepEqual(f.events,['hr','foreground','matte','foreground']);
 f.session.setRefine(false);f.session.setRefine(true);await f.session.run();
 assert.equal(f.events.filter(e=>e==='hr').length,1);assert.equal(f.events.filter(e=>e==='matte').length,2);
 assert.throws(()=>f.session.setPhoto({...f.photo(),data:new ArrayBuffer(1)}));assert.equal(f.session.getState().hasBackgroundMask,true);
 f.session.setPhoto(f.photo());assert.equal(f.session.getState().hasBackgroundMask,false);await f.session.run();
 assert.equal(f.events.filter(e=>e==='hr').length,2);
 f.session.setRefine(false);await f.session.run();assert.equal(f.events.filter(e=>e==='hr').length,2);
 f.session.setModel('light-1');assert.equal(f.session.getState().hasBackgroundMask,false);await f.session.run();
 assert.equal(f.session.getState().hasBackgroundMask,false);
 f.session.setModel('set-1');f.session.setRefine(true);await f.session.run();assert.equal(f.events.filter(e=>e==='hr').length,3);
 await f.session.close();assert.equal(f.session.getState().hasBackgroundMask,false);assert.equal(f.gate.getState().busy,false);
});

test('cancelled refinement cannot commit and retains the source mask without leaking its gate',async()=>{
 const f=setup({waitTrimap:true});f.session.setPhoto(f.photo());await f.session.run();
 f.session.setRefine(true);const pending=f.session.run();
 while(!f.events.includes('trimap'))await new Promise(resolve=>setImmediate(resolve));
 await f.session.cancel();assert.equal((await pending).status,'cancelled');assert.equal(f.session.getState().hasResult,false);
 assert.equal(f.session.getState().hasBackgroundMask,true);assert.equal(f.events.filter(e=>e==='hr').length,1);
 assert.equal(f.gate.getState().busy,false);await f.session.close();assert.equal(f.session.getState().hasBackgroundMask,false);
});


test('length and transport integrity failures reach the UI without being hidden by model failure',async()=>{
 for(const resourceFailureCode of ['bytes-mismatch','bytes-overflow','transport-failed','resource-rate-limited','resource-access-denied']){
  const f=setup({resourceFailure:true,resourceFailureCode});f.session.setPhoto(f.photo());
  await assert.rejects(f.session.run());assert.equal(f.session.getState().resourceError,resourceFailureCode);
  assert.equal(f.session.getState().hasPhoto,true);assert.equal(f.session.getState().hasResult,false);
  assert.equal(f.gate.getState().busy,false);await f.session.close();
 }
});


test('fixed device-loss reason survives failure, clears on retry and ignores retired model events',async()=>{
 for(const code of ['device-lost','private-code-sentinel']){
  const f=setup({inferenceFailureCode:code});f.session.setPhoto(f.photo());await assert.rejects(f.session.run());
  assert.equal(f.session.getState().inferenceError,code==='device-lost'?'device-lost':null);assert.equal(f.session.getState().hasPhoto,true);assert.equal(f.gate.getState().busy,false);
  assert.ok(!JSON.stringify(f.session.getState()).includes('private-code-sentinel'));
  assert.equal((await f.session.run()).status,'committed');assert.equal(f.session.getState().inferenceError,null);
  f.emitModelEvent({type:'error',code:'device-lost'});assert.equal(f.session.getState().inferenceError,null);assert.equal(f.session.getState().hasResult,true);await f.session.close();
 }
});

test('HR default refinement runs matte and resets correctly when switching from lightweight',async()=>{
 const f=setup({defaultRefine:true,withVariants:true});
 assert.equal(f.session.getState().refine,true);f.session.setPhoto(f.photo());
 await f.session.run();assert.ok(f.events.includes('matte'));
 f.session.setRefine(false);f.session.setModel('light-1');
 assert.equal(f.session.getState().refine,false);assert.equal(f.session.getState().hasPhoto,true);
 f.session.setModel('set-1');assert.equal(f.session.getState().refine,true);
 assert.equal(f.session.getState().hasResult,false);await f.session.close();
});

test('lightweight models reject a default refinement requiring an unavailable matte',()=>{
 assert.throws(()=>setup({backgroundModel:'modnet',defaultRefine:true}),/invalid-default-refinement/);
});

test('CPU primary can select an HR variant whose refinement defaults on',async()=>{
 const session=createBackgroundSession({gate:createWorkerGate(),
  prepareBackground:{model:'modnet',modelVersion:'cpu'},
  modelVariants:[{prepareBackground:{model:'hr',modelVersion:'quality'},prepareMatte:{model:'matte',modelVersion:'quality'},defaultRefine:true}],
  makeTrimap:async value=>value});
 assert.equal(session.getState().refine,false);
 session.setPhoto({width:1,height:1,format:'rgb-u8',data:Uint8Array.of(1,2,3).buffer});
 session.setModel('quality');assert.equal(session.getState().refine,true);assert.equal(session.getState().hasPhoto,true);
 session.setRefine(false);session.setModel('cpu');assert.equal(session.getState().refine,false);
 session.setModel('quality');assert.equal(session.getState().refine,true);await session.close();
});

test('CPU-sized stage progress reaches UI state',async()=>{const states=[],f=setup({stageEvents:406,onChange:s=>states.push(s)});f.session.setPhoto(f.photo());await f.session.run();assert.ok(states.some(s=>s.stageProgress?.completedStages===406&&s.stageProgress.totalStages===406));});


for(const failStop of [false,true])test(`close remains unconfirmed until owned shutdown ${failStop?'fails':'succeeds'}, even if execution settles first`,async()=>{
 let release;const waitStop=new Promise(resolve=>{release=resolve;});
 const f=setup({waitForeground:true,waitStop,failStop});f.session.setPhoto(f.photo());
 const running=f.session.run();await new Promise(resolve=>setImmediate(resolve));
 const closing=f.session.close();const outcome=closing.then(()=>({closed:true}),error=>({error}));
 assert.equal(f.session.close(),closing);assert.equal(f.session.getState().closed,true);
 await assert.rejects(f.session.run(),/closed/);assert.throws(()=>f.session.setPhoto(f.photo()),/closed/);
 assert.equal((await running).status,'cancelled');
 assert.equal(f.session.getState().busy,true);assert.equal(f.gate.getState().busy,true);
 assert.equal(f.gate.tryAcquire(),null);assert.equal(f.session.getState().hasResult,false);
 release();const result=await outcome;
 assert.equal(f.session.getState().busy,false);assert.equal(f.session.getState().hasPhoto,false);
 assert.equal(f.session.getState().hasBackgroundMask,false);assert.equal(f.session.getState().hasResult,false);
 assert.equal(f.gate.getState().busy,false);
 if(failStop){assert.match(result.error.message,/background-stop-failed/);assert.equal(f.session.getState().blocked,true);assert.equal(f.gate.tryAcquire(),null);}
 else{assert.equal(result.closed,true);const next=f.gate.tryAcquire();assert.ok(next);next.release();}
});
