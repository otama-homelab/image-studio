import {imageDimensionsFromData} from 'image-dimensions';
import {createImagePreflight} from './image-preflight.mjs';
import {createJpegInputWorkerClient} from './jpeg-input-worker.mjs';
import {measureJpegRgb} from './jpeg-reference-metrics.mjs';
const fixtures=__JPEG_FIXTURES__,workerSource=__JPEG_WORKER__;
const start=document.querySelector('#start'),cancel=document.querySelector('#cancel'),output=document.querySelector('#output'),download=document.querySelector('#download');
let active=null,closed=false,reportUrl;
const bytes=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
const releaseReport=()=>{download.removeAttribute('href');if(reportUrl)URL.revokeObjectURL(reportUrl);reportUrl=null;};
start.addEventListener('click',async()=>{
 if(active||closed)return;releaseReport();start.disabled=true;cancel.disabled=false;
 const abort=new AbortController(),url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));let created=0,terminationRequests=0;
 const client=createJpegInputWorkerClient({inspect:createImagePreflight({probe:imageDimensionsFromData,maxAxis:64,maxPixels:4096}),createWorker(){created++;const worker=new Worker(url);return {addEventListener:worker.addEventListener.bind(worker),removeEventListener:worker.removeEventListener.bind(worker),postMessage:worker.postMessage.bind(worker),terminate(){terminationRequests++;worker.terminate();}};}});
 active={abort,client};const report={status:'measuring',cases:[],workersCreated:0,terminationRequests:0,limits:['Synthetic JPEG only; ICC/CMYK/progressive and large images untested','Color differences are measurements; product tolerance remains undecided','Browser terminate requests do not prove immediate physical RAM release']};
 try{
  for(const fixture of fixtures){
   if(abort.signal.aborted)throw Error();
   const image=await client.read(new Blob([bytes(fixture.jpeg)],{type:'image/jpeg'}),{signal:abort.signal});
   report.cases.push({orientation:fixture.orientation,...measureJpegRgb(image,{width:fixture.width,height:fixture.height,data:bytes(fixture.rgb)})});
   if(!closed)output.textContent=JSON.stringify({status:'measuring',completed:report.cases.length,total:fixtures.length},null,2);
  }
  report.status='measured';
 }catch{report.status=abort.signal.aborted?'cancelled':'failed';}
 finally{
  try{await client.close();}catch{report.status='stop-failed';}
  URL.revokeObjectURL(url);report.workersCreated=created;report.terminationRequests=terminationRequests;active=null;
  if(!closed){output.textContent=JSON.stringify(report,null,2);reportUrl=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'}));download.href=reportUrl;download.download='jpeg-orientation-report.json';start.disabled=false;cancel.disabled=true;}
 }
});
cancel.addEventListener('click',()=>active?.abort.abort());
addEventListener('pagehide',()=>{closed=true;active?.abort.abort();if(active)void active.client.close().catch(()=>{});releaseReport();});
