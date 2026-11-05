const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {BUDGET,HR_VALIDATION_BUDGET,STAGED_VALIDATION_BUDGET,budgetReason,admissionReason,cspIssue,refinementMode,allowedResourceRoutes,expectedModelResults}=require('../tools/observe_browser_local_app.cjs');
const {stopTaskBrowser}=require('../tools/browser_process_resources.cjs');
const sample=(memory=100,gpu=100)=>({browserProcessMemory:{processCount:2,workingSetSum:memory,privateBytesSum:memory},wholeGpuMiB:[[gpu,8192]]});
test('memory/GPU growth/observation loss stop rather than allowing an unobserved run',()=>{
 const baseline=sample();assert.equal(budgetReason(baseline,baseline),null);
 assert.equal(budgetReason(sample(BUDGET.privateBytes+1),baseline),'browser-memory-budget-exceeded');
 assert.equal(budgetReason(sample(100,100+BUDGET.gpuGrowthMiB+1),baseline),'whole-gpu-growth-budget-exceeded');
 for(const broken of [{},sample(NaN),{...sample(),wholeGpuMiB:[]},{...sample(),wholeGpuMiB:[[100,4096]]}])assert.equal(budgetReason(broken,baseline),'resource-observation-unavailable');
});
test('HR validation retains system RAM/commit and VRAM reserves, and refuses missing system observation',()=>{
 const healthy={...sample(100,1000),systemMemory:{freePhysicalBytes:4*1024**3,freeVirtualBytes:12*1024**3}};
 assert.equal(budgetReason(healthy,healthy,HR_VALIDATION_BUDGET),null);
 assert.equal(budgetReason(sample(),healthy,HR_VALIDATION_BUDGET),'resource-observation-unavailable');
 assert.equal(budgetReason({...healthy,systemMemory:{...healthy.systemMemory,freePhysicalBytes:2*1024**3}},healthy,HR_VALIDATION_BUDGET),'system-memory-reserve-exceeded');
 assert.equal(budgetReason({...healthy,wholeGpuMiB:[[7400,8192]]},{...healthy,wholeGpuMiB:[[6000,8192]]},HR_VALIDATION_BUDGET),'gpu-memory-reserve-exceeded');
});
test('structured CSP diagnostics retain only enums and never blocked URLs/source samples',()=>{
 const details={isReportOnly:false,violatedDirective:"script-src 'self' https://private-photo-sentinel",contentSecurityPolicyViolationType:'kEvalViolation',blockedURL:'https://private-photo-sentinel',sourceCodeLocation:{url:'https://private-photo-sentinel'}};
 const event=cspIssue({code:'ContentSecurityPolicyIssue',details:{contentSecurityPolicyIssueDetails:details}});
 assert.deepEqual(event,{kind:'js-eval',directive:'script-src',reportOnly:false});assert.ok(!JSON.stringify(event).includes('private-photo'));
 assert.equal(cspIssue({code:'PrivateIssue'}),null);assert.equal(cspIssue({code:'ContentSecurityPolicyIssue',details:{contentSecurityPolicyIssueDetails:{...details,contentSecurityPolicyViolationType:'private-photo-sentinel'}}}),null);
});
test('forced cleanup refuses non-task profiles/PID injection before OS execution',async()=>{
 let called=0;const exec=async()=>{called++;return {stdout:'{"stopped":2}'};};
 for(const profile of ['C:\\Users\\person\\Chrome','C:\\Users\\person\\AppData\\Local\\Temp\\ordinary-profile',"C:\\Users\\person\\AppData\\Local\\Temp\\image-studio-plan36-x'; private"])
  await assert.rejects(stopTaskBrowser(123,profile,{exec}));
 await assert.rejects(stopTaskBrowser('123; private','unused',{exec}));assert.equal(called,0);
 assert.deepEqual(await stopTaskBrowser(123,'C:\\Users\\person\\AppData\\Local\\Temp\\image-studio-plan36-cache-abc',{exec}),{stopped:2});
});
test('private trace bounds metadata and excludes photo pixels, paths and arbitrary exception fields',async()=>{
 const {createLocalValidationTrace}=await import('../web/src/localValidationTrace.mjs');const trace=createLocalValidationTrace();
 trace.onState({hasPhoto:true,busy:false,filename:'private-photo-sentinel'});
 for(let i=0;i<100;i++)trace.onEvent({type:'result',alpha:{data:Uint8Array.of(1,2,3)},filename:'private-photo-sentinel'});
 trace.onEvent({type:'error',code:'private-photo-sentinel',message:'private-photo-sentinel'});
 const value=trace.read();assert.equal(value.events.length,64);assert.equal(value.events.at(-1).code,'runtime-error');
 assert.equal(value.state.hasPhoto,true);assert.ok(!JSON.stringify(value).includes('private-photo'));assert.ok(!JSON.stringify(value).includes('alpha'));
});
for(const scenario of ['complete','native-complete','cpu-complete','repeat-complete','repeat-stop','repeat-different','repeat-refine-complete','repeat-refine-stop','repeat-refine-different','refine-complete','memory-stop','csp-stop','csp-during-sample','stream-complete','stream-stop','stream-audit','stream-unavailable','stream-incomplete','baseline-unavailable','pid-mismatch','admission-denied','stage-complete','stage-error'])test('observer actual control flow with fake browser: '+scenario,async()=>{
 const isRefine=scenario==='refine-complete'||scenario.startsWith('repeat-refine-');
 const filename=path.resolve(__dirname,'../tools/observe_browser_local_app.cjs'),source=fs.readFileSync(filename,'utf8'),steps=[],snapshots=[];
 const state={pid:123,profile:'C:\\Users\\person\\AppData\\Local\\Temp\\image-studio-plan36-abc',gpuDisabled:false};
 const rawAlpha=scenario.startsWith('stage-')?Buffer.alloc(16777216):null;
 const manifest={...(isRefine?{backgroundModel:'hr',runtimeConfig:{prepareHr:{model:'hr',modelVersion:'same'},prepareMatte:{model:'matte',modelVersion:'same',source:{resources:[{url:'http://127.0.0.1:17861/models/fixed/matte/onnx/model.onnx'}]}},workers:{trimap:'https://fixture.invalid/trimap.js'}}}:{}),...(scenario==='cpu-complete'?{backgroundModel:'modnet',runtimeConfig:{executionProvider:'wasm'}}:{}),...(rawAlpha?{stageCount:46,input:{sha256:'45523c0acb4483c878342e2aa4a3693871f33c1c619ac26495b660bfd3da70e2',bytes:25165824}}:{}),status:'local-app-built-not-started',distributionApproved:false,appOrigin:'http://127.0.0.1:17861',entry:'/local-validation.html',mounts:isRefine?[{route:'/models/fixed/matte/onnx/model.onnx'}]:[]};
 let auditListener,refinementChecked=false,intercept,streamOnSample,photoReplaced=false;
 const locator=name=>({setInputFiles:async()=>{photoReplaced=steps.includes('photo');steps.push('photo');},waitFor:async()=>{},isChecked:async()=>{if(name==='髪や服の輪郭を補正する'&&scenario==='cpu-complete')throw Error('Unavailable refinement control must not be queried');return refinementChecked;},check:async()=>{assert.equal(name,'髪や服の輪郭を補正する');refinementChecked=true;steps.push('refinement-on');},count:async()=>photoReplaced&&name==='透過PNGを保存'?0:name==='髪や服の輪郭を補正する'&&scenario==='cpu-complete'?0:1,click:async()=>{
  if(isRefine&&name==='背景を除去してPNGを作成')await intercept({request:()=>({url:()=>"http://127.0.0.1:17861/models/fixed/matte/onnx/model.onnx",method:()=>"GET"}),continue:async()=>{steps.push('matte-permitted');},abort:async()=>{throw Error('Expected selected matte route');}});
  if(name==='背景を除去してPNGを作成')photoReplaced=false;
  if(name==='写真を置き換える'){steps.push('replace');return;}
  steps.push(name==='取得・検証して処理を始める'?'consent':name==='中止'?'cancel':['PNGを保存','透過PNGを保存','背景付きPNGを保存','alphaを保存'].includes(name)?'download':'start');
  if(scenario==='csp-stop'&&name==='背景を除去してPNGを作成')auditListener({issue:{code:'ContentSecurityPolicyIssue',details:{contentSecurityPolicyIssueDetails:{isReportOnly:false,violatedDirective:'script-src',contentSecurityPolicyViolationType:'kEvalViolation',blockedURL:'private-sentinel'}}}});
 }});
 const panel={getByLabel:locator,getByRole:(_role,options)=>locator(typeof options.name==='string'?options.name:options.name.test('透過PNGを保存')?'透過PNGを保存':'unmatched')};
 const page={url:()=> 'about:blank',on(){},setDefaultTimeout(){},route:async(_pattern,callback)=>{intercept=callback;},goto:async()=>{},locator:()=>panel,waitForFunction:async()=>{},evaluate:async fn=>fn(),waitForEvent:async()=>({saveAs:async()=>{}}),context:()=>({newCDPSession:async()=>({on(_name,listener){auditListener=listener;},send:async()=>{},detach:async()=>{}})})};
 const browser={contexts:()=>[{pages:()=>[page]}],version:()=> 'fixture',newBrowserCDPSession:async()=>({send:async method=>{if(method==='SystemInfo.getProcessInfo')return {processInfo:[{type:'browser',id:456}]};steps.push('close');},detach:async()=>{}})};
 const fakeFs={lstatSync:fs.lstatSync,mkdirSync(){},existsSync:()=>false,readFileSync:file=>file===filename?source:file==='state.json'?JSON.stringify(state):file==='app.json'?JSON.stringify(manifest):file.endsWith('staged-alpha-2048.f32')?rawAlpha:/transparent(?:-[2-5])?\.png$/.test(file)?Buffer.from((scenario==='repeat-different'||scenario==='repeat-refine-different')&&file.endsWith('transparent-2.png')?'89504e470d0a1a0a01':'89504e470d0a1a0a','hex'):fs.readFileSync(file),writeFileSync:(_file,text)=>snapshots.push(JSON.parse(text))};
 const resources={isTaskProfile:require('../tools/browser_process_resources.cjs').isTaskProfile,verifyBrowserPid:async()=>{steps.push('verify');if(scenario==='pid-mismatch')throw Error();},captureBrowserResources:async(_pid,phase)=>{
  steps.push(phase);if(phase==='after-browser-close')return {...sample(),browserProcessMemory:{processCount:0,workingSetSum:0,privateBytesSum:0}};
  if(scenario==='csp-during-sample'&&phase==='disposed')auditListener({issue:{code:'ContentSecurityPolicyIssue',details:{contentSecurityPolicyIssueDetails:{isReportOnly:false,violatedDirective:'script-src',contentSecurityPolicyViolationType:'kEvalViolation'}}}});
  if(scenario==='stream-stop'&&phase==='disposed')streamOnSample(sample(100,100+BUDGET.gpuGrowthMiB+1));
  if((scenario==='repeat-stop'||scenario==='repeat-refine-stop')&&phase==='before-repeat')return sample((isRefine?STAGED_VALIDATION_BUDGET:BUDGET).privateBytes+1);
  if(scenario==='baseline-unavailable')return {};
  if(scenario==='admission-denied')return {...sample(512*1024**2,900),systemMemory:{freePhysicalBytes:7*1024**3,freeVirtualBytes:26*1024**3}};
  if(isRefine)return {...sample(),systemMemory:{freePhysicalBytes:9*1024**3,freeVirtualBytes:26*1024**3}};
  return scenario==='memory-stop'&&phase==='prepared'?sample(BUDGET.privateBytes+1):sample();
 },stopTaskBrowser:async()=>{throw Error('Unexpected forced cleanup');}};
 const stream={startBrowserResourceStream(_pid,options){steps.push('stream-start');streamOnSample=options.onSample;return {ready:async()=>{if(scenario==='stream-unavailable')throw Error('not ready');},close:async()=>{steps.push('stream-close');return {collectorsStopped:true};},snapshot:()=>({droppedSamples:scenario==='stream-incomplete'?1:0,errors:scenario==='stream-incomplete'?{memory:'collector-ended'}:{},samples:[sample(100,['stream-stop','stream-audit'].includes(scenario)?100+BUDGET.gpuGrowthMiB+1:100)]})};}};
 const fakeRequire=name=>name==='node:fs'?fakeFs:name==='./browser_process_resources.cjs'?resources:name==='./browser_resource_stream.cjs'?stream:name==='./browser_download_transport.cjs'?{createTaskDownloads:async()=>({saveFromClick:async(click)=>{await click();},close:async()=>{}})}:name==='playwright-core'?{chromium:{connectOverCDP:async()=>browser,launchPersistentContext:async()=>({browser:()=>browser,close:async()=>{steps.push('close');}})}}:require(name);
 const context={require:fakeRequire,module:{exports:{}},__dirname:path.dirname(filename),__filename:filename,URL,Date,setTimeout,clearTimeout,
  navigator:{gpu:{requestAdapter:async()=>{if(scenario==='cpu-complete')throw Error('CPU observer must not request adapter');return {limits:{maxStorageBuffersPerShaderStage:16,maxBufferSize:2147483648,maxStorageBufferBindingSize:2147483644,private:'private-sentinel'}};}}},
  process:{platform:scenario==='native-complete'||scenario.startsWith('stream-')?'win32':'linux',env:{PLAN36_DISPOSABLE_BROWSER:'1',...(scenario.startsWith('repeat-')?{PLAN36_RUN_COUNT:'3'}:{}),...(scenario.startsWith('stream-')?{PLAN36_CONTINUOUS_RESOURCES:'1'}:{}),...(isRefine?{PLAN36_REFINE:'1',PLAN36_RESOURCE_PROFILE:'stage-validation'}:{}),...(scenario==='native-complete'?{PLAN36_NATIVE_LAUNCH:'1'}:{}),...(scenario==='admission-denied'?{PLAN36_RESOURCE_PROFILE:'hr-validation'}:{})},argv:['node',filename,'private-output','state.json','app.json']},console:{log(){}},window:{__imageStudioStages:()=>({state:scenario==='stage-complete'?'complete':'error',errorCode:'stage-prepare-failed',stageCount:46,runner:{busy:false},gate:{busy:false},events:Array.from({length:46},(_,index)=>({phase:'complete',index})),result:{bytes:16777216,sha256:rawAlpha?require('node:crypto').createHash('sha256').update(rawAlpha).digest('hex'):null}}),__imageStudioValidation:()=>['complete','native-complete','cpu-complete','repeat-complete','repeat-stop','repeat-different','refine-complete','csp-during-sample'].includes(scenario)||isRefine||scenario.startsWith('stream-')?{state:{busy:false},gate:{busy:false},events:isRefine?Array.from({length:scenario.startsWith('repeat-')?steps.filter(x=>x==='consent').length:1},()=>[{type:'result',role:'hr'},{type:'disposed',role:'hr'},{type:'result',role:'matte'},{type:'disposed',role:'matte'}]).flat():Array.from({length:scenario.startsWith('repeat-')?steps.filter(x=>x==='consent').length:1},()=>[{type:'result',role:scenario==='cpu-complete'?'modnet':'hr'},{type:'disposed',role:scenario==='cpu-complete'?'modnet':'hr'}]).flat()}:{state:{busy:true},gate:{busy:true},events:[{type:'prepared',role:'hr'}]}}};
 vm.runInNewContext(source,context);await context.main();const report=snapshots.at(-1);
 assert.equal(steps.includes('close'),scenario!=='pid-mismatch');
 if(scenario.startsWith('stream-')){assert.ok(steps.indexOf('stream-close')<steps.indexOf('close'));assert.equal(report.collectorShutdown.collectorsStopped,true);}
 if(['complete','native-complete','cpu-complete','refine-complete','stream-complete'].includes(scenario)){if(scenario==='native-complete')assert.equal(report.nativeLaunch,true);assert.equal(report.status,isRefine?'one-hr-refine-ui-operation-and-download-complete':scenario==='cpu-complete'?'one-modnet-ui-operation-and-download-complete':'one-hr-ui-operation-and-download-complete');if(isRefine){assert.equal(report.refine,true);assert.deepEqual(report.budget,STAGED_VALIDATION_BUDGET);assert.equal(steps.filter(step=>step==='refinement-on').length,1);assert.equal(steps.filter(step=>step==='matte-permitted').length,1);}assert.equal(report.modelStarts,1);if(scenario==='cpu-complete'){assert.equal(report.adapterLimits,null);assert.equal(report.gpuAdapterNotRequested,true);}else assert.equal(report.adapterLimits.maxStorageBuffersPerShaderStage,16);assert.ok(!JSON.stringify(report).includes('private-sentinel'));assert.equal(steps.filter(step=>step==='start').length,1);assert.ok(steps.includes('download'));assert.ok(steps.includes('consent'));assert.equal(report.browserExitVerified,true);assert.deepEqual(report.httpCacheObservation,{eligible:false,reason:'playwright-routing-disables-http-cache'});}
 else if(scenario==='repeat-complete'||scenario==='repeat-refine-complete'){assert.equal(report.status,isRefine?'one-hr-refine-ui-operation-and-download-complete':'one-hr-ui-operation-and-download-complete');if(isRefine){assert.equal(steps.filter(x=>x==='photo').length,3);assert.equal(steps.filter(x=>x==='replace').length,2);}assert.equal(report.modelStarts,3);assert.equal(report.completedRuns.length,3);assert.equal(steps.filter(x=>x==='download').length,3);assert.equal(report.browserExitVerified,true);}
 else if(scenario==='repeat-stop'||scenario==='repeat-refine-stop'){assert.equal(report.modelStarts,1);assert.equal(report.stopReason,'browser-memory-budget-exceeded');assert.equal(report.completedRuns.length,1);assert.equal(steps.filter(x=>x==='download').length,1);}
 else if(scenario==='repeat-different'||scenario==='repeat-refine-different'){assert.equal(report.modelStarts,2);assert.equal(report.stopReason,'observer-error-no-restart');assert.equal(report.completedRuns.length,2);assert.equal(steps.filter(x=>x==='download').length,2);}
 else if(scenario==='stage-complete'){assert.equal(report.status,'one-staged-hr-operation-and-download-complete');assert.equal(report.modelStarts,1);assert.equal(report.download.bytes,16777216);assert.equal(report.browserExitVerified,true);assert.ok(!steps.includes('photo'));}
 else if(scenario==='stage-error'){assert.equal(report.stopReason,'staged-operation-failed');assert.equal(report.stageErrorCode,'stage-prepare-failed');assert.equal(report.modelStarts,1);assert.equal(report.browserExitVerified,true);}
 else if(scenario==='memory-stop'){assert.equal(report.modelStarts,1);assert.equal(report.stopReason,'browser-memory-budget-exceeded');assert.ok(steps.indexOf('cancel')<steps.indexOf('close'));assert.equal(report.browserExitVerified,true);}
 else if(['csp-stop','csp-during-sample'].includes(scenario)){assert.equal(report.modelStarts,1);assert.equal(report.stopReason,'csp-execution-blocked');assert.equal(report.cspIssues[0].kind,'js-eval');assert.ok(steps.includes('cancel'));assert.equal(report.browserExitVerified,true);assert.ok(!JSON.stringify(report).includes('private-sentinel'));}
 else if(['stream-stop','stream-audit'].includes(scenario)){assert.equal(report.status,'stopped-without-retry');assert.equal(report.stopReason,'whole-gpu-growth-budget-exceeded');assert.equal(report.browserExitVerified,true);if(scenario==='stream-stop')assert.ok(!steps.includes('download'));}
 else if(scenario==='stream-incomplete'){assert.equal(report.status,'stopped-without-retry');assert.equal(report.stopReason,'resource-observation-unavailable');}
 else{assert.equal(report.modelStarts,0);assert.ok(!steps.includes('start'));if(scenario==='admission-denied'){assert.equal(report.stopReason,'insufficient-system-headroom-before-start');assert.ok(!steps.includes('photo'));assert.equal(report.browserExitVerified,true);}}
});

