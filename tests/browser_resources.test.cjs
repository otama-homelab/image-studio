const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path'),vm=require('node:vm');
const {captureBrowserResources,verifyBrowserPid}=require('../tools/browser_process_resources.cjs');
const {parseArgs}=require('../tools/observe_browser_warm_session.cjs');
test('launch receipt PID must match the connected browser before any model operation',async()=>{
 for(const processes of [[{type:'browser',id:123}],[],[{type:'browser',id:124}],[{type:'browser',id:123},{type:'browser',id:124}]]){
  let detached=0;const browser={newBrowserCDPSession:async()=>({send:async method=>{assert.equal(method,'SystemInfo.getProcessInfo');return {processInfo:processes};},detach:async()=>{detached++;}})};
  if(processes.length===1&&processes[0].id===123)assert.equal(await verifyBrowserPid(browser,123),123);else await assert.rejects(verifyBrowserPid(browser,123),/does not match/);
  assert.equal(detached,1);
 }
});
test('invalid PIDs cannot be interpolated into the existing OS query',async()=>{
 let calls=0;const exec=async()=>{calls++;};for(const pid of [0,-1,NaN,Infinity,2147483648,'123; private-command'])await assert.rejects(captureBrowserResources(pid,'fixture',{exec}),/Invalid browser PID/);assert.equal(calls,0);
});
test('resource records retain bytes and whole-GPU MiB as distinct observations',async()=>{
 const calls=[];const result=await captureBrowserResources(123,'session-create',{exec:async(command,args,options)=>{
  calls.push(command);assert.ok(options.timeout<=15000);
  if(command==='powershell.exe'){assert.equal(args[0],'-NoProfile');assert.match(args.at(-1),/\$ids.Add\(123\)/);assert.match(args.at(-1),/BelowNormal/);return {stdout:JSON.stringify({processCount:3,workingSetSum:2000,privateBytesSum:3000,ignored:'private-sentinel'})};}
  return {stdout:'600, 8192\n100, 4096\n'};
 }});
 assert.deepEqual(calls.sort(),['nvidia-smi','powershell.exe']);assert.deepEqual(result.browserProcessMemory,{processCount:3,workingSetSum:2000,privateBytesSum:3000});assert.deepEqual(result.wholeGpuMiB,[[600,8192],[100,4096]]);assert.equal(result.phase,'session-create');assert.ok(Number.isFinite(result.observationMs));assert.ok(!JSON.stringify(result).includes('private-sentinel'));
});
test('query failure and invalid numeric output stay missing rather than becoming zero memory',async()=>{
 for(const invalid of [true,false]){
  const result=await captureBrowserResources(123,'fixture',{exec:async(command)=>{if(!invalid)throw Error('private-error-details');return {stdout:command==='powershell.exe'?JSON.stringify({processCount:1,workingSetSum:null,privateBytesSum:-1}):'N/A, 8192'};}});
  assert.ok(!('browserProcessMemory' in result));assert.ok(!('wholeGpuMiB' in result));assert.ok(result.browserMemoryObservationError);assert.ok(result.gpuMemoryObservationError);assert.ok(!JSON.stringify(result).includes('private-error-details'));
 }
});
test('one failing backend does not discard the other backend observation',async()=>{
 const result=await captureBrowserResources(123,'fixture',{exec:async(command)=>{if(command==='nvidia-smi')throw Object.assign(Error('private'),{code:'ENOENT'});return {stdout:'{"processCount":2,"workingSetSum":1234,"privateBytesSum":5678}'};}});
 assert.equal(result.browserProcessMemory.privateBytesSum,5678);assert.equal(result.gpuMemoryObservationError,'ENOENT');assert.ok(!('wholeGpuMiB' in result));
});
test('warm observer requires the launch receipt and retains explicit initialization cache mode',()=>{
 assert.deepEqual(parseArgs(['private-output','default','launch.json']),{output:'private-output',mode:'default',stateFile:'launch.json'});
 for(const argv of [[],['out'],['out','default'],['out','disabled','state'],['out','default','state','extra']])assert.throws(()=>parseArgs(argv),/WINDOWS_STATE_JSON/);
});
for(const scenario of ['complete','baseline-failed','pid-mismatch'])test('actual warm observer control flow with fake backends: '+scenario,async()=>{
 const filename=path.resolve(__dirname,'../tools/observe_browser_warm_session.cjs'),source=fs.readFileSync(filename,'utf8'),steps=[],snapshots=[];
 const window={warmSession:{state:'idle',events:[]}};
 const page={url:()=> 'about:blank',on(){},context:()=>({newCDPSession:async()=>({send:async()=>({targetInfo:{targetId:'fixture-target'}}),detach:async()=>{}})}),goto:async()=>{steps.push('goto');},locator:()=>({click:async()=>{steps.push('start');window.warmSession={state:'complete',events:[],ready:{modelSource:'opfs-warm',modelNetworkBytes:0},disposed:{type:'disposed'}};}}),evaluate:async fn=>fn()};
 const browser={contexts:()=>[{pages:()=>[page]}],version:()=> 'fixture',newBrowserCDPSession:async()=>({send:async method=>{assert.equal(method,'Browser.close');steps.push('close');}})};
 const fakeFs={mkdirSync(){},readFileSync:file=>file===filename?source:JSON.stringify({pid:123,gpuDisabled:false}),writeFileSync:(_file,text)=>snapshots.push(JSON.parse(text))};
 const fakeRequire=name=>name==='node:fs'?fakeFs:name==='node:path'?path:name==='node:crypto'?crypto:name==='./browser_process_resources.cjs'?{
  verifyBrowserPid:async()=>{steps.push('verify');if(scenario==='pid-mismatch')throw Error('wrong PID');},
  captureBrowserResources:async(_pid,phase)=>{steps.push(phase);return scenario==='baseline-failed'?{browserMemoryObservationError:'fixture'}:{browserProcessMemory:{processCount:2,workingSetSum:100,privateBytesSum:200}};}
 }:name==='playwright-core'?{chromium:{connectOverCDP:async()=>browser}}:null;
 const context={require:fakeRequire,module:{exports:{}},__filename:filename,process:{env:{PLAN36_DISPOSABLE_BROWSER:'1'},argv:['node',filename,'private-output','default','launch.json']},console:{log(){}},window,URL,setTimeout};
 vm.runInNewContext(source,context);await context.main();const report=snapshots.at(-1);
 if(scenario==='complete'){assert.deepEqual(steps,['verify','goto','before-load','start','after-worker-disposed','close']);assert.equal(report.status,'warm-opfs-session-prepared-and-disposed');assert.equal(report.memorySamples.length,2);}
 else{assert.ok(!steps.includes('start'));assert.equal(report.modelStartRequested,false);assert.equal(steps.includes('close'),scenario==='baseline-failed');assert.equal(report.status,'observer-error-job-not-restarted');}
});
