import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const runtime=JSON.parse(readFileSync(new URL('../docs/browser/runtime-assets.candidate.json',import.meta.url)));
const runtimePath=ext=>{const f=runtime.files.find(f=>f.name.endsWith('.'+ext));return `/runtime/ort/1.31.1/${f.sha256}/${f.name}`;};
import {bindReleaseModels,verifyReleaseAssets,verifyBrowserReleaseBindings} from '../tools/verify_browser_release_bindings.mjs';
import {browserReleaseFixture,addRvmChoice} from './fixtures/browser-release.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
function fixture(rvm=false){
 const config=rvm?addRvmChoice(browserReleaseFixture()):browserReleaseFixture(),assets=[],catalog={format:'zip-stored-v1',models:[]},bindings=[];
 const add=(route,bytes,sha256)=>{if(!assets.some(file=>file.path===route))assets.push({path:route,bytes,sha256});};
 for(const url of [...Object.values(config.workers),config.modelNoticesHref])add(url,12,'b'.repeat(64));
 for(const [index,choice] of [{...config,modelWorker:config.workers.model},...config.modelVariants].entries()){
  add(choice.modelWorker,12,'b'.repeat(64));
  if(choice.prepareBackground.model==='hr'){
   const source=choice.prepareBackground.source,base=source.resources[0].url.replace('/config.json','/stage-000/');
   source.resources=['config.json','onnx/model_fp16.onnx'].map(name=>({name:'stage-000/'+name,url:base+'hr/'+name,bytes:4,sha256:'c'.repeat(64)}));
  }
  const commands=[choice.prepareBackground,...(choice.prepareMatte?[choice.prepareMatte]:[])];
  const policy={profiles:{},models:commands.map(c=>({model:c.model,modelVersion:c.modelVersion,...Object.fromEntries(Object.entries(c.source).filter(([key])=>key!=='mode'))})),localModelPath:'https://huggingface.co/fixture/models/resolve/'+'a'.repeat(40)+'/',runtimeAssets:{mjs:runtimePath('mjs'),wasm:'https://huggingface.co/fixture/models/resolve/'+'a'.repeat(40)+runtimePath('wasm')},wasmOrigin:'https://huggingface.co'};
  for(const command of commands){
   policy.profiles[command.model]={executionProvider:choice.executionProvider,...(choice.executionProvider==='webgpu'?{requiredLimits:{maxBufferSize:1024}}:{})};
   const configuration=command.model==='modnet'?'modnet':choice.executionProvider==='wasm'?'cpu':'gpu';
   if(!catalog.models.some(item=>item.role===command.model&&item.configuration===configuration))catalog.models.push({role:command.model,configuration,archive:{path:new URL(command.source.archive.url).pathname.split('/resolve/'+'a'.repeat(40)+'/')[1],bytes:command.source.archive.bytes,sha256:command.source.archive.sha256},entries:command.source.resources.map(({name,bytes,sha256})=>({name,bytes,sha256}))});
  }
  if(choice.prepareBackground.model==='hr'){policy.enableHrInference=true;policy.enableMatteInference=true;}else if(choice.prepareBackground.model==='rvm')policy.enableRvmInference=true;else policy.enableModnetInference=true;
  const binding={worker:choice.modelWorker,policy,report:{status:'built-not-executed',bundleBytes:12,bundleSha256:'b'.repeat(64),cancellationProtocol:'cooperative-model-cancel-v1',libraryNotices:[]}};
  if(choice.prepareBackground.model==='hr'){
   const source=choice.prepareBackground.source;
   const stagePolicy={workerLifetime:'per-stage',maxStagesPerWorker:1,profile:policy.profiles.hr,stages:[{inputs:[{name:'pixels',dtype:'float16',dims:[1,3,2048,2048]}],outputs:[{name:'alpha',dtype:'float32',dims:[1,1,2048,2048]}],localModelPath:source.resources[0].url.replace('/hr/config.json','/'),release:{model:'hr',modelVersion:choice.prepareBackground.modelVersion+'-0',releaseId:source.releaseId,cacheNamespace:source.cacheNamespace,resources:source.resources.map(file=>({...file,name:file.name.replace('stage-000/','')}))}}],runtimeAssets:policy.runtimeAssets,wasmOrigin:policy.wasmOrigin};
   const digest=String(index+1).repeat(64),worker={path:'/assets/'+digest+'/stage-worker.js',bytes:20,sha256:digest};add(worker.path,worker.bytes,worker.sha256);
   policy.stagedHr={worker:worker.path,workerFile:{url:worker.path,bytes:worker.bytes,sha256:worker.sha256},workerLifetime:stagePolicy.workerLifetime,maxStagesPerWorker:1,stages:stagePolicy.stages,cancellationProtocol:'cooperative-stage-cancel-v1'};
   binding.stage={policy:stagePolicy,report:{status:'public-stage-worker-built-not-deployed',worker,stageCount:1,executionProvider:choice.executionProvider,assets:[worker],policySha256:sha(JSON.stringify(stagePolicy))}};
  }
  binding.report.policySha256=sha(JSON.stringify(policy));bindings.push(binding);
 }
 const mjs=runtime.files.find(file=>file.name.endsWith('.mjs'));add(runtimePath('mjs'),mjs.bytes,mjs.sha256);
 return {config,catalog,bindings,assets};
}
test('binds four configured Workers and six roles to their compiled policies, children and pack catalogue',()=>{
 const input=fixture(),before=JSON.stringify(input);const result=bindReleaseModels(input);
 assert.equal(result.choices,4);assert.equal(result.roles,6);assert.equal(result.archives,5);assert.equal(JSON.stringify(input),before);
});
test('GPU three-phase Matte binds all four resources without changing the explicit CPU choice',()=>{
 const input=fixture(),cpu=input.config.modelVariants.find(choice=>choice.executionProvider==='wasm'&&choice.prepareMatte),before=JSON.stringify(cpu);
 const gpu=input.config.modelVariants.find(choice=>choice.executionProvider==='webgpu'&&choice.prepareMatte),binding=input.bindings.find(item=>item.worker===gpu.modelWorker),command=gpu.prepareMatte;
 const base=command.source.resources[0].url.replace(/[^/]+$/,'');const resources=['phase-0.onnx','model.onnx.data','phase-1.onnx','phase-2.onnx'].map(name=>({name,url:base+name,bytes:4,sha256:'c'.repeat(64)}));
 command.source.resources=resources;binding.policy.models.find(model=>model.model==='matte').resources=resources;binding.policy.phasedMatte=true;
 Object.assign(binding.policy.profiles.matte,{storageBufferCacheMode:'disabled',maxNumPendingDispatches:1,requiredLimits:{maxBufferSize:1105477632,maxStorageBufferBindingSize:1105477632}});
 binding.report.policySha256=sha(JSON.stringify(binding.policy));input.catalog.models.find(model=>model.role==='matte'&&model.configuration==='gpu').entries=resources.map(({name,bytes,sha256})=>({name,bytes,sha256}));
 assert.equal(bindReleaseModels(input).roles,6);assert.equal(JSON.stringify(cpu),before);
 const mismatch=structuredClone(input);mismatch.bindings.find(item=>item.worker===gpu.modelWorker).policy.profiles.matte.executionProvider='wasm';assert.throws(()=>bindReleaseModels(mismatch));
 const missing=structuredClone(input);missing.catalog.models.find(model=>model.role==='matte'&&model.configuration==='gpu').entries.pop();assert.throws(()=>bindReleaseModels(missing));
 const privateInput=structuredClone(input),privateBinding=privateInput.bindings.find(item=>item.worker===gpu.modelWorker);privateBinding.policy.scope='local-validation-only-not-approved-for-distribution';privateBinding.report.policySha256=sha(JSON.stringify(privateBinding.policy));assert.throws(()=>bindReleaseModels(privateInput));
});
test('refuses policy/report/config/catalog drift even when the top-level configuration is structurally valid',()=>{
 for(const mutate of [x=>{x.bindings[0].report.bundleSha256='f'.repeat(64);},x=>{x.bindings[0].policy.models[0].modelVersion='wrong';},x=>{x.bindings[0].report.policySha256='f'.repeat(64);},x=>{x.catalog.models[0].entries[0].bytes++;},x=>{x.bindings[3].stage.report.worker.bytes++;},x=>{x.assets.pop();},x=>{x.bindings.pop();},x=>{x.bindings[0].policy.scope='private';x.bindings[0].report.policySha256=sha(JSON.stringify(x.bindings[0].policy));},x=>{x.bindings[0].policy.models[0].archive.bytes++;x.bindings[0].report.policySha256=sha(JSON.stringify(x.bindings[0].policy));},x=>{x.bindings[0].policy.profiles.modnet.executionProvider='webgpu';x.bindings[0].report.policySha256=sha(JSON.stringify(x.bindings[0].policy));}]){
  const input=fixture();mutate(input);assert.throws(()=>bindReleaseModels(input));
 }
});
test('asset hashing rejects same-size corruption, missing files, escapes and symlinks',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-bind-assets-'));
 try{
  await fs.mkdir(path.join(root,'assets'));const bytes=Buffer.from('worker'),record={path:'/assets/worker.js',bytes:bytes.length,sha256:sha(bytes)};await fs.writeFile(path.join(root,'assets/worker.js'),bytes);
  assert.equal((await verifyReleaseAssets(root,[record])).length,1);
  await fs.writeFile(path.join(root,'assets/worker.js'),'broken');await assert.rejects(verifyReleaseAssets(root,[record]));
  await fs.rm(path.join(root,'assets/worker.js'));await assert.rejects(verifyReleaseAssets(root,[record]));
  await fs.writeFile(path.join(root,'original.js'),bytes);await fs.symlink(path.join(root,'original.js'),path.join(root,'assets/worker.js'));await assert.rejects(verifyReleaseAssets(root,[record]));
  await assert.rejects(verifyReleaseAssets(root,[{...record,path:'/../original.js'}]));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});


test('malformed metadata cannot echo its contents through JSON parse errors',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'studio-bind-metadata-'));
 try{const file=path.join(root,'spec.json');await fs.writeFile(file,'{secret-sentinel');await assert.rejects(verifyBrowserReleaseBindings(root,file),error=>error.message==='invalid-release-resource-binding');}
 finally{await fs.rm(root,{recursive:true,force:true});}
});

test('binds the optional isolated RVM CPU pair and rejects backend or archive drift',()=>{
 const input=fixture(true);assert.equal(bindReleaseModels(input).choices,5);assert.equal(bindReleaseModels(input).archives,6);
 for(const mutate of [x=>{x.config.modelVariants.at(-1).executionProvider='webgpu';},x=>{x.config.modelVariants.at(-1).prepareBackground.source.resources.pop();},x=>{x.bindings.at(-1).policy.enableModnetInference=true;x.bindings.at(-1).report.policySha256=sha(JSON.stringify(x.bindings.at(-1).policy));},x=>{x.catalog.models.at(-1).archive.sha256='f'.repeat(64);}]){const broken=structuredClone(input);mutate(broken);assert.throws(()=>bindReleaseModels(broken));}
});
