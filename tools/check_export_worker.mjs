/** Actual PNG/PDF codecs in separate Node threads; synthetic pixels only. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {nodeExportWorker} from '../tests/fixtures/node-export-worker.mjs';
import {createExportWorkerClient} from './browser-library-adapter/export-worker-client.mjs';
import {createExportJobs} from './browser-library-adapter/export-job.mjs';
import {createImageRegistry} from './browser-library-adapter/image-registry.mjs';
const [root,output,browserBundle]=process.argv.slice(2);
if(!output||fs.existsSync(output))throw Error('Need private dependency root and new output');fs.mkdirSync(output,{mode:0o700});
const registry=createImageRegistry(),sha=b=>createHash('sha256').update(b).digest('hex'),rss=[process.memoryUsage().rss];
const background=Uint8Array.of(245,243,239,20,80,160,80,100,120,250,240,230);
const paper=new Uint8Array(1500*1051*3).fill(255);
for(const [x,y,color] of [[0,0,[10,20,30]],[1499,1050,[200,100,50]],[750,525,[32,96,192]]])paper.set(color,(y*1500+x)*3);
const hashes={background:sha(background),paper:sha(paper)};
const assets={background:registry.register({width:2,height:2,format:'rgb-u8',data:background.buffer},'session'),paper:registry.register({width:1500,height:1051,format:'rgb-u8',data:paper.buffer},'session')};
let created=0,stopped=0;const sandboxProof=[];
const client=createExportWorkerClient({createWorker:()=>{
 created++;const worker=nodeExportWorker(browserBundle?{browserBundle}:{dependencyRoot:root},96,proof=>sandboxProof.push(proof));
 return {...worker,async terminate(){const result=await worker.terminate();stopped++;return result;}};
}});
const jobs=createExportJobs({registry,getCurrent:options=>({assetId:assets[options.kind].id,dependencyKey:'fixture-1'}),encode:client.encode.bind(client)});
const cases=[];
try{
 for(const options of [{kind:'background',format:'png'},{kind:'paper',paper:'l',format:'pdf'}]){
  const result=await jobs.start(options);assert.equal(result.status,'ready');assert.equal(created,stopped);assert.equal(client.getState().busy,false);
  const name=options.format==='png'?'background.png':'paper-l.pdf';fs.writeFileSync(path.join(output,name),result.file.bytes,{flag:'wx',mode:0o600});
  const original=registry.copy(assets[options.kind].id);assert.equal(sha(new Uint8Array(original.data)),hashes[options.kind]);
  cases.push({kind:options.kind,format:options.format,width:result.file.width,height:result.file.height,bytes:result.file.bytes.length,sha256:sha(result.file.bytes),originalRgbSha256:hashes[options.kind],originalPreserved:true,terminationAwaited:true});rss.push(process.memoryUsage().rss);
 }
}finally{await client.close();jobs.clear();for(const asset of Object.values(assets))registry.release(asset.id,'session');}
assert.equal(created,stopped);
if(browserBundle){assert.equal(sandboxProof.length,2);assert.ok(sandboxProof.every(p=>p.nodeGlobalsAbsent&&p.wasmAbsent&&p.dynamicCodeDisabled&&p.networkAttempts===0));}
const report={status:'passed',browserBundle:!!browserBundle,sandboxProof,cases,workersCreated:created,workersStopped:stopped,configuredMainOldSpaceMiB:64,configuredWorkerOldGenerationMiB:96,currentProcessRssSamplesBytes:rss,limitations:[browserBundle?'Browser-targeted bundle ran in a restricted VM on Node threads; actual browser Worker/CSP remains untested.':'Node threads with test-only Worker API facade; production browser bundle integration remains incomplete.','Only 2x2 PNG and one synthetic L-size PDF; other paper sizes and complex layouts untested.','RSS includes process-wide allocator/thread effects; samples after completion do not measure worker peaks.','No browser save dialog, actual printing, model or GPU tested.']};
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
