/** Paper layout -> registry -> export Worker -> save actions -> local Blob URL. No browser/model. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {PAPER_PIXELS} from './browser-library-adapter/paper-contract.mjs';
import {renderPaperRgb} from './browser-library-adapter/paper-rgb.mjs';
import {createImageRegistry} from './browser-library-adapter/image-registry.mjs';
import {createExportJobs} from './browser-library-adapter/export-job.mjs';
import {createExportWorkerClient} from './browser-library-adapter/export-worker-client.mjs';
import {createDownloadLinks} from './browser-library-adapter/download-links.mjs';
import {createSaveActions} from './browser-library-adapter/save-actions.mjs';
import {nodeExportWorker} from '../tests/fixtures/node-export-worker.mjs';
const [root,output,paper='l',photoFile]=process.argv.slice(2);
if(!Object.hasOwn(PAPER_PIXELS,paper))throw Error('Unknown paper');
if(!root||!output||fs.existsSync(output))throw Error('Need private dependency root and new output');
fs.mkdirSync(output,{mode:0o700});
const {decode}=await import(pathToFileURL(path.join(root,'node_modules/fast-png/lib/index.js')).href);
const sha=b=>createHash('sha256').update(b).digest('hex');
let photoWidth=354,photoHeight=472,photoPixels;
if(photoFile){
 const bytes=fs.readFileSync(photoFile);if(bytes.length>20*1024*1024)throw Error('Photo fixture too large');
 const decoded=decode(bytes);
 if(decoded.channels!==3||decoded.depth!==8||decoded.width>4096||decoded.height>4096||decoded.width*decoded.height>4_000_000)throw Error('Need bounded RGB8 photo fixture');
 photoWidth=decoded.width;photoHeight=decoded.height;photoPixels=new Uint8Array(decoded.data);
}else{photoPixels=new Uint8Array(354*472*3);for(let i=0;i<photoPixels.length;i++)photoPixels[i]=(i*13+7)%251;}
const photoSha=sha(photoPixels),sheet=renderPaperRgb({width:photoWidth,height:photoHeight,format:'rgb-u8',data:photoPixels.buffer},{paper,dpi:[300,300]});
const sourceSha=sha(new Uint8Array(sheet.image.data)),registry=createImageRegistry();
const asset=registry.register(sheet.image,'session');
let revision='layout-1',created=0,stopped=0;
const client=createExportWorkerClient({createWorker:()=>{
 created++;const worker=nodeExportWorker({dependencyRoot:root},96);
 return {...worker,async terminate(){const result=await worker.terminate();stopped++;return result;}};
}});
const jobs=createExportJobs({registry,getCurrent:()=>({assetId:asset.id,dependencyKey:revision}),encode:client.encode.bind(client)});
const links=createDownloadLinks({getReady:jobs.getReady}),controls=[],cases=[];
try{
 for(const format of ['png','pdf']){
  const options={kind:'paper',paper,format};
  const control=createSaveActions({jobs,links,getOptions:()=>options});controls.push(control);
  assert.deepEqual(await control.generate(),{status:'ready'});assert.equal(created,stopped);
  const link=control.beginDownload();assert.ok(link);
  const response=await fetch(link.url);assert.equal(response.headers.get('content-type'),format==='png'?'image/png':'application/pdf');
  const bytes=new Uint8Array(await response.arrayBuffer());assert.equal(sha(bytes),sha(jobs.getReady(options).bytes));
  fs.writeFileSync(path.join(output,'layout-'+paper+'.'+format),bytes,{flag:'wx',mode:0o600});
  if(format==='png'){
   const decoded=decode(bytes);assert.equal(decoded.width,sheet.layout.width);assert.equal(decoded.height,sheet.layout.height);assert.equal(decoded.channels,3);
   assert.equal(sha(decoded.data),sourceSha);
  }
  assert.equal(sha(new Uint8Array(registry.copy(asset.id).data)),sourceSha);
  cases.push({format,bytes:bytes.length,sha256:sha(bytes),blobBytesMatchReadyFile:true,workerTerminationAwaited:true,registrySourceUnchanged:true});
 }
 revision='layout-2';for(const control of controls){assert.equal(control.beginDownload(),null);assert.equal(control.getState().phase,'stale');}
 assert.equal(sha(photoPixels),photoSha);
}finally{
 for(const control of controls)control.close();links.close();await client.close();jobs.clear();registry.release(asset.id,'session');
}
assert.equal(created,stopped);assert.equal(links.getState().urls,0);
const report={status:'passed',paper,photo:[photoWidth,photoHeight],sheet:[sheet.layout.width,sheet.layout.height],positions:sheet.layout.positions,sourceRgbSha256:sourceSha,photoRgbSha256:photoSha,cases,workersCreated:created,workersStopped:stopped,urlsAfterClose:0,staleClicksRejectedForBothFormats:true,photoPreserved:true,limits:['Node thread facade, not an actual browser Worker or rendered UI','Local Node Blob reads, not browser download or disk-save acceptance','One paper per invocation; actual printer and independent PDF extraction checked separately','No GPU/model/browser started; requested heap settings do not guarantee total memory limits']};
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
