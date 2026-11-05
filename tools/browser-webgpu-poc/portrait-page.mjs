import {RawImage} from 'transformers-candidate';
import config from 'portrait-public-config';
import {createWorkerClient} from '../browser-library-adapter/worker-client.mjs';
import {createWorkerGate} from '../browser-library-adapter/worker-gate.mjs';
import {createForegroundWorkerClient} from '../browser-library-adapter/foreground-worker-client.mjs';
import {createExportWorkerClient} from '../browser-library-adapter/export-worker-client.mjs';
const gate=createWorkerGate(),events=[],urls=[];
let state='idle',phase='idle',errorCode=null,result=null,cancelled=false;
const status=document.querySelector('#status'),start=document.querySelector('#start'),cancel=document.querySelector('#cancel');
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
const pause=()=>new Promise(resolve=>setTimeout(resolve,1500));
const current=()=>{if(cancelled)throw Error('aborted');};
const publish=value=>{phase=value;status.textContent=value;};
const model=createWorkerClient({gate,createWorker:()=>new Worker(config.workers.model),onEvent:event=>{
 const entry={type:event.type,atMs:performance.now()};if(event.type==='error')entry.code=event.code;
 if(event.type==='resource-state')entry.storedBytes=event.resources.filter(f=>f.stored).reduce((n,f)=>n+f.bytes,0);
 events.push(entry);if(events.length>64)events.shift();
}});
const foreground=createForegroundWorkerClient({gate,rgba:true,createWorker:()=>new Worker(config.workers.foreground)});
const encoder=createExportWorkerClient({gate,createWorker:()=>new Worker(config.workers.export)});
const close=()=>Promise.allSettled([model.cancel(),foreground.close(),encoder.close()]);
window.__imageStudioPortrait=()=>({state,phase,errorCode,result,events:[...events],gate:gate.getState(),model:model.getState()});
function link(id,data,mime,name){const url=URL.createObjectURL(new Blob([data],{type:mime}));urls.push(url);const element=document.querySelector(id);element.href=url;element.download=name;element.hidden=false;}
start.onclick=async()=>{
 if(state!=='idle')return;state='running';start.disabled=true;cancel.disabled=false;const started=performance.now();
 try{
  publish('decode');const response=await fetch(config.fixture.url);if(!response.ok)throw Error('fixture-fetch-failed');const bytes=await response.arrayBuffer();
  if(await sha(bytes)!==config.fixture.sha256)throw Error('fixture-integrity-failed');
  const image=(await RawImage.fromBlob(new Blob([bytes],{type:'image/png'}))).rgb(),rgb=Uint8Array.from(image.data);
  if(image.width!==1086||image.height!==1448||rgb.length!==image.width*image.height*3)throw Error('fixture-dimensions-failed');
  result={width:image.width,height:image.height,decodedRgbSha256:await sha(rgb),prepareMs:0,runs:[],png:{}};current();
  publish('prepare');let mark=performance.now();await model.request(config.prepare);result.prepareMs=performance.now()-mark;await pause();current();
  let alpha;
  for(let index=0;index<3;index++){
   publish('infer-'+index);mark=performance.now();
   const event=await model.request({type:'infer',key:{inputId:'fixed-synthetic-portrait',inferenceRevision:index+1,modelVersion:config.prepare.modelVersion},refine:false,rgb:{width:image.width,height:image.height,layout:'rgb-u8-interleaved',data:rgb.buffer.slice(0)}});
   const elapsedMs=performance.now()-mark;alpha=event.alpha;
   result.runs.push({index,requestWallMs:elapsedMs,alphaSha256:await sha(alpha.data)});await pause();current();
  }
  publish('dispose');await model.request({type:'dispose'});current();
  link('#alpha',alpha.data,'application/octet-stream','modnet-alpha.u8');
  const counts=[0,0,0];for(const value of new Uint8Array(alpha.data))counts[value===0?0:value===255?2:1]++;
  result.alphaCounts={transparent:counts[0],partial:counts[1],opaque:counts[2]};
  publish('foreground');mark=performance.now();const cutout=await foreground.estimate({width:image.width,height:image.height,rgb:rgb.slice(),alpha:new Uint8Array(alpha.data.slice(0))});result.foregroundMs=performance.now()-mark;await foreground.close();current();
  for(const [kind,options] of [['transparent',{kind:'transparent'}],['white',{kind:'background',backgroundColor:[255,255,255]}]]){
   publish('export-'+kind);mark=performance.now();const file=await encoder.encode({...cutout,data:cutout.data.slice(0)},options);result.png[kind]={bytes:file.bytes.length,sha256:await sha(file.bytes),encodeWallMs:performance.now()-mark};link('#'+kind,file.bytes,'image/png','modnet-'+kind+'.png');current();
  }
  await encoder.close();result.totalWallMs=performance.now()-started;
  if(gate.getState().busy||gate.getState().blocked)throw Error('resources-active');
  state='complete';publish('complete');
 }catch(error){state=cancelled?'cancelled':'error';errorCode=cancelled?'aborted':typeof error?.code==='string'&&['runtime-error','invalid-input','invalid-result','unsupported-model','worker-stop-failed'].includes(error.code)?error.code:'portrait-benchmark-failed';publish(errorCode);}
 finally{await close();cancel.disabled=true;}
};
cancel.onclick=()=>{cancelled=true;void close();};
window.addEventListener('pagehide',()=>{cancelled=true;void close();for(const url of urls)URL.revokeObjectURL(url);},{once:true});
