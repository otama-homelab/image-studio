// One explicitly authorized background UI operation, on an already launched disposable Chrome.
const {Buffer}=require('node:buffer');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {captureBrowserResources,verifyBrowserPid,stopTaskBrowser,isTaskProfile}=require('./browser_process_resources.cjs');
const {createTaskDownloads}=require('./browser_download_transport.cjs');
const {startBrowserResourceStream}=require('./browser_resource_stream.cjs');
const BUDGET=Object.freeze({privateBytes:4*1024**3,workingSetBytes:4*1024**3,gpuGrowthMiB:1024,seconds:120,sampleIntervalMs:2000});
const HR_VALIDATION_BUDGET=Object.freeze({privateBytes:16*1024**3,workingSetBytes:5*1024**3,gpuGrowthMiB:6144,freeGpuMiB:1024,freePhysicalBytes:3*1024**3,freeVirtualBytes:8*1024**3,seconds:120,sampleIntervalMs:2000});
const STAGED_VALIDATION_BUDGET=Object.freeze({privateBytes:12*1024**3,workingSetBytes:5*1024**3,gpuGrowthMiB:4096,freeGpuMiB:1024,freePhysicalBytes:3*1024**3,freeVirtualBytes:8*1024**3,seconds:600,sampleIntervalMs:2000});
function cspIssue(issue){
 if(issue?.code!=='ContentSecurityPolicyIssue')return null;
 const details=issue.details?.contentSecurityPolicyIssueDetails;
 const kinds={kEvalViolation:'js-eval',kWasmEvalViolation:'wasm-eval',kInlineViolation:'inline',kURLViolation:'url',kSRIViolation:'integrity',kTrustedTypesSinkViolation:'trusted-types',kTrustedTypesPolicyViolation:'trusted-types'};
 if(!details||typeof details.isReportOnly!=='boolean'||typeof details.contentSecurityPolicyViolationType!=='string'||!Object.hasOwn(kinds,details.contentSecurityPolicyViolationType))return null;
 const first=typeof details.violatedDirective==='string'?details.violatedDirective.split(' ')[0]:'';
 const directive=['script-src','script-src-elem','worker-src','connect-src','style-src','img-src'].includes(first)?first:'other';
 return {kind:kinds[details.contentSecurityPolicyViolationType],directive,reportOnly:details.isReportOnly};
}
function budgetReason(sample,baseline,budget=BUDGET){
 const memory=sample?.browserProcessMemory,prior=baseline?.wholeGpuMiB,gpu=sample?.wholeGpuMiB;
 if(!Number.isSafeInteger(memory?.processCount)||memory.processCount<1
  ||!['privateBytesSum','workingSetSum'].every(key=>Number.isSafeInteger(memory[key])&&memory[key]>=0)
  ||!Array.isArray(gpu)||!Array.isArray(prior)||!gpu.length||gpu.length!==prior.length)return 'resource-observation-unavailable';
 if(memory.privateBytesSum>budget.privateBytes||memory.workingSetSum>budget.workingSetBytes)return 'browser-memory-budget-exceeded';
 if(gpu.some((row,index)=>!Array.isArray(row)||row.length!==2||!Array.isArray(prior[index])||prior[index].length!==2
  ||row[1]!==prior[index][1]||[...row,...prior[index]].some(n=>!Number.isFinite(n)||n<0)||row[0]>row[1]))return 'resource-observation-unavailable';
 if(gpu.some((row,index)=>row[0]-prior[index][0]>budget.gpuGrowthMiB))return 'whole-gpu-growth-budget-exceeded';
 if(budget.freeGpuMiB&&gpu.some(row=>row[1]-row[0]<budget.freeGpuMiB))return 'gpu-memory-reserve-exceeded';
 if(budget.freePhysicalBytes){
  if(!Number.isSafeInteger(sample.systemMemory?.freePhysicalBytes)||!Number.isSafeInteger(sample.systemMemory?.freeVirtualBytes))return 'resource-observation-unavailable';
  if(sample.systemMemory.freePhysicalBytes<budget.freePhysicalBytes||sample.systemMemory.freeVirtualBytes<budget.freeVirtualBytes)return 'system-memory-reserve-exceeded';
 }
 return null;
}
// Admission reserves space for the configured growth before loading any model.
// This cannot cap allocations or establish that the model will fit.
function admissionReason(sample,budget=BUDGET){
 const invalid=budgetReason(sample,sample,budget);if(invalid)return invalid;
 if(budget.freePhysicalBytes){
  const memory=sample.browserProcessMemory;
  if(sample.systemMemory.freePhysicalBytes<budget.freePhysicalBytes+Math.max(0,budget.workingSetBytes-memory.workingSetSum)
   ||sample.systemMemory.freeVirtualBytes<budget.freeVirtualBytes+Math.max(0,budget.privateBytes-memory.privateBytesSum))return 'insufficient-system-headroom-before-start';
 }
 const needed=budget.freeGpuMiB?budget.freeGpuMiB+budget.gpuGrowthMiB:2048;
 if(sample.wholeGpuMiB.some(row=>row[1]-row[0]<needed))return 'insufficient-gpu-headroom-before-start';
 return null;
}
function refinementMode(value,manifest,resourceProfile){
 if(value!==undefined&&value!=='0'&&value!=='1')throw Error('Unknown refinement request');
 if(value!=='1')return false;
 const config=manifest.runtimeConfig,hr=config?.prepareHr,matte=config?.prepareMatte;
 if(manifest.stageCount!==undefined||(manifest.backgroundModel??'hr')!=='hr'||hr?.model!=='hr'||matte?.model!=='matte'
  ||typeof hr.modelVersion!=='string'||!hr.modelVersion||hr.modelVersion!==matte.modelVersion||!config.workers?.trimap)throw Error('Explicit matching HR matte trimap configuration required');
 if(resourceProfile!=='stage-validation')throw Error('Refinement requires staged validation resource profile');
 return true;
}
function allowedResourceRoutes(manifest,refine){
 const mattePaths=new Set((manifest.runtimeConfig?.prepareMatte?.source?.resources??[]).map(file=>new URL(file.url).pathname));
 const allowed=new Set(manifest.mounts.filter(item=>!item.route.startsWith('/models/')||!item.route.includes('/matte/')||(refine&&mattePaths.has(item.route))).map(item=>item.route));
 allowed.add('/');return allowed;
}
function expectedModelResults(events,backgroundModel,refine,count=1){
 if(!Array.isArray(events))return false;
 const roles=events.filter(event=>event?.type==='result').map(event=>event.role);
 return JSON.stringify(roles)===JSON.stringify(Array.from({length:count},()=>refine?['hr','matte']:[backgroundModel]).flat());
}
function expectedTraceResults(trace,...args){if(trace.resultRolesOverflow===true)return false;return expectedModelResults(Array.isArray(trace.resultRoles)?trace.resultRoles.map(role=>({type:'result',role})):trace.events,...args);}
function loadSyntheticFixture(filename,expectedSha256){
 if(typeof filename!=='string'||!filename||!/^[a-f0-9]{64}$/.test(expectedSha256??''))throw Error('Explicit synthetic fixture path and SHA256 required');
 const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<24||stat.size>32*1024**2)throw Error('Expected bounded synthetic PNG fixture');
 const buffer=fs.readFileSync(filename),sha256=crypto.createHash('sha256').update(buffer).digest('hex');
 if(sha256!==expectedSha256||!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Synthetic fixture integrity mismatch');
 return {buffer,sha256};
}
async function bounded(action,ms=5000){let timer;try{return await Promise.race([action,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('observer-action-timeout')),ms);})]);}finally{clearTimeout(timer);}}
async function main(){
 if(process.env.PLAN36_DISPOSABLE_BROWSER!=='1')throw Error('Disposable task-owned browser required');
 let budget=process.env.PLAN36_RESOURCE_PROFILE==='stage-validation'?STAGED_VALIDATION_BUDGET:process.env.PLAN36_RESOURCE_PROFILE==='hr-validation'?HR_VALIDATION_BUDGET:BUDGET;
 const [output,stateFile,manifestFile]=process.argv.slice(2);if(process.argv.length!==5||!output||fs.existsSync(output))throw Error('Need NEW_PRIVATE_OUTPUT WINDOWS_STATE_JSON LOCAL_APP_MANIFEST');
 const state=JSON.parse(fs.readFileSync(stateFile)),manifest=JSON.parse(fs.readFileSync(manifestFile));
 const backgroundModel=manifest.backgroundModel??'hr';if(!['hr','modnet','portrait','lite'].includes(backgroundModel))throw Error('Unknown background model');
 const staged=manifest.stageCount===46;if(manifest.stageCount!==undefined&&!staged)throw Error('Unexpected staged model contract');
 const refine=refinementMode(process.env.PLAN36_REFINE,manifest,process.env.PLAN36_RESOURCE_PROFILE);
 const runCount=process.env.PLAN36_RUN_COUNT??'1';if(!/^[1-5]$/.test(runCount)||(staged&&runCount!=='1'))throw Error('Run count must be 1..5; raw staged-page remains single-run');
 const requestedRuns=Number(runCount);
 if(staged)budget=Object.freeze({...budget,seconds:600});
 if(!Number.isSafeInteger(state.pid)||state.pid<1||!isTaskProfile(state.profile)||state.gpuDisabled!==false||manifest.status!=='local-app-built-not-started'||manifest.distributionApproved!==false)throw Error('Explicit task launch and local app receipts required');
 const origin=new URL(manifest.appOrigin);if(origin.origin!==manifest.appOrigin||origin.protocol!=='http:'||!['localhost','127.0.0.1'].includes(origin.hostname))throw Error('Loopback app required');
 const customFixture=process.env.PLAN36_SYNTHETIC_FIXTURE,customSha256=process.env.PLAN36_SYNTHETIC_FIXTURE_SHA256;
 if((customFixture===undefined)!==(customSha256===undefined))throw Error('Synthetic fixture path and SHA256 must be supplied together');
 if(staged&&(customFixture!==undefined||customSha256!==undefined))throw Error('Staged reference fixture cannot be replaced');
 const selected=staged?null:loadSyntheticFixture(customFixture??path.join(__dirname,'../web/public/examples/fictional-portrait-v1.png'),customFixture===undefined&&customSha256===undefined?'ffd8a813329f8c4a2d1dd17a2d3b24a36c97c73059fc921d8cb1ad05cdbfb258':customSha256);
 const fixture=selected?.buffer,fixtureSha256=staged?manifest.input?.sha256:selected.sha256;
 if(staged&&(!/^[a-f0-9]{64}$/.test(fixtureSha256??'')||manifest.input?.bytes!==25165824))throw Error('Expected fixed staged reference input');
 fs.mkdirSync(output,{mode:0o700});
 const report={status:'connecting',operation:staged?'staged-hr-reference':backgroundModel+(refine?'-refine':'')+'-ui',referenceCaseId:staged?manifest.referenceCaseId:undefined,budget,fixtureSha256,cspIssues:[],localModelLoadErrors:[],auditsAvailable:false,observerCodeSha256:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
  appManifestSha256:crypto.createHash('sha256').update(fs.readFileSync(manifestFile)).digest('hex'),modelStarts:0,refine,network:[],samples:[],browserPidVerified:false,browserCloseAcknowledged:false,
  limits:['Sampling is not a hard OS/GPU allocation cap and can miss transient peaks','Whole GPU memory includes other applications','One synthetic image cannot establish full product quality or resource acceptance']};
 const save=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');save();
 const {chromium}=require(process.env.PLAYWRIGHT_CORE_PATH||'playwright-core');let browser,nativeContext,page,panel,audits,baseline,downloads,resourceStream,stopReason=null;
 try{
  if(process.env.PLAN36_NATIVE_LAUNCH==='1'){
   if(process.platform!=='win32')throw Error('Native Windows observer required');
   nativeContext=await chromium.launchPersistentContext(state.profile,{executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:false,args:['--disable-background-networking'],timeout:20000});
   browser=nativeContext.browser();
   const session=await browser.newBrowserCDPSession();
   try{const roots=(await session.send('SystemInfo.getProcessInfo')).processInfo.filter(p=>p.type==='browser');if(roots.length!==1)throw Error('Unexpected native browser roots');state.pid=roots[0].id;}finally{await session.detach();}
   fs.writeFileSync(path.join(output,'native-launch.json'),JSON.stringify({pid:state.pid,profile:state.profile,gpuDisabled:false,transport:'official-playwright-pipe'},null,2)+'\n');report.nativeLaunch=true;
  }else browser=await chromium.connectOverCDP('http://127.0.0.1:17862',{timeout:15000});
  await verifyBrowserPid(browser,state.pid);report.browserPidVerified=true;
  report.downloadTransportPhases=[];downloads=await createTaskDownloads(browser,state.profile,{onState:phase=>{if(report.downloadTransportPhases.length<8)report.downloadTransportPhases.push(phase);save();}});
  const pages=browser.contexts().flatMap(context=>context.pages());if(pages.length!==1||pages[0].url()!=='about:blank')throw Error('Fresh blank task target required');
  page=pages[0];page.setDefaultTimeout(5000);report.browserVersion=browser.version();
  page.on('console',message=>{
   const prefix='[image-studio-local-model-load] ',text=message.text();
   if(message.type()==='error'&&text.startsWith(prefix)&&report.localModelLoadErrors.length<4){report.localModelLoadErrors.push(text.slice(prefix.length,prefix.length+2048));save();}
  });
  audits=await page.context().newCDPSession(page);
  audits.on('Audits.issueAdded',({issue})=>{
   const event=cspIssue(issue);if(!event)return;
   if(report.cspIssues.length<32)report.cspIssues.push(event);
   if(!event.reportOnly&&['js-eval','wasm-eval'].includes(event.kind))stopReason='csp-execution-blocked';save();
  });
  await audits.send('Audits.enable');report.auditsAvailable=true;
  const allowed=allowedResourceRoutes(manifest,refine);
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(['blob:','data:'].includes(url.protocol))return route.continue();
   const permitted=request.method()==='GET'&&url.origin===origin.origin&&!url.search&&allowed.has(url.pathname);
   report.network.push({method:request.method(),path:permitted?url.pathname:'<unlisted>',permitted});save();
   if(!permitted){stopReason='unexpected-network-attempt';return route.abort();}
   return route.continue();
  });
  report.httpCacheObservation={eligible:false,reason:'playwright-routing-disables-http-cache'};save();
  const sample=async phase=>{const value=await captureBrowserResources(state.pid,phase);report.samples.push(value);save();return value;};
  baseline=await sample('before-page');stopReason=admissionReason(baseline,budget);if(stopReason)throw Error(stopReason);
  await page.goto(origin.origin+manifest.entry,{timeout:15000});report.gpuAdapterNotRequested=manifest.runtimeConfig?.executionProvider==='wasm';report.adapterLimits=report.gpuAdapterNotRequested?null:await page.evaluate(async()=>{const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});return adapter?{maxStorageBuffersPerShaderStage:adapter.limits.maxStorageBuffersPerShaderStage,maxBufferSize:adapter.limits.maxBufferSize,maxStorageBufferBindingSize:adapter.limits.maxStorageBufferBindingSize}:null;});panel=page.locator(staged?'body':'.background-editor');
  if(staged){
   if(!await page.evaluate(()=>typeof window.__imageStudioStages==='function'))throw Error('Stage trace unavailable');
  }else{
   if(!await page.evaluate(()=>typeof window.__imageStudioValidation==='function'))throw Error('Local validation trace unavailable');
   await panel.getByLabel('背景編集の写真を選ぶ').setInputFiles({name:'synthetic-portrait.png',mimeType:'image/png',buffer:fixture});
   await panel.getByRole('button',{name:'背景を除去してPNGを作成',exact:true}).waitFor();
   await bounded(page.waitForFunction(()=>window.__imageStudioValidation()?.state?.hasPhoto===true),15000);
   const refinement=panel.getByLabel('髪や服の輪郭を補正する');
   if(refine){if(await refinement.count()!==1)throw Error('Refinement control unavailable');await refinement.check();if(!await refinement.isChecked())throw Error('Refinement not enabled');}
   else if(await refinement.count()&&await refinement.isChecked())throw Error('Base-model run requires refinement off');
  }
  const before=await sample('before-model');stopReason=stopReason||admissionReason(before,budget);if(stopReason)throw Error(stopReason);
  const streamBudget={...budget,freePhysicalBytes:0,freeVirtualBytes:0};
  if(process.env.PLAN36_CONTINUOUS_RESOURCES==='1'){
   if(process.platform!=='win32')throw Error('Native Windows counters required');
   resourceStream=startBrowserResourceStream(state.pid,{intervalMs:200,durationMs:Math.min(600000,budget.seconds*1000+15000),maxSamples:10000,gpuCount:baseline.wholeGpuMiB.length,
    onSample:value=>{if(value.browserProcessMemory&&value.wholeGpuMiB)stopReason=stopReason||budgetReason(value,baseline,streamBudget);}});
   await resourceStream.ready();if(stopReason)throw Error(stopReason);
  }
  report.modelStarts=staged?1:0;report.status=staged?'observing-one-'+backgroundModel+'-operation':'checking-model-preparation';save();await panel.getByRole('button',{name:staged?'HR 46工程を1回実行':'背景を除去してPNGを作成',exact:true}).click();
  if(!staged){const consent=panel.getByRole('button',{name:'取得・検証して処理を始める',exact:true});if(manifest.runtimeConfig?.prepareBackground||manifest.runtimeConfig?.prepareHr||await consent.count()){await consent.waitFor();await consent.click();report.modelStarts=1;}else report.modelStarts=1;report.status='observing-one-'+backgroundModel+'-operation';save();}
  const started=Date.now();let idleSince=null,stageSeen=-1,stageStarted=started;
  while(true){
   report.trace=await bounded(staged?page.evaluate(()=>window.__imageStudioStages()):page.evaluate(()=>window.__imageStudioValidation()));save();
   const last=report.trace.events.at(-1);
   const phase=staged?(last?'stage-'+last.index+'-'+last.phase:'stage-input'):last?.type||'operation';
   if(staged&&Number.isSafeInteger(last?.index)&&last.index!==stageSeen){stageSeen=last.index;stageStarted=Date.now();}
   if(staged&&report.trace.state==='running'&&Date.now()-stageStarted>120000)stopReason||='stage-time-budget-exceeded';
   // A CSP/network/continuous-resource callback may request a stop while
   // sampling awaits OS counters. Read the flag after that await.
   const measured=await sample(phase);
   stopReason=stopReason||budgetReason(measured,baseline,budget);
   if(Date.now()-started>budget.seconds*1000)stopReason||='operation-time-budget-exceeded';
   if(stopReason)break;
   if(staged){
    if(report.trace.gate?.blocked||report.trace.runner?.blocked){stopReason='worker-shutdown-blocked';break;}
    if(report.trace.state==='complete'){
     if(report.trace.gate?.busy||report.trace.runner?.busy||report.trace.stageCount!==46)throw Error('Stage resources still active');
     for(let index=0;index<46;index++)if(report.trace.events.filter(e=>e.phase==='complete'&&e.index===index).length!==1)throw Error('Incomplete stage sequence');
     await downloads.saveFromClick(()=>panel.getByRole('link',{name:'alphaを保存',exact:true}).click(),path.join(output,'staged-alpha-2048.f32'),{expectedBytes:16777216});
     const bytes=fs.readFileSync(path.join(output,'staged-alpha-2048.f32')),digest=crypto.createHash('sha256').update(bytes).digest('hex');
     if(bytes.length!==16777216||digest!==report.trace.result?.sha256)throw Error('Stage output contract mismatch');
     report.download={bytes:bytes.length,sha256:digest};report.status='one-staged-hr-operation-and-download-complete';break;
    }
    if(['error','cancelled'].includes(report.trace.state)){stopReason='staged-operation-failed';report.stageErrorCode=report.trace.errorCode;break;}
    await new Promise(resolve=>setTimeout(resolve,budget.sampleIntervalMs));continue;
   }
   if(report.trace.state?.blocked){stopReason='worker-shutdown-blocked';break;}
   if(report.trace.state?.busy===false){
    if(await panel.getByRole('link',{name:/^(?:透過|背景付き)?PNGを保存$/}).count()){
     if(report.trace.gate.busy||report.trace.gate.blocked)throw Error('Output still owns active Worker resources');
     if(!expectedTraceResults(report.trace,backgroundModel,refine,report.modelStarts)||(!refine&&report.trace.events.some(event=>event.role==='matte')))throw Error('Unexpected background refinement result sequence');
     await downloads.saveFromClick(()=>panel.getByRole('link',{name:/^(?:透過|背景付き)?PNGを保存$/}).click(),path.join(output,report.modelStarts===1?'transparent.png':`transparent-${report.modelStarts}.png`));
     const bytes=fs.readFileSync(path.join(output,report.modelStarts===1?'transparent.png':`transparent-${report.modelStarts}.png`));if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Expected PNG download');
     report.download={bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
     report.completedRuns??=[];report.completedRuns.push({index:report.modelStarts,download:report.download,...(report.trace.stageTimingSummary?{stageTimingSummary:report.trace.stageTimingSummary}:{})});
     if(report.completedRuns.length>1&&report.download.sha256!==report.completedRuns[0].download.sha256)throw Error('Repeated output differs');
     if(report.modelStarts<requestedRuns){
      // Keep the original overall deadline and continuous collector; never retry failures.
      const admission=await sample('before-repeat');stopReason=stopReason||admissionReason(admission,budget);if(stopReason)break;
      if(refine){
       await panel.getByLabel('背景編集の写真を選ぶ').setInputFiles({name:'synthetic-portrait.png',mimeType:'image/png',buffer:fixture});
       await panel.getByRole('button',{name:'写真を置き換える',exact:true}).click();
       await bounded(page.waitForFunction(()=>{const state=window.__imageStudioValidation()?.state;return state?.hasPhoto===true&&state?.hasResult===false&&state?.busy===false;}),15000);
       if(await panel.getByRole('link',{name:/^(?:透過|背景付き)?PNGを保存$/}).count())throw Error('Photo replacement kept stale download');
      }
      await panel.getByRole('button',{name:'背景を除去してPNGを作成',exact:true}).click();
      const consent=panel.getByRole('button',{name:'取得・検証して処理を始める',exact:true});
      if(manifest.runtimeConfig?.prepareBackground||manifest.runtimeConfig?.prepareHr||await consent.count()){await consent.waitFor();await consent.click();}
      report.modelStarts++;idleSince=null;continue;
     }
     if(manifest.runtimeConfig?.modelVariants?.length){
      const initial=(manifest.runtimeConfig.prepareBackground??manifest.runtimeConfig.prepareHr).modelVersion;
      for(const variant of manifest.runtimeConfig.modelVariants){
       await panel.getByRole('combobox',{name:/^背景除去モデル/}).selectOption(variant.prepareBackground.modelVersion);
       const switched=await page.evaluate(()=>window.__imageStudioValidation());
       if(!switched.state.hasPhoto||switched.state.hasResult||switched.state.busy||await panel.getByRole('link',{name:/^(?:透過|背景付き)?PNGを保存$/}).count())throw Error('Model switch retained stale output');
       if(await panel.getByAltText('背景編集前の写真',{exact:true}).count()!==1)throw Error('Model switch lost original photo');
      }
      await panel.getByRole('combobox',{name:/^背景除去モデル/}).selectOption(initial);
      const switched=await page.evaluate(()=>window.__imageStudioValidation());
      if(!switched.state.hasPhoto||switched.state.hasResult||!expectedTraceResults(switched,backgroundModel,refine,report.modelStarts))throw Error('Model switch unexpectedly inferred');
      report.modelSwitchCheck={variants:manifest.runtimeConfig.modelVariants.length,photoRetained:true,oldDownloadRemoved:true,noExtraInference:true};
     }
     report.status='one-'+backgroundModel+(refine?'-refine':'')+'-ui-operation-and-download-complete';break;
    }
    idleSince??=Date.now();
    if(Date.now()-idleSince>=5000){stopReason='operation-ended-without-output';break;}
   }else{
    idleSince=null;
   }
   await new Promise(resolve=>setTimeout(resolve,budget.sampleIntervalMs));
  }
 }catch(error){report.errorCode=error.name==='TimeoutError'?'observer-timeout':'observer-error';
  if(['download-configure-failed','unexpected-download','download-size-exceeded','download-canceled','download-size-mismatch','download-file-invalid','download-timeout','download-closed'].includes(error.message))report.downloadErrorCode=error.message;
  if(['ENOENT','EACCES','EPERM','EEXIST'].includes(error.code))report.observerSystemError=error.code;stopReason||='observer-error-no-restart';}
 finally{
  if(resourceStream){
   try{report.collectorShutdown=await resourceStream.close();}catch{report.collectorShutdownError=true;stopReason||='resource-observation-unavailable';}
   report.resourceStream=resourceStream.snapshot();
   if(report.resourceStream.droppedSamples||Object.keys(report.resourceStream.errors).length)stopReason||='resource-observation-unavailable';
   // Independently audit saved observations, even if a live callback was missed.
   for(const value of report.resourceStream.samples)if(value.browserProcessMemory&&value.wholeGpuMiB)stopReason=stopReason||budgetReason(value,baseline,{...budget,freePhysicalBytes:0,freeVirtualBytes:0});
  }
  if(stopReason){report.stopReason=stopReason;report.status='stopped-without-retry';
   if(panel)try{await bounded(panel.getByRole('button',{name:'中止',exact:true}).click({timeout:2000}),2500);report.uiCancelRequested=true;}catch{report.uiCancelUnavailable=true;}
  }
  if(browser&&report.browserPidVerified){
   if(audits)try{await bounded(audits.detach(),1000);}catch{}
   try{if(nativeContext)await bounded(nativeContext.close(),10000);else{const cdp=await bounded(browser.newBrowserCDPSession());await bounded(cdp.send('Browser.close'));}report.browserCloseAcknowledged=true;}
   catch{report.browserCloseAcknowledged=false;}
   try{
    let terminal=await captureBrowserResources(state.pid,'after-browser-close');report.samples.push(terminal);
    if(terminal.browserProcessMemory?.processCount!==0){
     report.forcedTaskShutdown=await stopTaskBrowser(state.pid,state.profile);
     terminal=await captureBrowserResources(state.pid,'after-profile-scoped-shutdown');report.samples.push(terminal);
    }
    report.browserExitVerified=terminal.browserProcessMemory?.processCount===0;
    if(report.browserExitVerified&&Array.isArray(baseline?.wholeGpuMiB)){
     const settled=value=>Array.isArray(value.wholeGpuMiB)&&value.wholeGpuMiB.length===baseline.wholeGpuMiB.length
      &&value.wholeGpuMiB.every((row,index)=>row[1]===baseline.wholeGpuMiB[index][1]&&row[0]<=baseline.wholeGpuMiB[index][0]+256);
     const deadline=Date.now()+20000;
     while(!settled(terminal)&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,1000));terminal=await captureBrowserResources(state.pid,'gpu-settle-after-browser-close');report.samples.push(terminal);save();}
     report.wholeGpuReturnedNearBaseline=settled(terminal);
    }
   }catch{report.browserExitVerified=false;}
  }
  if(nativeContext&&!report.browserPidVerified)try{await bounded(nativeContext.close(),10000);}catch{}
  if(downloads)try{await downloads.close();report.downloadTransportCleaned=true;}catch{report.downloadTransportCleaned=false;}
  save();
 }
 if(!['one-hr-refine-ui-operation-and-download-complete','one-hr-ui-operation-and-download-complete','one-modnet-ui-operation-and-download-complete','one-portrait-ui-operation-and-download-complete','one-lite-ui-operation-and-download-complete','one-staged-hr-operation-and-download-complete'].includes(report.status)||!report.browserExitVerified||report.downloadTransportCleaned===false)process.exitCode=2;
 console.log(JSON.stringify({status:report.status,stopReason:report.stopReason,modelStarts:report.modelStarts,browserCloseAcknowledged:report.browserCloseAcknowledged}));
}
module.exports={BUDGET,HR_VALIDATION_BUDGET,STAGED_VALIDATION_BUDGET,budgetReason,admissionReason,cspIssue,refinementMode,allowedResourceRoutes,expectedModelResults,expectedTraceResults,loadSyntheticFixture,main};
if(require.main===module)main().catch(error=>{console.error(error.name);process.exitCode=1;});
