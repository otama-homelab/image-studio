// The caller must reopen only an old task-owned profile containing the diagnostic OPFS data.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {captureBrowserResources,verifyBrowserPid}=require('./browser_process_resources.cjs');
function parseArgs(argv){const [output,mode,stateFile]=argv;if(argv.length!==3||!output||!stateFile||!['default','lazyRelease'].includes(mode))throw Error('Need NEW_PRIVATE_DIRECTORY default|lazyRelease WINDOWS_STATE_JSON');return {output,mode,stateFile};}
async function main(){
 if(process.env.PLAN36_DISPOSABLE_BROWSER!=='1')throw Error('Disposable task-owned browser required');
 const {output,mode,stateFile}=parseArgs(process.argv.slice(2));
 const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));if(!Number.isSafeInteger(state.pid)||state.pid<1||state.gpuDisabled!==false)throw Error('Need the GPU-enabled task browser launch receipt');
 fs.mkdirSync(output,{mode:0o700});const {chromium}=require(process.env.PLAYWRIGHT_CORE_PATH||'playwright-core');
 const report={status:'connecting',storageBufferCacheMode:mode,expectedBrowserPid:state.pid,modelStartRequested:false,browserPidExitVerified:false,requestedSampleIntervalMs:5000,observerCodeSha256:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),modelRequests:[],memorySamples:[]};
 const save=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');save();let browser,page;
 try{
  browser=await chromium.connectOverCDP('http://127.0.0.1:17862',{timeout:30000});const pages=browser.contexts().flatMap(c=>c.pages());
  if(pages.length!==1||pages[0].url()!=='about:blank')throw Error('Need fresh blank target on the reopened task profile');
  await verifyBrowserPid(browser,state.pid);report.browserPidVerified=true;
  page=pages[0];report.browserVersion=browser.version();
  const cdp=await page.context().newCDPSession(page);try{report.targetId=(await cdp.send('Target.getTargetInfo')).targetInfo.targetId;}finally{await cdp.detach();}
  const sample=async phase=>{const measured=await captureBrowserResources(state.pid,phase);report.memorySamples.push(measured);save();return measured;};
  page.on('request',request=>{const url=new URL(request.url());if(url.protocol==='http:'&&url.pathname.startsWith('/models/'))report.modelRequests.push(url.pathname);});
  await page.goto('http://127.0.0.1:17861/warm-session.html?storage-cache='+mode);
  const baseline=await sample('before-load');if(!baseline.browserProcessMemory?.processCount)throw Error('Browser memory baseline unavailable; model not started');
  report.modelStartRequested=true;save();await page.locator('#start').click();
  const started=Date.now();let lastSample=Date.now();
  while(true){
   report.page=await page.evaluate(()=>window.warmSession);save();if(['complete','error','cancelled'].includes(report.page.state))break;
   if(Date.now()-started>=300000){report.status='observation-timeout-job-not-restarted';save();process.exitCode=2;return;}
   if(Date.now()-lastSample>=5000){await sample(report.page.events.at(-1)?.phase||report.page.state);lastSample=Date.now();}
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
  report.page=await page.evaluate(()=>window.warmSession);report.status=report.page.state==='complete'?'warm-opfs-session-prepared-and-disposed':'warm-opfs-session-terminal-failure';
  if(report.page.state==='complete'&&report.modelRequests.length)throw Error('Warm session unexpectedly downloaded model files');
  if(report.page.state==='complete'&&(report.page.ready?.modelSource!=='opfs-warm'||report.page.ready.modelNetworkBytes!==0||report.page.disposed?.type!=='disposed'))throw Error('Warm initialization/disposal proof missing');
  await sample(report.page.state==='complete'?'after-worker-disposed':'after-worker-stop-request');
  save();await(await browser.newBrowserCDPSession()).send('Browser.close');report.browserClosed=true;report.browserCloseAcknowledged=true;save();console.log(JSON.stringify(report));
  if(report.page.state!=='complete')process.exitCode=3;
 }catch(error){report.status=error.name==='TimeoutError'?'observation-timeout-job-not-restarted':'observer-error-job-not-restarted';report.error=error.message;
  if(browser&&report.browserPidVerified&&!report.modelStartRequested){try{await(await browser.newBrowserCDPSession()).send('Browser.close');report.browserClosed=true;report.browserCloseAcknowledged=true;}catch(closeError){report.browserCloseError=closeError.name;}}
  save();process.exitCode=2;}
}
module.exports={parseArgs};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
