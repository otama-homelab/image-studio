/** Build a standalone immutable HR stage Worker candidate; never upload or execute it. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveBrowserBuildDependencies} from './browser-build-dependencies.mjs';
import {createHash} from 'node:crypto';
import {MAX_STAGE_WORKER_SCRIPT_BYTES} from './browser-library-adapter/staged-hr-prepare.mjs';
import {createStagedHr} from './browser-library-adapter/staged-hr.mjs';
import {createResourcePolicy} from './browser-library-adapter/resource-policy.mjs';
import {createOrtRuntimeBootstrap} from './browser-library-adapter/ort-runtime-bootstrap.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const invalid=()=>{throw Error('Invalid public stage policy');};
const keys=(value,allowed)=>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))invalid();
};
const runtime=readJson(path.join(repo,'docs/browser/runtime-assets.candidate.json'));
const runtimePath=extension=>{
 const file=runtime.files.find(file=>file.name.endsWith('.'+extension));
 return `/runtime/ort/${runtime.version}/${file.sha256}/${file.name}`;
};
export function validatePublicStagePolicy(policy){
 keys(policy,['workerLifetime','maxStagesPerWorker','wasmOrigin','runtimeAssets','profile','stages']);
 keys(policy.runtimeAssets,['mjs','wasm']);
 keys(policy.profile,['executionProvider','numThreads','requiredLimits','storageBufferCacheMode','maxNumPendingDispatches','freeDimensionOverrides']);
 const hub=typeof policy.runtimeAssets.wasm==='string'&&policy.runtimeAssets.wasm.match(/^(https:\/\/huggingface\.co\/[\w.-]+\/[\w.-]+\/resolve\/[a-f0-9]{40})(\/runtime\/.*)$/);
 if(!hub||hub[2]!==runtimePath('wasm')||policy.runtimeAssets.mjs!==runtimePath('mjs')||policy.wasmOrigin!=='https://huggingface.co'||!['webgpu','wasm'].includes(policy.profile.executionProvider))invalid();
 // Validate the official runtime options without creating a session/device or fetching anything.
 createOrtRuntimeBootstrap({...policy.profile,origin:'https://public-build.invalid',wasmOrigin:policy.wasmOrigin,runtimeAssets:policy.runtimeAssets,ort:{env:{versions:{web:runtime.version},wasm:{},webgpu:{}}},gpu:{requestAdapter(){throw Error('Build must not request a GPU');}}});
 createStagedHr({catalog:policy.stages,workerLifetime:policy.workerLifetime,maxStagesPerWorker:policy.maxStagesPerWorker,cancellationProtocol:'cooperative-stage-cancel-v1',createWorker(){throw Error('Build must not create a Worker');}});
 if(!['per-stage','per-run'].includes(policy.workerLifetime)||!Number.isSafeInteger(policy.maxStagesPerWorker)
  ||JSON.stringify(policy.stages[0].inputs)!==JSON.stringify([{name:'pixels',dtype:'float16',dims:[1,3,2048,2048]}])
  ||JSON.stringify(policy.stages.at(-1).outputs)!==JSON.stringify([{name:'alpha',dtype:'float32',dims:[1,1,2048,2048]}]))invalid();
 for(const stage of policy.stages){
  keys(stage,['inputs','outputs','localModelPath','release']);
  for(const port of [...stage.inputs,...stage.outputs])keys(port,['name','dtype','dims']);
  const release=stage.release;keys(release,['model','modelVersion','releaseId','cacheNamespace','resources']);
  if(release.model!=='hr'||![release.modelVersion,release.releaseId].every(id=>typeof id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id))
   ||typeof release.cacheNamespace!=='string'||!/^image-studio-[a-zA-Z0-9._-]{1,127}$/.test(release.cacheNamespace)
   ||typeof stage.localModelPath!=='string'||!stage.localModelPath.startsWith(hub[1]+'/')||!stage.localModelPath.endsWith('/'))invalid();
  const names=['config.json','onnx/model_fp16.onnx',...(release.resources?.length===3?['onnx/model.onnx.data']:[])];
  if(!Array.isArray(release.resources)||release.resources.length!==names.length||!names.every(name=>release.resources.some(file=>file.name===name&&file.url===stage.localModelPath+'hr/'+name)))invalid();
  for(const file of release.resources)keys(file,['name','url','bytes','sha256']);
  createResourcePolicy({files:release.resources,fetchImpl(){throw Error('Build must not fetch');},makeHasher(){throw Error('Build must not load models');},cache:{match(){},put(){}}});
 }
 return policy;
}

export async function buildPublicStageWorker(dependencyRoot,policyFile,output){
 const policy=validatePublicStagePolicy(readJson(policyFile));
 if(fs.existsSync(output))throw Error('New output directory required');
 const dependencies=resolveBrowserBuildDependencies(dependencyRoot),libraries={transformers:dependencies.transformer,ort:dependencies.ort,hash:dependencies.hash};
 const index=readJson(path.join(repo,'docs/browser/runtime-notices/library-sources.json'));
 const expected={transformers:index.libraries.transformers.bundleSha256,ort:runtime.entrypoint.sha256,hash:index.libraries.hashWasm.bundleSha256};
 for(const [name,file] of Object.entries(libraries))if(sha(fs.readFileSync(file))!==expected[name])throw Error('Pinned stage library mismatch');
 const notices=[...index.documents,...readJson(path.join(repo,'docs/browser/runtime-notices/sources.json')).sources].map(document=>{
  if(!/^[a-zA-Z0-9.-]+\.txt$/.test(document.file))throw Error('Invalid notice filename');
  const content=fs.readFileSync(path.join(repo,'docs/browser/runtime-notices',document.file));
  if(content.length!==document.bytes||sha(content)!==document.sha256)throw Error('Captured notice mismatch');
  return {name:document.file,content};
 });
 const esbuild=dependencies.esbuild;
 if(esbuild.version!=='0.25.12')throw Error('Pinned esbuild 0.25.12 required');
 let result;
 try{
  result=await esbuild.build({entryPoints:[path.join(repo,'tools/browser-library-adapter/browser-stage-worker.mjs')],outfile:'stage-worker.js',bundle:true,minify:true,platform:'browser',format:'iife',target:'es2022',legalComments:'linked',metafile:true,sourcemap:false,write:false,logLevel:'silent',alias:{'transformers-candidate':libraries.transformers,'ort-candidate':libraries.ort,'onnxruntime-web/webgpu':libraries.ort,'onnxruntime-common':libraries.ort,'hash-candidate':libraries.hash},plugins:[{name:'public-stage-policy',setup(build){build.onResolve({filter:/^stage-policy$/},()=>({path:'policy',namespace:'fixed'}));build.onLoad({filter:/.*/,namespace:'fixed'},()=>({contents:JSON.stringify(policy),loader:'json'}));}}]});
 }finally{esbuild.stop();}
 if(Object.values(result.metafile.outputs).some(file=>file.imports.some(item=>item.external)))throw Error('External stage Worker import');
 const worker=result.outputFiles.find(file=>path.basename(file.path)==='stage-worker.js');
 if(!worker||worker.contents.length>MAX_STAGE_WORKER_SCRIPT_BYTES)throw Error(`Stage Worker exceeds verified loader limit (${worker?.contents.length??0} bytes)`);
 const digest=sha(worker.contents),assetRoot=`/assets/${digest}`;
 const assets=[...result.outputFiles.map(file=>({name:path.basename(file.path),content:file.contents})),...notices];
 if(new Set(assets.map(file=>file.name)).size!==assets.length)throw Error('Duplicate stage asset');
 const inventory=assets.map(file=>({path:assetRoot+'/'+file.name,bytes:file.content.length,sha256:sha(file.content)}));
 const report={status:'public-stage-worker-built-not-deployed',distributionApproved:false,hubRevisionVerified:false,worker:{path:assetRoot+'/stage-worker.js',bytes:worker.contents.length,sha256:digest},assets:inventory,policySha256:sha(Buffer.from(JSON.stringify(policy))),libraries:expected,esbuild:esbuild.version,stageCount:policy.stages.length,executionProvider:policy.profile.executionProvider,weightFilesRead:0,limits:['Compile-only candidate; immutable Hub revision and resources not checked live','Public app/runtime/CSP integration and browser execution remain','Use the pinned npm build project or retained captured dependencies; policies and runtime inputs remain explicit','Notices captured; complete distribution rights review remains']};
 fs.mkdirSync(output,{mode:0o700});
 const directory=path.join(output,'assets',digest);fs.mkdirSync(directory,{recursive:true,mode:0o700});
 for(const file of assets)fs.writeFileSync(path.join(directory,file.name),file.content,{flag:'wx',mode:0o600});
 fs.writeFileSync(path.join(output,'stage-worker.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 return report;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length!==3)throw Error('Need BUILD_DEPENDENCIES RELEASE_STAGE_POLICY_JSON NEW_OUTPUT');
 const result=await buildPublicStageWorker(...args);console.log(JSON.stringify({status:result.status,worker:result.worker,stageCount:result.stageCount}));
}
