// Serial real-model experiment on an explicitly disposable browser. No auto retry/reload.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {captureBrowserResources,verifyBrowserPid}=require('./browser_process_resources.cjs');
async function main(){
 if(process.env.PLAN36_DISPOSABLE_BROWSER!=='1')throw Error('Task-owned disposable browser required');
 const [output,stateFile,caseId='reference-01',storageBufferCacheMode='default']=process.argv.slice(2);if(!output||!stateFile||![4,5,6].includes(process.argv.length)||!['default','disabled','lazyRelease'].includes(storageBufferCacheMode)||!['reference-01','reference-square-2000'].includes(caseId))throw Error('Need NEW_PRIVATE_DIRECTORY WINDOWS_STATE_JSON');
 const state=JSON.parse(fs.readFileSync(stateFile));if(!Number.isInteger(state.pid)||state.pid<1||state.gpuDisabled)throw Error('Need a valid GPU-enabled disposable Windows browser receipt');
 fs.mkdirSync(output,{mode:0o700});const {chromium}=require(process.env.PLAYWRIGHT_CORE_PATH||'playwright-core');
 const report={status:'connecting',caseId,storageBufferCacheMode,observerCodeSha256:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),memorySamples:[],console:[]};
 const save=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');save();
 const sample=async phase=>{
  report.memorySamples.push(await captureBrowserResources(state.pid,phase));save();
 };
 let browser,page;
 try{
  browser=await chromium.connectOverCDP('http://127.0.0.1:17862',{timeout:30000});
  await verifyBrowserPid(browser,state.pid);
  const pages=browser.contexts().flatMap(c=>c.pages());if(pages.length!==1||pages[0].url()!=='about:blank')throw Error('Expected one fresh blank target');
  page=pages[0];report.browserVersion=browser.version();
  const cdp=await page.context().newCDPSession(page);report.targetId=(await cdp.send('Target.getTargetInfo')).targetInfo.targetId;
  page.on('console',message=>{if(['error','warning'].includes(message.type())&&report.console.length<100)report.console.push({type:message.type(),text:message.text()});});
  await page.goto('http://127.0.0.1:17861/lifecycle.html?case='+caseId+'&storage-cache='+storageBufferCacheMode);await page.waitForFunction(()=>window.lifecycleProbe?.state==='idle');
  await sample('before-load');await page.locator('#start').click();
  const started=Date.now();let lastSample=Date.now();
  while(Date.now()-started<600000){
   report.page=await page.evaluate(()=>{const p=window.lifecycleProbe;return {state:p.state,events:p.events,runs:p.runs,totalMs:p.totalMs};});
   report.status=report.page.state;save();
   if(['complete','error','cancelled'].includes(report.page.state))break;
   if(Date.now()-lastSample>=5000){await sample(report.page.events.at(-1)?.phase||report.page.state);lastSample=Date.now();}
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(!['complete','error','cancelled'].includes(report.page.state)){report.status='observation-timeout-not-restarted';save();process.exitCode=2;return;}
  await sample('after-workers-terminated');
  await(await browser.newBrowserCDPSession()).send('Browser.close');report.browserClosed=true;
  report.status=report.page.state==='complete'?'serial-model-lifecycle-complete-output-sha-matched':'serial-model-lifecycle-terminal-failure';save();
  console.log(JSON.stringify({status:report.status,runs:report.page.runs,memorySamples:report.memorySamples.length,browserClosed:true}));
  if(report.page.state!=='complete')process.exitCode=3;
 }catch(error){report.status='observer-error-job-not-restarted';report.error=error.message;save();process.exitCode=3;}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