test('admission reserves configured RAM/commit and GPU growth before model work',()=>{
 const ready={...sample(512*1024**2,900),systemMemory:{freePhysicalBytes:9*1024**3,freeVirtualBytes:26*1024**3}};
 assert.equal(admissionReason(ready,HR_VALIDATION_BUDGET),null);
 assert.equal(admissionReason({...ready,systemMemory:{...ready.systemMemory,freePhysicalBytes:7*1024**3}},HR_VALIDATION_BUDGET),'insufficient-system-headroom-before-start');
 assert.equal(admissionReason({...ready,systemMemory:{...ready.systemMemory,freeVirtualBytes:20*1024**3}},HR_VALIDATION_BUDGET),'insufficient-system-headroom-before-start');
 assert.equal(admissionReason({...ready,wholeGpuMiB:[[1200,8192]]},HR_VALIDATION_BUDGET),'insufficient-gpu-headroom-before-start');
});

test('staged profile retains HR working-set ceiling and stricter commit/GPU growth stops',()=>{
 const ready={...sample(512*1024**2,1536),systemMemory:{freePhysicalBytes:8*1024**3,freeVirtualBytes:24*1024**3}};
 assert.equal(admissionReason(ready,STAGED_VALIDATION_BUDGET),null);
 assert.equal(STAGED_VALIDATION_BUDGET.workingSetBytes,HR_VALIDATION_BUDGET.workingSetBytes);
 for(const key of ['privateBytes','gpuGrowthMiB'])assert.ok(STAGED_VALIDATION_BUDGET[key]<HR_VALIDATION_BUDGET[key]);
 assert.equal(budgetReason({...ready,browserProcessMemory:{...ready.browserProcessMemory,workingSetSum:STAGED_VALIDATION_BUDGET.workingSetBytes+1}},ready,STAGED_VALIDATION_BUDGET),'browser-memory-budget-exceeded');
});

