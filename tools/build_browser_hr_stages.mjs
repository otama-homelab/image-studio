import {MAX_HR_STAGES} from './browser-library-adapter/stage-tensors.mjs';
/** Assemble the checked HR partitions with existing library/Worker primitives. No model execution. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const [rootText,partsText,outputText,caseId='reference-square-2000',workerLifetime='per-stage',workerLimitText,reviewFlag,executionProvider='webgpu',cpuThreadsText='1']=process.argv.slice(2);
if(!['per-stage','per-run'].includes(workerLifetime)||process.argv.length>11)throw Error('Explicit per-stage or per-run worker lifetime required');
if(!['webgpu','wasm'].includes(executionProvider))throw Error('Explicit WebGPU or WASM provider required');
if(reviewFlag!==undefined&&reviewFlag!=='--review-source-map'&&reviewFlag!=='--no-source-map')throw Error('Unknown review option');
const numThreads=Number(cpuThreadsText);
if(![1,2].includes(numThreads)||(executionProvider!=='wasm'&&numThreads!==1))throw Error('CPU threads must be 1 or 2');
const reviewSourceMap=reviewFlag==='--review-source-map';
if(!rootText||!partsText||!outputText)throw Error('Need PRIVATE_EVALUATION_ROOT PACKED_STAGES NEW_OUTPUT');
const maxStagesPerWorker=workerLimitText===undefined?(workerLifetime==='per-run'?46:1):Number(workerLimitText);
if(!Number.isSafeInteger(maxStagesPerWorker)||maxStagesPerWorker<1||maxStagesPerWorker>(executionProvider==='wasm'?MAX_HR_STAGES:46)||(workerLifetime==='per-stage'&&maxStagesPerWorker!==1))throw Error('Invalid stage Worker job limit');
const root=fs.realpathSync(rootText),parts=fs.realpathSync(partsText),output=path.resolve(outputText),repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),sha=b=>createHash('sha256').update(b).digest('hex');
if(!parts.startsWith(root+path.sep)||!output.startsWith(root+path.sep)||fs.existsSync(output))throw Error('New private output required');
const reportBytes=fs.readFileSync(path.join(parts,'report.json')),report=JSON.parse(reportBytes),evidence=JSON.parse(fs.readFileSync(path.join(repo,executionProvider==='wasm'?'docs/browser/validation/2026-11-03-hr-cpu-stage-artifacts.json':'docs/browser/validation/2026-11-01-hr-stage-artifacts.json')));
if(report.status!=='packed-checked-not-executed'||sha(reportBytes)!==evidence.reportSha256||report.stage_count!==(evidence.stageCount??46)||!report.runtime_nodes_preserved_exactly_once||!report.artifacts.every(a=>a.checker_passed&&a.logical_initializer_bytes_preserved))throw Error('Checked HR partitions required');
if(workerLifetime==='per-run'&&report.stage_count>(executionProvider==='wasm'?MAX_HR_STAGES:46))throw Error('Large CPU catalog requires per-stage workers');
const baseDirectory=path.join(root,'model-release-local-policy-06'),base=JSON.parse(fs.readFileSync(path.join(baseDirectory,'local-runtime-policy.json'))),origin=new URL(base.appOrigin);
if(origin.origin!==base.appOrigin||origin.protocol!=='http:'||!['127.0.0.1','localhost'].includes(origin.hostname)||origin.port!=='17861')throw Error('Loopback validation origin required');
const mounts=[];
const add=(route,source,expected,{weight=false}={})=>{
 source=fs.realpathSync(source);if(!source.startsWith(root+path.sep)||!route.startsWith('/')||new URL(route,origin).origin!==origin.origin||mounts.some(m=>m.route===route))throw Error('Invalid mount');
 const stat=fs.statSync(source);if(!stat.isFile()||stat.size!==expected.bytes||(!weight&&sha(fs.readFileSync(source))!==expected.sha256))throw Error('Captured artifact changed');
 mounts.push({route,source,bytes:expected.bytes,sha256:expected.sha256,verification:weight?'Existing streamed resource policy verifies before use':'Build-time SHA verified'});
};
const releaseId='staged-hr-'+sha(reportBytes).slice(0,24),configFile=path.join(baseDirectory,'hr/config.json'),configBytes=fs.readFileSync(configFile),configRecord={bytes:configBytes.length,sha256:sha(configBytes)};
const stages=report.stages.map((stage,index)=>{
 const localModelPath=origin.origin+`/models/${releaseId}/stage-${String(index).padStart(3,'0')}/`;
 const resources=[{name:'config.json',url:localModelPath+'hr/config.json',...configRecord}];add(new URL(resources[0].url).pathname,configFile,configRecord);
 for(const file of report.artifacts[index].files){
  const name=file.name.endsWith('.onnx')?'onnx/model_fp16.onnx':'onnx/model.onnx.data',url=localModelPath+'hr/'+name;
  resources.push({name,url,bytes:file.bytes,sha256:file.sha256});add(new URL(url).pathname,path.join(parts,file.name),file,{weight:name.endsWith('.data')});
 }
 const ports=kind=>stage.ports[kind].map(p=>({name:p.name,dtype:p.dtype==='FLOAT16'?'float16':p.dtype==='FLOAT'?'float32':'invalid',dims:p.shape}));
 return {inputs:ports('input'),outputs:ports('output'),localModelPath,release:{model:'hr',modelVersion:releaseId+'-'+index,releaseId,cacheNamespace:'image-studio-'+releaseId,resources}};
});
if(JSON.stringify(stages[0].inputs)!==JSON.stringify([{name:'pixels',dtype:'float16',dims:[1,3,2048,2048]}])||stages.at(-1).outputs[0].name!=='alpha')throw Error('Full HR boundary contract required');
const policy={workerLifetime,maxStagesPerWorker,scope:'local-validation-only-not-approved-for-distribution',distributionApproved:false,appOrigin:origin.origin,wasmOrigin:base.wasmOrigin,runtimeAssets:base.runtimeAssets,profile:{...base.profiles.hr,executionProvider,...(numThreads===2?{numThreads}:{})},stages};
const runtime=JSON.parse(fs.readFileSync(path.join(root,'runtime-staging-02/manifest.json')));
for(const file of runtime.files)add(new URL(base.runtimeAssets[file.name.endsWith('.mjs')?'mjs':'wasm']).pathname,path.join(root,'runtime-staging-02',file.hosting,file.key),file);
for(const file of runtime.notices)add('/runtime/ort/'+runtime.version+'/'+file.file,path.join(root,'runtime-staging-02/pages/runtime/ort',runtime.version,file.file),file);
const transformer=path.join(root,'transformersjs-reuse-review-01/npm-4.3.2/package/dist/transformers.web.js'),ort=path.join(root,'runtime-packages/ort-web-1.31.1/package/dist/ort.webgpu.bundle.min.mjs'),hash=path.join(root,'hash-wasm-reuse-01/package/dist/sha256.umd.min.js');
const pin=JSON.parse(fs.readFileSync(path.join(root,'model-real-policy-worker-build-06/report.json'))).sourceSha256;
for(const [name,file] of Object.entries({transformers:transformer,ort,hash}))if(sha(fs.readFileSync(file))!==pin[name])throw Error('Unverified library asset');
const noticeRoot=path.join(repo,'docs/browser/runtime-notices'),noticeIndex=JSON.parse(fs.readFileSync(path.join(noticeRoot,'library-sources.json')));
if(noticeIndex.status!=='candidate-library-documents-not-full-bundle-audit'||noticeIndex.libraries.transformers.bundleSha256!==pin.transformers||noticeIndex.libraries.hashWasm.bundleSha256!==pin.hash)throw Error('Matching library notice evidence required');
const libraryNotices=noticeIndex.documents.map(document=>{
 if(!/^(?:NOTICE|[A-Za-z0-9.-]+-LICENSE)\.txt$/.test(document.file))throw Error('Invalid library notice filename');
 const bytes=fs.readFileSync(path.join(noticeRoot,document.file));if(bytes.length!==document.bytes||sha(bytes)!==document.sha256)throw Error('Library notice mismatch');
 return {...document,content:bytes};
});
fs.mkdirSync(output,{mode:0o700});fs.mkdirSync(path.join(output,'app'),{mode:0o700});fs.writeFileSync(path.join(output,'stage-policy.json'),JSON.stringify(policy,null,2)+'\n');
const esbuild=createRequire(import.meta.url)(path.join(root,'png-export-01/node_modules/esbuild/lib/main.js'));
const bundle=async(entry,file,virtual,format)=>esbuild.build({entryPoints:[path.join(repo,entry)],outfile:file,bundle:true,minify:true,platform:'browser',format,target:'es2022',legalComments:'linked',metafile:reviewSourceMap,sourcemap:reviewSourceMap&&path.basename(file)==='stage-worker.js'?'external':false,logLevel:'silent',alias:{'transformers-candidate':transformer,'ort-candidate':ort,'onnxruntime-web/webgpu':ort,'onnxruntime-common':ort,'hash-candidate':hash},plugins:[{name:'fixed-stage-policy',setup(b){b.onResolve({filter:/^(stage-policy|stage-public-config)$/},args=>({path:args.path,namespace:'stage'}));b.onLoad({filter:/.*/,namespace:'stage'},args=>({contents:JSON.stringify(virtual[args.path]),loader:'json'}));}}]});
try{
 const worker=path.join(output,'stage-worker.js');const workerBuild=await bundle('tools/browser-library-adapter/browser-stage-worker.mjs',worker,{'stage-policy':policy},'iife');
 if(reviewSourceMap)fs.writeFileSync(path.join(output,'review-metafile.json'),JSON.stringify(workerBuild.metafile,null,2)+'\n');
 const workerRoute='/validation-workers/'+sha(fs.readFileSync(worker))+'/stage-worker.js';add(workerRoute,worker,{bytes:fs.statSync(worker).size,sha256:sha(fs.readFileSync(worker))});
 for(const notice of libraryNotices){const file=path.join(output,notice.file);fs.writeFileSync(file,notice.content,{flag:'wx',mode:0o600});add(path.posix.dirname(workerRoute)+'/'+notice.file,file,notice);}
 for(const file of fs.readdirSync(output).filter(n=>n.endsWith('.LEGAL.txt'))){const source=path.join(output,file),bytes=fs.readFileSync(source);add(path.posix.dirname(workerRoute)+'/'+file,source,{bytes:bytes.length,sha256:sha(bytes)});}
 const reference=JSON.parse(fs.readFileSync(path.join(repo,'docs/browser/validation/2026-10-31-birefnet-fp32-means-native-all-cases.json'))).cases.find(c=>c.case_id===caseId);
 const captured=JSON.parse(fs.readFileSync(path.join(root,'birefnet-inputs-01/inputs.json'))).cases.find(c=>c.id===caseId);
 if(!reference||!captured||captured.file!==caseId+'.f16'||captured.dtype!=='float16'||captured.bytes!==25165824||JSON.stringify(captured.shape)!=='[1,3,2048,2048]'||captured.sha256!==reference.report.prepared_input_sha256)throw Error('Fixed HR reference input required');
 const input={url:origin.origin+'/inputs/'+captured.file,bytes:captured.bytes,sha256:captured.sha256};
 add(new URL(input.url).pathname,path.join(root,'birefnet-inputs-01',captured.file),input);
 const config={cancellationProtocol:'cooperative-stage-cancel-v1',stages:stages.map(({inputs,outputs})=>({inputs,outputs})),worker:origin.origin+workerRoute,input};
 const page=path.join(output,'app/stages-page.js');await bundle('tools/browser-webgpu-poc/stages-page.mjs',page,{'stage-public-config':config},'esm');
 for(const file of fs.readdirSync(path.dirname(page))){const source=path.join(path.dirname(page),file),bytes=fs.readFileSync(source);add('/assets/'+file,source,{bytes:bytes.length,sha256:sha(bytes)});}
 const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><title>HR段階実行の非公開検証</title><h1>HR ${stages.length}工程の検証</h1><p>固定合成入力・同じ重みと演算。画質と資源の受入は未完です。</p><button id="start">HR ${stages.length}工程を1回実行</button><button id="cancel" disabled>中止</button><p id="status" role="status">待機中</p><a id="download" hidden>alphaを保存</a><script type="module" src="/assets/stages-page.js"></script></html>`;
 const file=path.join(output,'app/local-validation.html');fs.writeFileSync(file,html);add('/local-validation.html',file,{bytes:Buffer.byteLength(html),sha256:sha(Buffer.from(html))});
 fs.writeFileSync(path.join(output,'app/LOCAL_VALIDATION_ONLY.json'),JSON.stringify({scope:policy.scope,distributionApproved:false})+'\n');
 const manifest={reviewSourceMap:reviewSourceMap?{scope:'private-source-review-not-for-deployment',sha256:sha(fs.readFileSync(worker+'.map')),bytes:fs.statSync(worker+'.map').size}:undefined,libraryNotices:libraryNotices.map(({content,...metadata})=>metadata),workerLifetime,stageWorkerMaxJobs:maxStagesPerWorker,stageCancellationProtocol:'cooperative-stage-cancel-v1',status:'local-app-built-not-started',scope:policy.scope,distributionApproved:false,appOrigin:origin.origin,entry:'/local-validation.html',releaseId,referenceCaseId:caseId,input,stageCount:stages.length,mounts,policySha256:sha(Buffer.from(JSON.stringify(policy))),weightFilesRead:0,limits:['No sessions/GPU/browser initialized; full staged numeric/resources/quality unverified','Loopback validation only; not approved Pages/R2 artifacts','Model weights are stat-only here; existing resource policy streams/validates each SHA at use']};
 fs.writeFileSync(path.join(output,'local-app.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({status:manifest.status,stageCount:stages.length,mounts:mounts.length,weightFilesRead:0}));
}finally{esbuild.stop();}
