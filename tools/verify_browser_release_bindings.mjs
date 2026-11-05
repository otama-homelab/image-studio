/** Bind local release metadata and static bytes. Never approves, uploads or executes models. */
import {constants} from 'node:fs';
import {open,lstat,realpath,stat,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {parseBackgroundRelease} from '../web/scripts/background-release.mjs';
import {releaseAssetPath} from './browser-library-adapter/release-asset.mjs';
import {validateLibraryPreparation} from './browser-library-adapter/preparation-source.mjs';
import {validatePublicStagePolicy} from './build_browser_public_stage_worker.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=()=>{throw Error('invalid-release-resource-binding');};
const same=(a,b)=>{if(!isDeepStrictEqual(a,b))fail();};
const keys=(object,allowed)=>{if(!object||typeof object!=='object'||Array.isArray(object)||Object.keys(object).some(key=>!allowed.includes(key)))fail();};
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=JSON.parse(await readFile(path.join(repo,'docs/browser/runtime-assets.candidate.json'),'utf8'));
const runtimeFile=extension=>runtime.files.find(file=>file.name.endsWith('.'+extension));
const runtimePath=extension=>{const f=runtimeFile(extension);return `/runtime/ort/${runtime.version}/${f.sha256}/${f.name}`;};
const members=files=>files.map(({name,bytes,sha256})=>({name,bytes,sha256})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);

export function bindReleaseModels({config,catalog,bindings,assets}){
 config=parseBackgroundRelease(config);if(config===null||catalog?.format!=='zip-stored-v1'||!Array.isArray(catalog.models)||catalog.models.length!==5||!Array.isArray(bindings)||bindings.length!==4||!Array.isArray(assets))fail();
 const files=new Map(assets.map(file=>[file.path,file]));if(files.size!==assets.length)fail();
 const asset=(route,expected)=>{const file=files.get(route);if(!file||!['bytes','sha256'].every(key=>file[key]===expected[key]))fail();return file;};
 for(const route of [...Object.values(config.workers),config.modelNoticesHref,...config.modelVariants.map(choice=>choice.modelWorker)]){const file=files.get(route);if(!file||route.split('/')[2]!==file.sha256)fail();}
 asset(runtimePath('mjs'),runtimeFile('mjs'));
 const choices=[{...config,modelWorker:config.workers.model},...config.modelVariants],seen=new Set(),packs=new Set();let roles=0;
 const policies=[];
 for(const choice of choices){
  const matches=bindings.filter(binding=>binding.worker===choice.modelWorker);if(matches.length!==1||seen.has(choice.modelWorker))fail();seen.add(choice.modelWorker);
  const binding=matches[0],{policy,report}=binding;
  keys(policy,['localModelPath','wasmOrigin','runtimeAssets','profiles','models','enableModnetInference','enableHrInference','enableMatteInference','modnetProcessor','modnetResizeMaxMemoryBytes','hrResizeMaxMemoryBytes','matteProcessor','stagedHr','phasedMatte']);
  if(report?.status!=='built-not-executed'||report.policySha256!==sha(JSON.stringify(policy))||report.cancellationProtocol!=='cooperative-model-cancel-v1'||choice.modelWorker.split('/')[2]!==report.bundleSha256)fail();
  asset(choice.modelWorker,{bytes:report.bundleBytes,sha256:report.bundleSha256});
  const hub=choice.prepareBackground.source.archive.url.match(/^(https:\/\/huggingface\.co\/[\w.-]+\/[\w.-]+\/resolve\/[a-f0-9]{40})\//)[1];
  same(policy.runtimeAssets,{mjs:runtimePath('mjs'),wasm:hub+runtimePath('wasm')});if(policy.wasmOrigin!=='https://huggingface.co')fail();
  const commands=[choice.prepareBackground,...(choice.prepareMatte?[choice.prepareMatte]:[])];
  if(!Array.isArray(policy.models)||policy.models.length!==commands.length)fail();
  keys(policy.profiles,commands.map(command=>command.model));
  for(const command of commands){
   const trusted=policy.models.find(model=>model.model===command.model);keys(trusted,['model','modelVersion','releaseId','cacheNamespace','resources','archive']);
   validateLibraryPreparation(command,trusted);same(command.source.archive,trusted.archive);
   const profile=policy.profiles?.[command.model];keys(profile,['executionProvider','numThreads','requiredLimits','storageBufferCacheMode','maxNumPendingDispatches','freeDimensionOverrides']);if(!profile||(profile.executionProvider??'webgpu')!==choice.executionProvider||Object.hasOwn(profile,'scope'))fail();
   const configuration=command.model==='modnet'?'modnet':choice.executionProvider==='wasm'?'cpu':'gpu';
   const entries=catalog.models.filter(item=>item.role===command.model&&item.configuration===configuration);if(entries.length!==1)fail();const entry=entries[0];
   same(command.source.archive,{url:hub+'/'+entry.archive.path,bytes:entry.archive.bytes,sha256:entry.archive.sha256});same(members(command.source.resources),members(entry.entries));packs.add(entry.archive.path);roles++;
  }
  if(choice.prepareBackground.model==='hr'){
   if(policy.enableHrInference!==true||policy.enableMatteInference!==true||!policy.stagedHr||!binding.stage)fail();
   const stage=validatePublicStagePolicy(binding.stage.policy),built=binding.stage.report,child=policy.stagedHr;
   if(built.status!=='public-stage-worker-built-not-deployed'||built.policySha256!==sha(JSON.stringify(stage))||built.stageCount!==stage.stages.length||built.executionProvider!==choice.executionProvider)fail();
   releaseAssetPath(child.worker,'js');if(child.worker!==built.worker.path||child.cancellationProtocol!=='cooperative-stage-cancel-v1')fail();
   same(child.workerFile,{url:child.worker,bytes:built.worker.bytes,sha256:built.worker.sha256});asset(child.worker,built.worker);
   if(child.worker.split('/')[2]!==built.worker.sha256)fail();
   for(const key of ['workerLifetime','maxStagesPerWorker','stages'])same(child[key],stage[key]);
   same(stage.profile,policy.profiles.hr);same(stage.runtimeAssets,policy.runtimeAssets);same(stage.wasmOrigin,policy.wasmOrigin);
   for(const file of built.assets)asset(file.path,file);
  }else if(binding.stage||policy.stagedHr||policy.enableModnetInference!==true)fail();
  for(const notice of report.libraryNotices??[])asset(path.posix.dirname(choice.modelWorker)+'/'+notice.file,notice);
  policies.push({worker:choice.modelWorker,policySha256:report.policySha256});
 }
 if(packs.size!==5)fail();
 return {choices:choices.length,roles,archives:packs.size,policies};
}

const inside=(root,file)=>{const relative=path.relative(root,file);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
const stamp=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);
export async function readBounded(root,filename,limit,collect=false){
 if(!inside(root,path.resolve(filename)))fail();
 let component=root;for(const part of path.relative(root,path.resolve(filename)).split(path.sep)){component=path.join(component,part);if((await lstat(component)).isSymbolicLink())fail();}
 if(!(await lstat(filename)).isFile())fail();const resolved=await realpath(filename);if(!inside(root,resolved))fail();
 const handle=await open(resolved,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=await handle.stat({bigint:true});if(!before.isFile()||before.size>BigInt(limit))fail();
  const hash=createHash('sha256'),chunks=[];let bytes=0;
  for await(const chunk of handle.createReadStream({autoClose:false,highWaterMark:1024*1024})){bytes+=chunk.length;if(bytes>limit)fail();hash.update(chunk);if(collect)chunks.push(chunk);}
  if(bytes!==Number(before.size)||!stamp(before,await handle.stat({bigint:true}))||!stamp(before,await stat(resolved,{bigint:true}))||await realpath(filename)!==resolved)fail();
  return {bytes,sha256:hash.digest('hex'),stamp:before,resolved,filename,...(collect?{data:Buffer.concat(chunks)}:{})};
 }finally{await handle.close();}
}
export function relativePath(value){if(typeof value!=='string'||!value||path.isAbsolute(value)||value.includes('\\')||value.split('/').some(part=>!part||part==='.'||part==='..'))fail();return value;}
export async function verifyReleaseFilesUnchanged(checks){
 for(const check of checks)if(!stamp(check.stamp,await stat(check.resolved,{bigint:true}))||await realpath(check.filename)!==check.resolved)fail();
}
export async function verifyReleaseAssets(rootText,assets){
 const root=await realpath(rootText);if(!Array.isArray(assets)||!assets.length||assets.length>20000)fail();const seen=new Set(),verified=[],checks=[];
 for(const file of assets){
  keys(file,['path','bytes','sha256']);
  if(typeof file.path!=='string'||!file.path.startsWith('/')||seen.has(file.path)||!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>25*1024*1024||!/^[a-f0-9]{64}$/.test(file.sha256??''))fail();
  const relative=relativePath(file.path.slice(1));seen.add(file.path);
  const actual=await readBounded(root,path.join(root,relative),file.bytes);if(actual.bytes!==file.bytes||actual.sha256!==file.sha256)fail();verified.push({...file});checks.push(actual);
 }
 await verifyReleaseFilesUnchanged(checks);
 return verified.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
export async function verifyBrowserReleaseBindings(rootText,specFile){
 const root=await realpath(rootText),records=[],checks=[];
 const json=async filename=>{const file=path.resolve(filename);if(!inside(root,file))fail();const record=await readBounded(root,file,8*1024*1024,true);records.push(record.sha256);checks.push(record);try{return JSON.parse(record.data.toString('utf8'));}catch{fail();}};
 const spec=await json(path.resolve(specFile));keys(spec,['app','config','catalog','bindings','assets']);
 const source=relative=>path.join(root,relativePath(relative));
 const config=await json(source(spec.config)),catalog=await json(source(spec.catalog)),bindings=[];
 for(const item of spec.bindings){keys(item,['worker','policy','report','stage']);const binding={worker:item.worker,policy:await json(source(item.policy)),report:await json(source(item.report))};if(item.stage){keys(item.stage,['policy','report']);binding.stage={policy:await json(source(item.stage.policy)),report:await json(source(item.stage.report))};}bindings.push(binding);}
 const requested=source(spec.app);if(!(await lstat(requested)).isDirectory())fail();const app=await realpath(requested);if(!inside(root,app))fail();
 const metadata=await json(path.join(app,'background-release.json'));keys(metadata,['schemaVersion','configSha256']);
 if(metadata.schemaVersion!==1||metadata.configSha256!==sha(JSON.stringify(config)))fail();
 const assets=await verifyReleaseAssets(app,spec.assets),bound=bindReleaseModels({config,catalog,bindings,assets});
 await verifyReleaseFilesUnchanged(checks);
 const content={status:'release-resource-bindings-verified-not-approved',distributionApproved:false,hubRevisionVerified:false,...bound,configSha256:sha(JSON.stringify(config)),appConfigDigestVerified:true,catalogSha256:sha(JSON.stringify(catalog)),reviewedMetadataSha256:records,assets,verifiedAssetBytes:assets.reduce((sum,file)=>sum+file.bytes,0)};
 return {...content,bindingId:'sha256:'+sha(JSON.stringify(content)),limits:['Local build reports are trusted evidence; this is not a signature or source authenticity proof','Only declared assets and model bindings are reviewed, not complete dependency closure or the whole app','No ZIP/model bodies or live Hub revisions read; no inference, rights or deployment approval']};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [root,spec,output]=process.argv.slice(2);if(!root||!spec||!output||process.argv.length!==5)throw Error('Need SOURCE_ROOT SPEC_JSON NEW_REVIEW_JSON');
 const result=await verifyBrowserReleaseBindings(root,spec);await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({status:result.status,choices:result.choices,roles:result.roles,assets:result.assets.length,bindingId:result.bindingId,distributionApproved:false}));
}