test('bounded private trace preserves all stage timing totals after the event ring rotates',async()=>{
 const {createLocalValidationTrace}=await import('../web/src/localValidationTrace.mjs'),trace=createLocalValidationTrace();trace.onEvent({type:'prepared',model:'hr'});
 for(let completedStages=1;completedStages<=46;completedStages++){
  trace.onEvent({type:'progress',phase:'hr',completedStages,totalStages:46});
  trace.onEvent({type:'progress',phase:'hr',completedStages,totalStages:46,stageTiming:{prepareMs:2,inferMs:3,exportMs:1,releaseMs:0,private:'discard'}});
 }
 assert.equal(trace.read().events.length,64);assert.deepEqual(trace.read().stageTimingSummary,{completedStages:46,prepareMs:92,inferMs:138,exportMs:46,releaseMs:0});assert.ok(!JSON.stringify(trace.read()).includes('private'));
 const details=trace.read().stageTimings;assert.equal(details.length,46);assert.deepEqual(details[0],{completedStages:1,prepareMs:2,inferMs:3,exportMs:1,releaseMs:0});assert.equal(details.at(-1).completedStages,46);assert.ok(Object.isFrozen(details)&&details.every(Object.isFrozen));
 trace.onEvent({type:'progress',phase:'hr',completedStages:1,totalStages:46,stageTiming:{prepareMs:7,inferMs:3,exportMs:1,releaseMs:0}});assert.equal(trace.read().stageTimings.length,46);assert.equal(trace.read().stageTimings[0].prepareMs,7);assert.equal(details[0].prepareMs,2);
 trace.onEvent({type:'prepared',model:'hr'});assert.equal(trace.read().stageTimingSummary.completedStages,0);assert.deepEqual(trace.read().stageTimings,[]);
});

