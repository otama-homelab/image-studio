// Read/write only the disposable diagnostic profile; no GPU session or model inference.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
async function main(){
 if(process.env.PLAN36_DISPOSABLE_BROWSER!=='1')throw Error('Task-owned disposable browser required');
 const output=process.argv[2];if(!output||process.argv.length!==3)throw Error('Usage: node observe_browser_cache_poc.cjs NEW_PRIVATE_DIRECTORY');
 fs.mkdirSync(output,{recursive:false,mode:0o700});
 const {chromium}=require(process.env.PLAYWRIGHT_CORE_PATH||'playwright-core');
 const report={status:'connecting',gpuInference:false,observerCodeSha256:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex')};
 const save=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');save();
 let browser,page;
 try{
  browser=await chromium.connectOverCDP('http://127.0.0.1:17862',{timeout:30000});
  const pages=browser.contexts().flatMap(c=>c.pages());
  if(pages.length!==1||pages[0].url()!=='about:blank')throw Error('Expected one fresh blank task-owned target');
  page=pages[0];report.browserVersion=browser.version();
  report.modelRequests=[];page.on('request',request=>{const url=new URL(request.url());if(url.pathname.startsWith('/models/'))report.modelRequests.push({phase:report.status,path:url.pathname,method:request.method()});});
  const cdp=await page.context().newCDPSession(page);report.targetId=(await cdp.send('Target.getTargetInfo')).targetInfo.targetId;
  await page.goto('http://127.0.0.1:17861/cache.html');
  await page.waitForFunction(()=>window.cacheProbe?.config);
  report.config=await page.evaluate(()=>window.cacheProbe.config);report.runs=[];save();
  for(const mode of ['cold','warm']){
   if(mode==='warm'){
    report.status='reloading-before-warm';save();
    const before=await page.evaluate(()=>window.cacheProbe.documentId);
    await page.reload();await page.waitForFunction(()=>window.cacheProbe?.config);
    const after=await page.evaluate(()=>({id:window.cacheProbe.documentId,config:window.cacheProbe.config}));
    if(before===after.id||JSON.stringify(after.config)!==JSON.stringify(report.config))throw Error('Reload or fixed contract verification failed');
    report.reloadProof={documentChanged:true,sameConfig:true};save();
   }
   report.status=mode+'-running';save();await page.locator('#'+mode).click();
   await page.waitForFunction(()=>['result','error'].includes(window.cacheProbe.state),{},{timeout:600000});
   const events=await page.evaluate(()=>window.cacheProbe.events);
   const terminal=events.at(-1);report.runs.push(terminal);save();
   if(terminal.type!=='result'||terminal.mode!==mode)throw Error('Cache probe terminal failure: '+JSON.stringify(terminal));
  }
  if(!report.runs[0].workerInstanceId || report.runs[0].workerInstanceId===report.runs[1].workerInstanceId)throw Error('Warm must use a fresh Worker');
  if(report.runs[1].networkBytes!==0||report.modelRequests.some(r=>r.phase!=='cold-running'))throw Error('Warm fetched model bytes');
  report.reloadProof.workerChanged=true;
  report.status='cold-warm-complete-sha-verified';
  await(await browser.newBrowserCDPSession()).send('Browser.close');report.browserClosed=true;save();console.log(JSON.stringify(report));
 }catch(error){
  report.error=String(error.message);
  if(error.name==='TimeoutError'){report.status='observation-timeout-not-restarted';save();process.exitCode=2;}
  else {report.status='observer-or-cache-error';save();process.exitCode=3;
   if(page&&await page.evaluate(()=>window.cacheProbe?.state==='error').catch(()=>false)){await(await browser.newBrowserCDPSession()).send('Browser.close');report.browserClosed=true;save();}}
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
