/** Synthetic RGB -> browser resize bundle -> 300dpi crop PNG -> laid-out paper PDF. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {photoPixels,cropBox,paperLayout} from './browser-library-adapter/print-geometry.mjs';
import {createPaperWorkerClient} from './browser-library-adapter/paper-worker-client.mjs';
import {renderPaperRgb} from './browser-library-adapter/paper-rgb.mjs';
import {createSessionTeardown} from './browser-library-adapter/session-teardown.mjs';
import {createWorkerGate} from './browser-library-adapter/worker-gate.mjs';
import {createOperationTracker} from './browser-library-adapter/operation-tracker.mjs';
import {createTrackedOperation} from './browser-library-adapter/tracked-operation.mjs';
import {createImageRenderJob} from './browser-library-adapter/image-render-job.mjs';
import {createPngInputWorkerClient} from './browser-library-adapter/png-input-worker.mjs';
import {createImagePreflight} from './browser-library-adapter/image-preflight.mjs';
import {bindFileInput} from './browser-library-adapter/file-input-binding.mjs';
import {createInputLoad} from './browser-library-adapter/input-load.mjs';
import {createImageRegistry} from './browser-library-adapter/image-registry.mjs';
import {createResizeWorkerClient} from './browser-library-adapter/resize-worker-client.mjs';
import {createExportWorkerClient} from './browser-library-adapter/export-worker-client.mjs';
import {createExportJobs} from './browser-library-adapter/export-job.mjs';
import {createDownloadLinks} from './browser-library-adapter/download-links.mjs';
import {bindSaveLink} from './browser-library-adapter/save-link-binding.mjs';
import {createSaveActions} from './browser-library-adapter/save-actions.mjs';
import {nodeTaskWorker} from '../tests/fixtures/node-export-worker.mjs';
const [dependencies,resizeBundle,exportBundle,output,paperBundle,inputBundle,dimensionsRoot]=process.argv.slice(2);
if(inputBundle&&!dimensionsRoot)throw Error('PNG input mode requires dimensions package directory');
if(!output||fs.existsSync(output))throw Error('Need dependencies, resize/export browser bundles and new output');fs.mkdirSync(output,{mode:0o700});
const reference=JSON.parse(fs.readFileSync(new URL('../docs/browser/validation/2026-11-01-crop-save-reference.json',import.meta.url),'utf8'));
const {decode,encode}=await import(pathToFileURL(path.join(dependencies,'node_modules/fast-png/lib/index.js')).href);
const sha=b=>createHash('sha256').update(b).digest('hex'),registry=createImageRegistry(),raw=new Uint8Array(160*200*3);
for(let y=0;y<200;y++)for(let x=0;x<160;x++)for(let c=0;c<3;c++)raw[(y*160+x)*3+c]=(x*37+y*59+c*83)%256;
assert.equal(sha(raw),reference.sourceRgbSha256);
let source=registry.register({width:160,height:200,format:'rgb-u8',data:raw.buffer},'session');
let created=0,stopped=0,revision='crop-1',paperSha;const proofs=[],assets=[source],controls=[],cases=[],bindings=[];
const pageTarget=new EventTarget();
class Anchor extends EventTarget{
 attributes=new Map();
 setAttribute(name,value){this.attributes.set(name,value);}
 removeAttribute(name){this.attributes.delete(name);}
 getAttribute(name){return this.attributes.get(name)??null;}
}
const worker=(bundle,allowWasm)=>{
 created++;const task=nodeTaskWorker(new URL('../tests/fixtures/browser-export-thread.mjs',import.meta.url),{browserBundle:bundle,allowWasm},96,p=>proofs.push(p));
 return {...task,async terminate(){const result=await task.terminate();stopped++;return result;}};
};
const gate=createWorkerGate(),tracker=createOperationTracker(),operationSnapshots=[];
tracker.subscribe(state=>operationSnapshots.push({kind:state?.kind??null,phase:state?.phase??'idle',created,stopped,gate:gate.getState()}));
const track=(kind,sourceAssetId,run,cancelOwned)=>createTrackedOperation({tracker,gate,describe:()=>({kind,sourceAssetId,dependencyKey:revision}),run,cancelOwned});
const resize=createResizeWorkerClient({gate,createWorker:()=>worker(resizeBundle,true)}),exporter=createExportWorkerClient({gate,createWorker:()=>worker(exportBundle,false)});
const paperRenderer=paperBundle?createPaperWorkerClient({gate,createWorker:()=>worker(paperBundle,false)}):null;
let crop,paper,cropJob,paperJob,inputOwner,inputClient,inputPngSha,inputBinding,selectFile,replacementInvalidated=false,sessionClosing=false;
const jobs=createExportJobs({registry,getCurrent:o=>{if(sessionClosing)return null;const state=(o.kind==='crop'?cropJob:paperJob)?.get();return state?.status==='valid'?{assetId:state.image.id,dependencyKey:revision}:null;},encode:exporter.encode}),links=createDownloadLinks({getReady:jobs.getReady});
const teardown=createSessionTeardown({invalidate(){sessionClosing=true;for(const {binding} of bindings)binding.close();for(const control of controls)control.close();},closeLinks:()=>links.close(),
 stopOperations:[async()=>{await jobs.cancelAndWait();jobs.clear();},()=>paperJob?.close(),()=>cropJob?.close(),async()=>{await inputBinding?.close();await inputOwner?.close();}],
 closeClients:[()=>resize.close(),()=>paperRenderer?.close(),()=>exporter.close(),()=>inputClient?.close()],releaseAssets(){for(const asset of assets)registry.release(asset.id,'session');}});
try{
 if(inputBundle){
  const {imageDimensionsFromData}=await import(pathToFileURL(path.resolve(dimensionsRoot,'index.js')));
  const bytes=encode({width:160,height:200,channels:3,depth:8,data:new Uint8Array(registry.copy(source.id).data)});inputPngSha=sha(bytes);fs.writeFileSync(path.join(output,'input.png'),bytes,{flag:'wx',mode:0o600});
  inputClient=createPngInputWorkerClient({inspect:createImagePreflight({probe:imageDimensionsFromData,maxAxis:4096,maxPixels:4_000_000}),gate,createWorker:()=>worker(inputBundle,false)});
  inputOwner=createInputLoad({registry,tracker,read:inputClient.read});
  const picker=new EventTarget();picker.files=[];picker.value='';let selection;
  inputBinding=bindFileInput({input:picker,owner:inputOwner,pageTarget,onChange:state=>{if(state.phase==='ready')selection?.resolve(state.input);else if(state.phase==='error')selection?.reject(Error(state.errorCode));}});
  selectFile=file=>new Promise((resolve,reject)=>{selection={resolve,reject};picker.files=[file];picker.dispatchEvent(new Event('change'));assert.equal(picker.value,'');});
  const loaded={input:await selectFile(new Blob([bytes]))};assert.equal(created,stopped);
  const previous=source;source=loaded.input.image;registry.retain(source.id,'session');registry.release(previous.id,'session');assets[0]=source;
  assert.equal(sha(new Uint8Array(registry.copy(source.id).data)),reference.sourceRgbSha256);
 }
 const originalInput=source;
 const settings=reference.settings,[width,height]=photoPixels(settings.widthMm,settings.heightMm);
 const box=cropBox({width:160,height:200,outputWidth:width,outputHeight:height,range:settings.range,horizontal:settings.horizontal,vertical:settings.vertical});
 box.forEach((value,i)=>assert.ok(Math.abs(value-reference.box[i])<=1e-9));
 cropJob=createImageRenderJob({registry,getCurrent:()=>({assetId:source.id,dependencyKey:revision,settings}),
  prepare:()=>({options:{width,height,box},output:{width,height}}),render:resize.resize});
 const cropOperation=track('resize',source.id,()=>cropJob.start(),()=>cropJob.cancel());
 const cropRun=await cropOperation.start();assert.equal(cropRun.status,'completed');const cropped=cropRun.value;assert.equal(cropped.status,'ready');crop=cropped.image;
 assert.equal(sha(new Uint8Array(registry.copy(crop.id).data)),reference.rgbSha256);assert.equal(created,stopped);
 registry.retain(crop.id,'session');assets.push(crop);
 paperJob=createImageRenderJob({registry,getCurrent:()=>({assetId:crop.id,dependencyKey:revision,available:cropJob.get()?.status==='valid',settings:{paper:'l',dpi:[300,300]}}),
  prepare:(options,metadata)=>{const layout=paperLayout({paper:options.paper,photoWidth:metadata.width,photoHeight:metadata.height,dpi:options.dpi});return {options,output:{width:layout.width,height:layout.height}};},
  render:async(image,options,hooks)=>(paperRenderer?await paperRenderer.render(image,options,hooks):renderPaperRgb(image,options)).image});
 const paperOperation=track('paper',crop.id,()=>paperJob.start(),()=>paperJob.cancel());
 const paperRun=await paperOperation.start();assert.equal(paperRun.status,'completed');const laidOut=paperRun.value;assert.equal(laidOut.status,'ready');paper=laidOut.image;assert.equal(created,stopped);
 paperSha=sha(new Uint8Array(registry.copy(paper.id).data));registry.retain(paper.id,'session');assets.push(paper);

 for(const options of [{kind:'crop',format:'png'},{kind:'paper',paper:'l',format:'pdf'}]){
  const control=createSaveActions({jobs,links,getOptions:()=>options});controls.push(control);
  const saveOperation=track('export',options.kind==='crop'?crop.id:paper.id,()=>control.generate(),()=>control.cancelAndWait());
  assert.deepEqual(await saveOperation.start(),{status:'completed',value:{status:'ready'}});assert.equal(created,stopped);
  const anchor=new Anchor(),binding=bindSaveLink({anchor,control,pageTarget,onPageHide:()=>links.close()});bindings.push({anchor,binding});
  binding.refresh();const url=anchor.getAttribute('href');assert.ok(url?.startsWith('blob:'));
  const click=new Event('click',{cancelable:true});assert.equal(anchor.dispatchEvent(click),true);assert.equal(click.defaultPrevented,false);
  const response=await fetch(anchor.getAttribute('href')),bytes=new Uint8Array(await response.arrayBuffer());assert.equal(sha(bytes),sha(jobs.getReady(options).bytes));
  const filename=options.kind==='crop'?'crop-300dpi.png':'paper-l.pdf';fs.writeFileSync(path.join(output,filename),bytes,{flag:'wx',mode:0o600});
  if(options.format==='png'){
   const decoded=decode(bytes,{checkCrc:true});assert.deepEqual([decoded.width,decoded.height,decoded.channels],[354,472,3]);assert.equal(sha(decoded.data),reference.rgbSha256);
   let at=8,density=0;const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
   while(at<bytes.length){const length=view.getUint32(at),type=String.fromCharCode(...bytes.subarray(at+4,at+8));if(type==='pHYs'){density++;assert.equal(view.getUint32(at+8),11811);assert.equal(view.getUint32(at+12),11811);assert.equal(bytes[at+16],1);}at+=12+length;}
   assert.equal(density,1);
  }
  cases.push({kind:options.kind,format:options.format,filename,bytes:bytes.length,sha256:sha(bytes),threadTerminationAwaited:true,blobMatchesPreparedBytes:true});
 }
 if(inputBundle){
  const replacementPixels=new Uint8Array(registry.copy(source.id).data);replacementPixels[0]^=128;
  const replacementPng=encode({width:160,height:200,channels:3,depth:8,data:replacementPixels});
  const adopted=await selectFile(new Blob([replacementPng]));source=adopted.image;registry.retain(source.id,'session');assets.push(source);
  assert.equal(created,stopped);assert.notEqual(source.id,originalInput.id);
  for(const control of controls)assert.equal(control.beginDownload(),null);replacementInvalidated=true;
 }
 revision='crop-2';
 const staleUrls=bindings.map(({anchor})=>anchor.getAttribute('href'));
 for(const {anchor} of bindings){const click=new Event('click',{cancelable:true});assert.equal(anchor.dispatchEvent(click),false);assert.equal(anchor.getAttribute('href'),null);assert.equal(anchor.getAttribute('aria-disabled'),'true');}
 assert.equal(links.getState().urls,2); // Previously begun downloads keep their grace period.
 pageTarget.dispatchEvent(new Event('pagehide'));assert.equal(links.getState().urls,0);
 for(const url of staleUrls)await assert.rejects(fetch(url));
 for(const {anchor,binding} of bindings){binding.refresh();assert.equal(anchor.getAttribute('href'),null);}
 if(inputBundle)assert.equal(cropJob.get(),null);else assert.equal(cropJob.get().status,'stale');assert.equal(paperJob.get().status,'stale');
 await assert.rejects(paperJob.start(),e=>e.code==='invalid-render-source');
 for(const options of [{kind:'crop',format:'png'},{kind:'paper',paper:'l',format:'pdf'}])await assert.rejects(jobs.start(options),e=>e.code==='export-source-unavailable');
 assert.equal(sha(new Uint8Array(registry.copy(originalInput.id).data)),reference.sourceRgbSha256);
 assert.ok(proofs.every(p=>p.nodeGlobalsAbsent&&p.dynamicCodeDisabled&&p.networkAttempts===0));
}finally{await teardown.close();}
assert.equal(teardown.getState().phase,'closed');
for(const asset of assets)assert.throws(()=>registry.get(asset.id));
assert.equal(created,stopped);assert.equal(links.getState().urls,0);
assert.deepEqual(gate.getState(),{busy:false,blocked:false});
assert.equal(tracker.getSnapshot(),null);
assert.deepEqual(operationSnapshots.filter(s=>s.phase==='running').map(s=>s.kind),[...(inputBundle?['decode']:[]),'resize','paper','export','export',...(inputBundle?['decode']:[])]);
const idleSnapshots=operationSnapshots.filter(s=>s.phase==='idle');assert.equal(idleSnapshots.length,inputBundle?6:4);
for(const snapshot of idleSnapshots){assert.equal(snapshot.created,snapshot.stopped);assert.deepEqual(snapshot.gate,{busy:false,blocked:false});}
const report={sessionTeardown:teardown.getState(),sessionAssetsReleased:true,filePickerBinding:inputBundle?{syntheticEventTarget:true,replacementInvalidatesExports:replacementInvalidated}:null,inputDecodedFromPng:!!inputBundle,inputPngSha256:inputPngSha,saveLinkBinding:{staleClicksPrevented:true,pagehideRevokedUrls:true,closedBindingsCannotRecreateUrls:true,anchor:'EventTarget attribute double, not browser DOM'},operationTracking:{idleOnlyAfterTermination:true,snapshots:operationSnapshots},sharedWorkerGate:gate.getState(),renderJobsGuarded:true,staleSourcesCannotStartExport:true,paperRenderedOffThread:!!paperBundle,status:'passed',source:[160,200],crop:[354,472],cropRgbSha256:reference.rgbSha256,cropPixelsExact:true,pngDensityPpm:[11811,11811],paperRgbSha256:paperSha,paperPhotoCount:3,cases,workersCreated:created,workersStopped:stopped,proofs,originalPreserved:true,oldRevisionClicksRejected:true,urlsAfterClose:0,limits:[inputBundle?'Synthetic RGB PNG decoded by real codec; not actual photo/ICC/EXIF/alpha or product limit acceptance':'Synthetic raw RGB only, not real photo decode/ICC/EXIF/alpha or production input limit acceptance','Browser bundles in restricted VMs on Node threads; actual browser/UI/CSP/download/print untested',paperBundle?'Paper RGB rendered by actual browser bundle in restricted VM; product wiring remains':'Paper RGB is rendered on diagnostic main thread, production Worker wiring remains','PDF extraction/physical page inspection is separate','No GPU/model/browser started; requested heap limits are not total memory caps']};
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