test('private timing summary retains total HR elapsed time and resets for the next run',async()=>{
 const {createLocalValidationTrace}=await import('../web/src/localValidationTrace.mjs'),trace=createLocalValidationTrace();trace.onEvent({type:'prepared',model:'hr'});
 trace.onEvent({type:'progress',phase:'hr',completedStages:46,totalStages:46,elapsedMs:123000,stageTiming:{prepareMs:1,inferMs:2,exportMs:0,releaseMs:0}});
 assert.equal(trace.read().stageTimingSummary.elapsedMs,123000);trace.onEvent({type:'prepared',model:'hr'});assert.equal(trace.read().stageTimingSummary.elapsedMs,undefined);
});

test('private per-stage timing rejects nonfinite or out-of-range indices and remains bounded',async()=>{
 const {createLocalValidationTrace}=await import('../web/src/localValidationTrace.mjs'),trace=createLocalValidationTrace();trace.onEvent({type:'prepared',model:'hr'});
 const timing={prepareMs:1,inferMs:2,exportMs:0,releaseMs:0};
 for(const completedStages of [-1,257,Infinity])trace.onEvent({type:'progress',phase:'hr',completedStages,totalStages:256,stageTiming:timing});
 trace.onEvent({type:'progress',phase:'hr',completedStages:1,totalStages:256,stageTiming:{...timing,inferMs:NaN}});assert.deepEqual(trace.read().stageTimings,[]);
 for(let completedStages=256;completedStages>0;completedStages--)trace.onEvent({type:'progress',phase:'hr',completedStages,totalStages:256,stageTiming:timing});
 const rows=trace.read().stageTimings;assert.equal(rows.length,256);assert.equal(rows[0].completedStages,1);assert.equal(rows.at(-1).completedStages,256);assert.equal(trace.read().events.length,64);
});

