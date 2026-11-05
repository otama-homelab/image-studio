if(process.env.PLAN36_DISPOSABLE_BROWSER!=='1')throw Error('Use only a task-owned disposable browser; set PLAN36_DISPOSABLE_BROWSER=1');
const {chromium}=require(process.env.PLAYWRIGHT_CORE_PATH || 'playwright-core');
const path=require('path');
const repo=path.resolve(__dirname,'..');
const fs=require('fs');
(async()=>{
 const browser=await chromium.connectOverCDP(process.env.PROTOTYPE_CDP || 'http://127.0.0.1:17862');
 const page=browser.contexts()[0].pages()[0];const errors=[],checks=[];
 page.on('pageerror',e=>errors.push(e.message));
 const action=a=>page.locator(`[data-action="${a}"]`);
 const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS '+name);};
 const assert=async(ok,msg)=>{if(!await ok)throw Error(msg);};
 const go=async name=>{await page.getByRole('navigation').getByRole('link',{name,exact:true}).click();};
 const finish=async()=>{await page.locator('#late').click();};
 try{
  await page.setViewportSize({width:1280,height:900});
  await page.goto((process.env.PROTOTYPE_ORIGIN || 'http://127.0.0.1:17863')+'/prototype/',{waitUntil:'domcontentloaded'});
  await page.locator('.review summary').click();
  await check('UX2 direct crop without model',async()=>{
   await go('サイズ・配置');await action('choose').click();await action('start').click();await finish();
   await assert(action('save:写真PNG・300dpi').isVisible(),'crop save missing');
   await assert(page.locator('main').innerText().then(t=>t.includes('354×472px')),'crop size incorrect');
   await assert(page.evaluate(()=>session.cache===false),'manual acquired model');
   await action('save:写真PNG・300dpi').click();
  });
  await check('UX3 direct print PDF',async()=>{
   await go('印刷配置');await action('choose').click();await action('start').click();await finish();
   await action('save:用紙PDF').click();
   await assert(page.locator('#announcement').innerText().then(t=>t.includes('ファイルは生成しません')),'save simulation missing');
  });
  await check('UX1 preparation comparison and two save formats',async()=>{
   await go('背景編集');await action('choose').click();await action('start').click();
   await assert(page.locator('#dialog-body').innerText().then(t=>t.includes('10MiB')),'capacity missing');
   await page.locator('#dialog-ok').click();await finish();
   await action('save:背景付きPNG').click();await action('save:透過PNG').click();
   await page.locator('#comparison').fill('100');
   await assert(page.locator('#photo-before').getAttribute('width').then(t=>t==='280'),'comparison endpoint incorrect');
   await page.locator('#transparent').check();
   await assert(page.locator('#stage').evaluate(el=>el.classList.contains('transparent')),'checker not shown');
  });
  await check('UX6 explicit transfer stale descendant refresh',async()=>{
   await action('transfer:crop').click();await page.locator('#dialog-ok').click();
   await action('start').click();await finish();
   await go('背景編集');await page.locator('#color').fill('#FFFFFF');await page.locator('#color').press('Tab');
   await go('サイズ・配置');await assert(action('refresh').isVisible(),'refresh missing');
   await assert(action('save:写真PNG・300dpi').count().then(n=>n===0),'stale save present');
   await action('refresh').click();await action('start').click();await finish();
  });
  await check('UX7 cancel photo replacement keeps input',async()=>{
   const old=await page.evaluate(()=>session.stages.crop.input.id);
   await action('choose').click();await page.locator('#dialog-cancel').click();
   await assert(page.evaluate(id=>session.stages.crop.input.id===id,old),'cancel replaced photo');
  });
  await check('invalid draft blocks save and escape restores committed setting',async()=>{
   await page.locator('#width').fill('');await page.locator('#width').press('Tab');
   await assert(action('save:写真PNG・300dpi').count().then(n=>n===0),'invalid draft saved');
   await page.locator('#width').press('Escape');
   await assert(page.locator('#width').inputValue().then(v=>v==='30'),'escape did not restore');
  });
  await check('zoom and pan keep crop revision',async()=>{
   const rev=await page.evaluate(()=>session.stages.crop.revision);
   await action('view:100').click();await action('view:plus').click();await action('pan:right').click();
   await assert(page.evaluate(r=>session.stages.crop.revision===r,rev),'zoom changed crop');
   await assert(page.locator('#zoom-label').innerText().then(t=>t==='125%'),'zoom label incorrect');
  });
  await check('UX4 download failure explicit retry and cancel late completion',async()=>{
   await go('背景編集');await page.locator('#clear-cache').click();await page.locator('#dialog-ok').click();
   await page.locator('#fault').selectOption('download');await action('start').click();await page.locator('#dialog-ok').click();await finish();
   await assert(action('retry').isVisible(),'retry missing');await action('retry').click();
   await action('cancel').click();await finish();
   await assert(page.evaluate(()=>session.job===null),'cancel failed');
  });
  await check('UX5 GPU unavailable has manual route',async()=>{
   await page.locator('#gpu').uncheck();await action('start').click();
   await assert(action('input-crop').isVisible(),'GPU manual route missing');
   await action('input-crop').click();await page.locator('#dialog-ok').click();
   await action('start').click();await finish();await assert(action('save:写真PNG・300dpi').isVisible(),'manual fallback failed');
  });
  await check('UX9 non300dpi and oversized print recovery',async()=>{
   await go('印刷配置');await page.getByText('レビュー用の入力異常',{exact:true}).click();
   await action('bad-dpi').click();await page.locator('#dialog-ok').click();await action('start').click();
   await assert(action('input-crop').isVisible(),'DPI crop route missing');
   await page.getByText('レビュー用の入力異常',{exact:true}).click();await action('oversized').click();await page.locator('#dialog-ok').click();await action('start').click();
   await assert(page.locator('#recovery-region').innerText().then(t=>t.includes('収まりません')),'fit reason missing');
  });
  await check('UX8 browser history retains input',async()=>{
   const id=await page.evaluate(()=>session.stages.crop.input.id);await go('サイズ・配置');await go('背景編集');await page.goBack();
   await assert(page.evaluate(v=>session.stages.crop.input.id===v,id),'history lost input');
  });

  await check('skip link keeps current route and moves focus to main',async()=>{
   await go('サイズ・配置');await page.locator('.skip').focus();await page.locator('.skip').press('Enter');
   await assert(page.evaluate(()=>session.screen==='crop' && document.activeElement.id==='main'),'skip link changed route');
  });
  await check('dialog cancellation restores opener focus',async()=>{
   await action('choose').click();await assert(page.locator('#dialog-cancel').evaluate(el=>el===document.activeElement),'dialog initial focus');
   await page.locator('#dialog-cancel').press('Escape');
   await assert(action('choose').evaluate(el=>el===document.activeElement),'dialog return focus');
  });
  await check('crop range changes diagram and invalid draft has nearby explanation',async()=>{
   const before=await page.locator('.stage svg').getAttribute('viewBox');
   await page.locator('#range-number').fill('50');await page.locator('#range-number').press('Enter');
   await assert(page.locator('.stage svg').getAttribute('viewBox').then(v=>v!==before),'crop diagram did not change');
   await page.locator('#width').fill('');await page.locator('#width').press('Enter');
   await assert(page.locator('#width-error').isVisible(),'nearby error missing');await page.locator('#width').press('Escape');
  });
  await check('zoom overflows only image viewport and direction buttons pan it',async()=>{
   await page.setViewportSize({width:390,height:900});await action('view:100').click();
   for(let i=0;i<11;i++)await action('view:plus').click();
   await assert(page.locator('#stage').evaluate(el=>el.scrollWidth>el.clientWidth),'zoom viewport did not scroll');
   await action('pan:right').click();await assert(page.locator('#stage').evaluate(el=>el.scrollLeft>0),'pan did not move');
   await action('view:fit').click();
  });
  await check('storage corruption allocation shape and save failures expose recovery',async()=>{
   await go('背景編集');await page.locator('#gpu').check();
   for(const fault of ['quota','corrupt','memory','shape','save']){
    await page.locator('#fault').selectOption(fault);await action('start').click();
    if(await page.locator('#dialog').evaluate(el=>el.open))await page.locator('#dialog-ok').click();
    await finish();await assert(page.evaluate(code=>session.failure?.code===code,fault),`fault missing ${fault}`);
    await assert(page.locator('#recovery-region button').count().then(n=>n>0),'no recovery action');
    if(fault==='quota'){await action('recover:cache').click();await page.locator('#dialog-ok').click();}
   }
   await action('retry').click();await finish();await assert(page.evaluate(()=>session.failure===null),'retry failed');
  });
  await check('offline missing cache refuses background and connection recovery preserves photo',async()=>{
   const id=await page.evaluate(()=>session.stages.background.input.id);
   await page.locator('#clear-cache').click();await page.locator('#dialog-ok').click();await page.locator('#online').uncheck();
   await action('start').click();if(await page.locator('#dialog').evaluate(el=>el.open))await page.locator('#dialog-ok').click();
   await assert(action('recover:connection').isVisible(),'offline recovery missing');await action('recover:connection').click();
   await assert(page.evaluate(v=>session.online && session.stages.background.input.id===v,id),'offline recovery lost photo');
  });
  await check('reload keeps route but clears transient photos',async()=>{
   await go('サイズ・配置');page.once('dialog',d=>d.accept());await page.reload({waitUntil:'domcontentloaded'});
   await assert(page.evaluate(()=>session.screen==='crop' && Object.values(session.stages).every(s=>s.input===null)),'reload state incorrect');
  });
  for(const width of [1280,390,320]){
   await page.setViewportSize({width,height:900});
   for(const name of ['開始','背景編集','サイズ・配置','印刷配置']){
    await go(name);
    await assert(page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${width} ${name}`);
   }
  }
  await page.setViewportSize({width:1280,height:900});await go('サイズ・配置');await action('choose').click();await action('start').click();await page.locator('.review summary').click();await finish();await page.locator('.review summary').click();
  await page.screenshot({path:path.join(repo,'docs/browser/validation/2026-10-31-prototype-pc.png'),fullPage:true});
  await page.setViewportSize({width:390,height:900});
  await page.screenshot({path:path.join(repo,'docs/browser/validation/2026-10-31-prototype-narrow.png'),fullPage:true});
  await assert(errors.length===0,errors.join('\n'));
  fs.writeFileSync(path.join(repo,'docs/browser/validation/2026-10-31-prototype-browser-review.json'),JSON.stringify({scope:'Automated C08 dummy UI interaction review; not human UX, real files, model or accessibility acceptance',browser:browser.version(),gpu:'disabled for low resource UI review',tabs:1,checks,layoutWidths:[1280,390,320],errors},null,2)+'\n');
  console.log(JSON.stringify({checks,errors}));
 }catch(e){console.error(e.stack);process.exitCode=1;}finally{
  try{const cdp=await browser.newBrowserCDPSession();await cdp.send('Browser.close');}finally{await browser.close();}
 }
})();
