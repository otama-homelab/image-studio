/** Compile the four model choices and their static assets; never downloads models. */
import {lstat,realpath,mkdir,writeFile,copyFile,readdir,readFile,rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {parseBackgroundRelease} from '../web/scripts/background-release.mjs';
import {readBounded,relativePath,verifyReleaseAssets,verifyReleaseFilesUnchanged,bindReleaseModels} from './verify_browser_release_bindings.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const roles=['modnet-cpu','modnet-gpu','hr-gpu','hr-cpu'];
const invalid=()=>{throw Error('invalid-background-build-input');};
const keys=(object,names)=>{if(!object||Array.isArray(object)||Object.keys(object).sort().join(',')!==[...names].sort().join(','))invalid();};
const sha=body=>createHash('sha256').update(body).digest('hex');

export async function loadBackgroundBuildInput(directory){
 const initial=await lstat(directory);if(!initial.isDirectory()||initial.isSymbolicLink())invalid();
 const root=await realpath(directory),records=[];
 const json=async name=>{
  const record=await readBounded(root,path.join(root,relativePath(name)),8*1024*1024,true);records.push(record);
  try{return JSON.parse(record.data.toString('utf8'));}catch{invalid();}
 };
 const manifest=await json('release.json');keys(manifest,['config','catalog','parents','stages','resize','assets']);keys(manifest.parents,roles);keys(manifest.stages,['cpu','gpu']);
 const config=parseBackgroundRelease(await json(manifest.config));if(config===null)invalid();
 const catalog=await json(manifest.catalog),parents={},stages={};
 for(const role of roles)parents[role]=await json(manifest.parents[role]);
 for(const role of ['cpu','gpu'])stages[role]=await json(manifest.stages[role]);
 const resize=await readBounded(root,path.join(root,relativePath(manifest.resize)),25*1024*1024);records.push(resize);
 const staticRoot=path.join(root,'static'),stat=await lstat(staticRoot);if(!stat.isDirectory()||stat.isSymbolicLink())invalid();
 const assets=await verifyReleaseAssets(staticRoot,manifest.assets);
 let privateMarker=null;
 try{const marker=await readBounded(root,path.join(root,'LOCAL_VALIDATION_ONLY.json'),64*1024,true);records.push(marker);privateMarker=marker.data.toString('utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
 await verifyReleaseFilesUnchanged(records);
 return {root,config,catalog,parents,stages,resize:resize.resolved,staticRoot,assets,records,privateMarker};
}

export async function compileBackgroundRelease(directory,output){
 const input=await loadBackgroundBuildInput(directory);
 // Existing output is never replaced, even for a malformed release input.
 await mkdir(output,{mode:0o700});
 try{
  const publish=path.join(output,'static');await mkdir(publish);const assets=[],seen=new Set(),bindings=[],children={},parents={};
  const add=async(route,file,expected)=>{
   const relative=relativePath(route.slice(1));if(!route.startsWith('/')||seen.has(route))invalid();
   const body=await readFile(file);if(body.length>25*1024*1024)invalid();
   const record={path:route,bytes:body.length,sha256:sha(body)};
   if(expected&&['bytes','sha256'].some(key=>record[key]!==expected[key]))invalid();
   const target=path.join(publish,relative);await mkdir(path.dirname(target),{recursive:true});await copyFile(file,target,constants.COPYFILE_EXCL);seen.add(route);assets.push(record);
  };
  for(const file of input.assets)await add(file.path,path.join(input.staticRoot,file.path.slice(1)),file);
  const build=async(name,tool,policy,resize=false)=>{
   const policyFile=path.join(output,name+'-policy.json'),target=path.join(output,name);await writeFile(policyFile,JSON.stringify(policy,null,2)+'\n',{flag:'wx'});
   const args=[path.join(repo,'tools',tool),path.join(repo,'tools/browser-build'),policyFile,target];if(resize)args.push(input.resize);
   execFileSync(process.execPath,args,{cwd:repo,stdio:'pipe',maxBuffer:1024*1024});
   return target;
  };
  for(const role of ['gpu','cpu']){
   const policy=input.stages[role],target=await build(role+'-stage','build_browser_public_stage_worker.mjs',policy);
   const report=JSON.parse(await readFile(path.join(target,'stage-worker.json'),'utf8'));children[role]={policy,report};
   for(const file of report.assets)await add(file.path,path.join(target,file.path.slice(1)),file);
  }
  for(const role of roles){
   const policy=input.parents[role];let stage;
   if(role.startsWith('hr-')){
    stage=children[role.endsWith('cpu')?'cpu':'gpu'];
    if(!policy.stagedHr||policy.stagedHr.stages&&!isDeepStrictEqual(policy.stagedHr.stages,stage.policy.stages))invalid();
    policy.stagedHr.stages=stage.policy.stages;policy.stagedHr.worker=stage.report.worker.path;
    policy.stagedHr.workerFile={...policy.stagedHr.workerFile,url:stage.report.worker.path,bytes:stage.report.worker.bytes,sha256:stage.report.worker.sha256};
   }
   const target=await build(role,'build_browser_model_prepare.mjs',policy,true),report=JSON.parse(await readFile(path.join(target,'report.json'),'utf8'));
   const worker='/assets/'+report.bundleSha256+'/model-prepare-worker.js';parents[role]=worker;
   await add(worker,path.join(target,'model-prepare-worker.js'),{bytes:report.bundleBytes,sha256:report.bundleSha256});
   for(const name of await readdir(target))if(name.endsWith('.txt'))await add(path.posix.dirname(worker)+'/'+name,path.join(target,name));
   bindings.push({worker,policy,report,...(stage?{stage}:{})});
  }
  const config=input.config;config.workers.model=parents['modnet-cpu'];
  for(const variant of config.modelVariants){const role=variant.prepareBackground.model==='modnet'?'modnet-gpu':variant.executionProvider==='wasm'?'hr-cpu':'hr-gpu';variant.modelWorker=parents[role];}
  assets.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const bound=bindReleaseModels({config,catalog:input.catalog,bindings,assets});
  await verifyReleaseAssets(publish,assets);await verifyReleaseFilesUnchanged(input.records);
  return {...input,config,assets,bindings,staticRoot:publish,bound};
 }catch(error){await rm(output,{recursive:true,force:true});throw error;}
}