test('refinement is explicit and requires matching HR/matte/trimap and the existing staged budget profile',()=>{
 const config={backgroundModel:'hr',runtimeConfig:{prepareHr:{model:'hr',modelVersion:'same'},prepareMatte:{model:'matte',modelVersion:'same'},workers:{trimap:'https://fixture.invalid/trimap.js'}}};
 assert.equal(refinementMode(undefined,{},undefined),false);assert.equal(refinementMode('0',{},undefined),false);assert.equal(refinementMode('1',config,'stage-validation'),true);
 assert.throws(()=>refinementMode('yes',config,'stage-validation'),/Unknown refinement/);assert.throws(()=>refinementMode('1',config,'hr-validation'),/resource profile/);
 for(const mutate of [c=>{c.backgroundModel='lite';},c=>{c.stageCount=46;},c=>{delete c.runtimeConfig.prepareMatte;},c=>{c.runtimeConfig.prepareMatte.modelVersion='other';},c=>{delete c.runtimeConfig.workers.trimap;}]){const value=structuredClone(config);mutate(value);assert.throws(()=>refinementMode('1',value,'stage-validation'),/matching HR matte trimap/);}
});
test('refinement result acceptance requires exactly HR then matte, rejecting missing, duplicate and reordered results',()=>{
 const results=roles=>roles.map(role=>({type:'result',role}));
 assert.equal(expectedModelResults(results(['hr','matte']),'hr',true),true);assert.equal(expectedModelResults(results(['hr']),'hr',false),true);
 for(const roles of [['hr'],['matte'],['matte','hr'],['hr','hr','matte'],['hr','matte','matte'],['hr','unknown']])assert.equal(expectedModelResults(results(roles),'hr',true),false);
 assert.equal(expectedModelResults(results(['hr','matte']),'hr',false),false);
});

