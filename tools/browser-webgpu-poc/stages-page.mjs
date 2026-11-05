import config from 'stage-public-config';
import {createStagedHr} from '../browser-library-adapter/staged-hr.mjs';
import {createWorkerGate} from '../browser-library-adapter/worker-gate.mjs';
const status=document.querySelector('#status'),start=document.querySelector('#start'),cancel=document.querySelector('#cancel'),download=document.querySelector('#download');
const gate=createWorkerGate(),events=[];let state='idle',errorCode=null,result=null,url=null,controller;
const runner=createStagedHr({catalog:config.stages,gate,cancellationProtocol:config.cancellationProtocol,createWorker:()=>new Worker(config.worker,{type:'module'}),onStage:event=>{events.push({...event,atMs:performance.now()});if(events.length>128)events.shift();status.textContent=`工程 ${event.index+1} / ${event.count} ${event.phase}`;}});
window.__imageStudioStages=()=>({state,errorCode,result,events:[...events],gate:gate.getState(),runner:runner.getState(),stageCount:config.stages.length});
start.onclick=async()=>{
 if(state!=='idle')return;state='loading-input';start.disabled=true;cancel.disabled=false;controller=new AbortController();
 try{
  const response=await fetch(config.input.url);if(!response.ok)throw Error('input-fetch-failed');
  const data=await response.arrayBuffer();
  const sha=bytes=>crypto.subtle.digest('SHA-256',bytes).then(hash=>[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join(''));
  if(data.byteLength!==config.input.bytes||await sha(data)!==config.input.sha256)throw Error('input-integrity-failed');
  state='running';const features=await runner.run([{...config.stages[0].inputs[0],data}],{signal:controller.signal});
  if(features.length!==1||features[0].name!=='alpha'||features[0].dtype!=='float32'||JSON.stringify(features[0].dims)!=='[1,1,2048,2048]')throw Error('output-contract-failed');
  result={bytes:features[0].data.byteLength,sha256:await sha(features[0].data)};
  url=URL.createObjectURL(new Blob([features[0].data],{type:'application/octet-stream'}));download.href=url;download.download='staged-alpha-2048.f32';download.hidden=false;
  state='complete';status.textContent='46工程を完了。これは画質・公開版の受入完了ではありません。';
 }catch(error){state=controller.signal.aborted?'cancelled':'error';errorCode=controller.signal.aborted?'aborted':typeof error?.code==='string'?error.code:['input-fetch-failed','input-integrity-failed','output-contract-failed'].includes(error?.message)?error.message:'stage-failed';status.textContent=errorCode;}
 finally{cancel.disabled=true;}
};
cancel.onclick=()=>controller?.abort();
window.addEventListener('pagehide',()=>{controller?.abort();void runner.close();if(url)URL.revokeObjectURL(url);},{once:true});
