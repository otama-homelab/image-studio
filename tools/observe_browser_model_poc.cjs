// Task-owned browser only. Model execution remains an explicit single operation.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

function parseArgs(argv) {
  const options={mode:'observe',seconds:120,cdp:'http://127.0.0.1:17862',origin:'http://127.0.0.1:17861'};
  for(let i=0;i<argv.length;i++) {
    const key=argv[i];
    if(key==='--close-browser')options.closeBrowser=true;
    else if(['--mode','--output','--from-report','--case','--seconds','--cdp','--origin'].includes(key)) {
      if(!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Missing value for '+key);
      options[key.slice(2).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=argv[++i];
    } else throw Error('Unknown argument '+key);
  }
  options.seconds=Number(options.seconds);
  if(!['load','run','observe','repeat'].includes(options.mode)||!options.output||!Number.isInteger(options.seconds)||options.seconds<1||options.seconds>3600)throw Error('Need mode load/run/observe/repeat, new output directory, seconds 1..3600');
  if(['run','observe'].includes(options.mode)&&!options.fromReport)throw Error('Run/observe require --from-report to pin the existing target');
  if(['run','repeat'].includes(options.mode)&&(!options.case||!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(options.case)))throw Error('Run requires a safe case ID');
  if(options.mode==='repeat') {
    if(options.fromReport)throw Error('Repeat starts on a fresh blank target, not an existing job');
    options.closeBrowser=true;
  }
  return options;
}

async function copyOutput(page, filename, meta) {
  if(meta.outputDtype!=='float32'||meta.shape.length!==4||meta.shape.some(v=>!Number.isInteger(v)||v<1))throw Error('Expected typed FP32 output shape');
  const length=await page.evaluate(()=>window.modelPoc.output.byteLength);
  if(length!==meta.shape.reduce((a,b)=>a*b,1)*4)throw Error('Output byte/shape mismatch');
  const fd=fs.openSync(filename,'wx',0o600),hash=crypto.createHash('sha256');
  try {
    for(let offset=0;offset<length;offset+=262144) {
      const encoded=await page.evaluate(({offset,size})=>{
        const bytes=new Uint8Array(window.modelPoc.output,offset,Math.min(size,window.modelPoc.output.byteLength-offset));
        let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);
      },{offset,size:262144});
      const bytes=Buffer.from(encoded,'base64');
      if(bytes.length!==Math.min(262144,length-offset))throw Error('Truncated output chunk');
      let cursor=0;
      while(cursor<bytes.length){const written=fs.writeSync(fd,bytes,cursor,bytes.length-cursor);if(written<1)throw Error('Output write made no progress');cursor+=written;}
      hash.update(bytes);
    }
  } finally {fs.closeSync(fd);}
  const sha256=hash.digest('hex');
  if(sha256!==meta.outputSha256)throw Error('Output copy SHA mismatch');
  if(fs.statSync(filename).size!==length)throw Error('Stored output length mismatch');
  const read=fs.openSync(filename,'r'),stored=crypto.createHash('sha256'),chunk=Buffer.alloc(262144);
  try {let count;while((count=fs.readSync(read,chunk,0,chunk.length,null))>0)stored.update(chunk.subarray(0,count));}
  finally {fs.closeSync(read);}
  if(stored.digest('hex')!==sha256)throw Error('Stored output SHA mismatch');
  return {outputBytes:length,outputSha256:sha256};
}

async function main(options) {
  if(process.env.PLAN36_DISPOSABLE_BROWSER!=='1')throw Error('Use a task-owned disposable browser and set PLAN36_DISPOSABLE_BROWSER=1');
  const output=path.resolve(options.output),repo=path.resolve(__dirname,'..');
  if(output===repo||output.startsWith(repo+path.sep))throw Error('Keep evaluation tensors outside the repository');
  const prior=options.fromReport?JSON.parse(fs.readFileSync(options.fromReport,'utf8')):null;
  if(prior){options.cdp=prior.cdp;options.origin=prior.origin;if(!prior.targetId||!options.cdp||!options.origin)throw Error('Prior report lacks target/CDP/origin');}
  for(const address of [options.cdp,options.origin])if(!['127.0.0.1','localhost','[::1]'].includes(new URL(address).hostname))throw Error('Use loopback endpoints only');
  fs.mkdirSync(output,{mode:0o700});
  const report={status:'connecting',operation:options.mode,originalOperation:options.mode==='observe'?(prior?.originalOperation??prior?.operation):options.mode,
    cdp:options.cdp,origin:options.origin,caseId:options.case??prior?.caseId??null,
    expectedTargetId:prior?.targetId??null,observerCodeSha256:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex')};
  if(options.mode==='repeat')report.runs=[];
  const save=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');save();
  const {chromium}=require(process.env.PLAYWRIGHT_CORE_PATH||'playwright-core');
  let page,fd,consoleHandler;
  try {
    const browser=await chromium.connectOverCDP(options.cdp);report.browserVersion=browser.version();
    for(const candidate of browser.contexts().flatMap(c=>c.pages())) {
      const session=await candidate.context().newCDPSession(candidate);
      const {targetInfo}=await session.send('Target.getTargetInfo');await session.detach();
      if(prior?targetInfo.targetId===prior.targetId:!page){page=candidate;report.targetId=targetInfo.targetId;if(prior)break;}
    }
    if(!page)throw Error('Pinned browser target is missing; do not restart the model');
    fd=fs.openSync(path.join(output,'console.jsonl'),'wx',0o600);
    consoleHandler=message=>fs.writeSync(fd,JSON.stringify({time:Date.now(),type:message.type(),text:message.text()})+'\n');
    page.on('console',consoleHandler);
    const observe=async()=>{report.page=await page.evaluate(()=>({state:window.modelPoc.state,report:window.modelPoc.report,events:window.modelPoc.events}));save();};
    if(['load','repeat'].includes(options.mode)) {
      if(!['about:blank','chrome://newtab/'].includes(page.url()))throw Error('Load requires a fresh blank target; existing jobs must be observed');
      await page.goto(options.origin+'/model.html',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.modelPoc?.state==='idle',undefined,{timeout:30000});
      await page.locator('#strict').check();await page.locator('#load').click();
    } else {
      if(new URL(page.url()).origin!==new URL(options.origin).origin)throw Error('Pinned target origin changed');
      await observe();
      if(options.mode==='run') {
        if(!['ready','complete'].includes(report.page.state))throw Error('Existing session is not ready; observe it without restarting');
        if(report.page.state==='complete') {
          const copied=await page.evaluate(()=>window.modelPoc.capturedOutputSha256===window.modelPoc.report.outputSha256);
          if(!copied||report.page.report.type!=='result')throw Error('Capture the previous result before replacing it');
        }
        await page.locator('#case').selectOption(options.case);await page.locator('#run').click();
      }
    }
    const deadline=Date.now()+options.seconds*1000;
    while(true) {
      await observe();const state=report.page.state;
      if(options.mode==='repeat'&&state==='ready') {
        report.ready=report.page.report;
        await page.locator('#case').selectOption(options.case);await page.locator('#run').click();
        report.status='running-first';save();continue;
      }
      if(['ready','complete','error','cancelled'].includes(state)) {
        report.status=state;
        if(state==='complete'&&report.page.report.type==='result') {
          const meta=report.page.report;
          if(report.caseId&&report.caseId!==meta.caseId)throw Error('Output belongs to a different case');
          if(options.mode==='repeat'&&meta.runNumber!==report.runs.length+1)throw Error('Repeat run counter does not match the same worker/session');
          report.caseId=meta.caseId;report.outputFile=options.mode==='repeat'?`run-${meta.runNumber}.f32`:'output.f32';
          Object.assign(report,await copyOutput(page,path.join(output,report.outputFile),meta));
          await page.evaluate(sha=>{window.modelPoc.capturedOutputSha256=sha;},report.outputSha256);
          report.status='complete-output-sha-verified';
          if(options.mode==='repeat') {
            report.runs.push({outputFile:report.outputFile,outputBytes:report.outputBytes,
              outputSha256:report.outputSha256,result:meta});save();
            if(report.runs.length<2) {
              await page.locator('#run').click();report.status='running-repeat';save();continue;
            }
            const readyCount=report.page.events.filter(e=>e.type==='ready').length;
            if(readyCount!==1)throw Error('Repeat observed more than one initialized session');
            report.repeatProof={sameTargetId:report.targetId,readyEvents:readyCount,
              runNumbers:report.runs.map(r=>r.result.runNumber),
              outputSha256Identical:report.runs[0].outputSha256===report.runs[1].outputSha256};
            report.status='repeat-complete-outputs-sha-verified';
          }
        }
        if(options.closeBrowser){const close=await browser.newBrowserCDPSession();await close.send('Browser.close');report.browserClosed=true;}
        save();return ['error','cancelled'].includes(state)?3:0;
      }
      if(Date.now()>=deadline){report.status='observation_timeout_job_not_restarted';save();return 2;}
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
  } catch(error) {report.status='observer_error_job_state_not_assumed';report.error=error.message;save();throw error;}
  finally {if(page&&consoleHandler)page.off('console',consoleHandler);if(fd!==undefined)fs.closeSync(fd);}
}

module.exports={parseArgs,copyOutput};
if(require.main===module) {
  Promise.resolve().then(()=>main(parseArgs(process.argv.slice(2)))).then(code=>process.exit(code))
    .catch(error=>{console.error(error.message);process.exit(1);});
}