test('refinement network scope permits only selected matte resources and base-only runs still exclude matte',()=>{
 const origin='http://127.0.0.1:17861',matte='/models/fixed/matte/onnx/model.onnx',other='/models/other/matte/onnx/model.onnx';
 const manifest={runtimeConfig:{prepareMatte:{source:{resources:[{url:origin+matte}]}}},mounts:[{route:'/assets/app.js'},{route:'/models/fixed/hr/config.json'},{route:matte},{route:other}]};
 assert.deepEqual([...allowedResourceRoutes(manifest,false)],['/assets/app.js','/models/fixed/hr/config.json','/']);
 assert.deepEqual([...allowedResourceRoutes(manifest,true)],['/assets/app.js','/models/fixed/hr/config.json',matte,'/']);
});

test('trace keeps parent wall times separate and reports partial timing coverage without retaining payloads',async()=>{
 const {createLocalValidationTrace}=await import('../web/src/localValidationTrace.mjs');
 const trace=createLocalValidationTrace();trace.onEvent({type:'prepared',model:'hr'});
 const timing={prepareMs:2,inferMs:3,exportMs:1,releaseMs:0};
 trace.onEvent({type:'progress',phase:'hr',completedStages:1,totalStages:2,stageTiming:{...timing,roundTripMs:10,feedPreparationMs:4,filename:'private-sentinel'}});
 trace.onEvent({type:'progress',phase:'hr',completedStages:2,totalStages:2,stageTiming:timing});
 assert.deepEqual(trace.read().stageTimingSummary,{completedStages:2,prepareMs:4,inferMs:6,exportMs:2,releaseMs:0,parentTimedStages:1,roundTripMs:10,feedPreparationMs:4});
 assert.equal(trace.read().stageTimings[1].roundTripMs,undefined);assert.ok(!JSON.stringify(trace.read()).includes('private-sentinel'));
 for(const change of [{roundTripMs:NaN,feedPreparationMs:1},{roundTripMs:1},{roundTripMs:1,feedPreparationMs:-1}])trace.onEvent({type:'progress',phase:'hr',completedStages:1,totalStages:2,stageTiming:{...timing,...change}});
 assert.equal(trace.read().stageTimings[0].roundTripMs,10);
 trace.onEvent({type:'prepared',model:'hr'});assert.equal(trace.read().stageTimingSummary.parentTimedStages,undefined);
});

test('explicit synthetic fixtures require bounded PNG bytes and matching SHA before launch',()=>{
 const {loadSyntheticFixture}=require('../tools/observe_browser_local_app.cjs'),os=require('node:os'),crypto=require('node:crypto');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'plan36-fixture-'));
 try{
  const file=path.join(root,'sample.png'),bytes=fs.readFileSync(path.resolve(__dirname,'../web/public/examples/fictional-portrait-v1.png')),sha=crypto.createHash('sha256').update(bytes).digest('hex');fs.writeFileSync(file,bytes);
  assert.deepEqual(loadSyntheticFixture(file,sha),{buffer:bytes,sha256:sha});
  for(const args of [[file,undefined],[file,'0'.repeat(64)],[undefined,sha],[root,sha]])assert.throws(()=>loadSyntheticFixture(...args));
  fs.writeFileSync(file,Buffer.alloc(24));assert.throws(()=>loadSyntheticFixture(file,crypto.createHash('sha256').update(Buffer.alloc(24)).digest('hex')));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('preparation timing is paired bounded numeric metadata with explicit coverage',async()=>{
 const {stageTiming}=await import('../tools/browser-library-adapter/stage-tensors.mjs'),{createLocalValidationTrace}=await import('../web/src/localValidationTrace.mjs');
 const base={prepareMs:50,inferMs:10,exportMs:1,releaseMs:2};
 for(const bad of [{runtimeConfigureMs:1},{runtimeConfigureMs:NaN,modelLoadMs:1},{runtimeConfigureMs:1,modelLoadMs:-1},{runtimeConfigureMs:1,modelLoadMs:600001}])assert.throws(()=>stageTiming({...base,...bad}));
 const trace=createLocalValidationTrace();trace.onEvent({type:'prepared',model:'hr'});trace.onEvent({type:'progress',phase:'hr',completedStages:1,totalStages:2,stageTiming:{...base,runtimeConfigureMs:3,modelLoadMs:40,private:'sentinel'}});trace.onEvent({type:'progress',phase:'hr',completedStages:2,totalStages:2,stageTiming:base});
 const value=trace.read();assert.equal(value.stageTimingSummary.preparationTimedStages,1);assert.equal(value.stageTimingSummary.runtimeConfigureMs,3);assert.equal(value.stageTimingSummary.modelLoadMs,40);assert.ok(!JSON.stringify(value).includes('sentinel'));trace.onEvent({type:'prepared',model:'hr'});assert.equal(trace.read().stageTimingSummary.preparationTimedStages,undefined);
});

test('resource diagnostic counters reject partial/nonfinite/fractional/oversize data and report partial coverage',async()=>{
 const {stageTiming}=await import('../tools/browser-library-adapter/stage-tensors.mjs'),{createLocalValidationTrace}=await import('../web/src/localValidationTrace.mjs');const base={prepareMs:10,inferMs:2,exportMs:0,releaseMs:0},detail={resourceReadWaitSumMs:3,resourceHashWorkSumMs:4,resourceVerifiedBytes:32,resourceVerifiedStreams:2};
 for(const bad of [{resourceVerifiedBytes:1},{...detail,resourceReadWaitSumMs:NaN},{...detail,resourceHashWorkSumMs:-1},{...detail,resourceVerifiedBytes:1.5},{...detail,resourceVerifiedStreams:1025},{...detail,resourceVerifiedBytes:8*1024**3+1}])assert.throws(()=>stageTiming({...base,...bad}));
 const trace=createLocalValidationTrace();trace.onEvent({type:'prepared',model:'hr'});trace.onEvent({type:'progress',phase:'hr',completedStages:1,totalStages:2,stageTiming:{...base,...detail,url:'private-sentinel'}});trace.onEvent({type:'progress',phase:'hr',completedStages:2,totalStages:2,stageTiming:base});const value=trace.read();assert.equal(value.stageTimingSummary.resourceTimedStages,1);assert.equal(value.stageTimingSummary.resourceVerifiedBytes,32);assert.equal(value.stageTimingSummary.resourceHashWorkSumMs,4);assert.ok(!JSON.stringify(value).includes('private-sentinel'));trace.onEvent({type:'prepared',model:'hr'});assert.equal(trace.read().stageTimingSummary.resourceTimedStages,undefined);
});

test('bounded private result history survives progress eviction and overflow fails acceptance',async()=>{
 const {createLocalValidationTrace}=await import('../web/src/localValidationTrace.mjs');const {expectedTraceResults}=require('../tools/observe_browser_local_app.cjs');const trace=createLocalValidationTrace();for(let run=0;run<2;run++){for(const model of ['hr','matte']){trace.onEvent({type:'prepared',model});for(let i=0;i<100;i++)trace.onEvent({type:'progress',phase:model});trace.onEvent({type:'result'});trace.onEvent({type:'disposed'});}}const read=trace.read();assert.equal(read.events.length,64);assert.deepEqual(read.resultRoles,['hr','matte','hr','matte']);assert.equal(expectedTraceResults(read,'hr',true,2),true);for(let i=0;i<40;i++){trace.onEvent({type:'prepared',model:'hr'});trace.onEvent({type:'result'});}assert.equal(trace.read().resultRoles.length,32);assert.equal(trace.read().resultRolesOverflow,true);assert.equal(expectedTraceResults(trace.read(),'hr',false,32),false);
});
