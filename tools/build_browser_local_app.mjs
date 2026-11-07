import {isPrivateValidationOrigin} from './browser-library-adapter/private-validation-origin.mjs';
import {liteGraphProfile} from './browser-library-adapter/lite-graph-profile.mjs';
/** Assemble a private loopback app using existing Vite and captured Worker artifacts.
 * Model weights are stat'ed only; fixed SHA validation stays in the existing resource loader.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {readModelNoticeDocuments} from './check_browser_model_notices.mjs';
import {validateLibraryPreparation} from './browser-library-adapter/preparation-source.mjs';
import {verifyRuntimeStage} from './stage_browser_runtime.mjs';
import {isDeepStrictEqual} from 'node:util';
const [evaluationRoot,specFile,outputText]=process.argv.slice(2);
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),root=fs.realpathSync(evaluationRoot),output=path.resolve(outputText);
if(!output.startsWith(root+path.sep)||fs.existsSync(output))throw Error('Need a new private output directory');
const spec=JSON.parse(fs.readFileSync(specFile)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const captured=name=>{const file=fs.realpathSync(path.resolve(root,name));if(!file.startsWith(root+path.sep))throw Error('Artifact outside private evaluation root');return file;};
const runtimeDirectory=captured(spec.runtimeDirectory);
const runtimeVerification=await verifyRuntimeStage(runtimeDirectory,'native');
const runtime=JSON.parse(fs.readFileSync(path.join(runtimeDirectory,'manifest.json')));
const policyDirectory=captured(spec.policyDirectory),policy=JSON.parse(fs.readFileSync(path.join(policyDirectory,'local-runtime-policy.json')));
const origin=new URL(policy.appOrigin);
if(policy.scope!=='local-validation-only-not-approved-for-distribution'||policy.distributionApproved!==false
 ||!isPrivateValidationOrigin(policy.appOrigin,spec.privateLanHttps===true))throw Error('Local policy required');
const liteGraph=liteGraphProfile(policy.liteGraphFormat);
if(liteGraph&&policy.profiles.lite?.executionProvider==='webgpu'){const limits=policy.profiles.lite.requiredLimits;if(!limits||!['maxBufferSize','maxStorageBufferBindingSize'].every(name=>Number.isSafeInteger(limits[name])&&limits[name]>=liteGraph.knownTensorBytes))throw Error('Static Lite known tensor exceeds declared GPU limits');}
const commands=JSON.parse(fs.readFileSync(path.join(policyDirectory,'local-prepare-commands.json'))),mounts=[];
const singleModelRole=commands.length===1&&['modnet','portrait','lite','rvm'].includes(commands[0].model)?commands[0].model:null;const singleModel=!!singleModelRole;
if(spec.privateLanHttps===true&&(singleModelRole!=='modnet'||policy.profiles.modnet.executionProvider!=='wasm'||spec.modelVariants?.length))throw Error('Private LAN validation requires CPU-only MODNet');
if(!singleModel&&(commands.length!==2||!commands.some(c=>c.model==='hr')||!commands.some(c=>c.model==='matte')))throw Error('Explicit HR/matte or isolated MODNet model set required');
const add=(url,source,expected,{model=false}={})=>{
 const address=new URL(url);if(address.origin!==origin.origin||address.search||address.hash||mounts.some(item=>item.route===address.pathname))throw Error('Invalid/duplicate same-origin mount');
 const file=captured(source),stat=fs.statSync(file);if(!stat.isFile()||stat.size!==expected.bytes)throw Error('Captured artifact length mismatch');
 if(!model&&sha(fs.readFileSync(file))!==expected.sha256)throw Error('Captured artifact SHA mismatch');
 mounts.push({route:address.pathname,source:file,bytes:stat.size,sha256:expected.sha256,verification:model?'Deferred to existing streamed model resource loader':'Build-time SHA verified'});
};
const workers={};let modelCancellation;const auxiliaryCancellation={};
for(const [role,basename] of [['model','model-prepare-worker.js'],['foreground','foreground-worker.js'],['export','export-worker.js'],['thumbnail','thumbnail-worker.js'],['trimap','trimap-worker.js']]){
 if(role==='trimap'&&singleModel)continue;
 const directory=captured(spec.workers[role]),report=JSON.parse(fs.readFileSync(path.join(directory,'report.json')));
 const url=origin.origin+`/validation-workers/${report.bundleSha256}/${basename}`;
 add(url,path.join(directory,basename),{bytes:report.bundleBytes,sha256:report.bundleSha256});workers[role]=url;
 for(const name of fs.readdirSync(directory).filter(name=>/^(NOTICE\.txt|.*LICENSE.*\.txt|.*\.LEGAL\.txt)$/.test(name))){
  const source=path.join(directory,name),bytes=fs.readFileSync(source);add(new URL(name,url).href,source,{bytes:bytes.length,sha256:sha(bytes)});
 }
 if(role==='trimap')add(origin.origin+report.scriptAsset.path,path.join(directory,report.scriptAsset.path.slice(1)),report.scriptAsset);
 if(['foreground','trimap'].includes(role)){const expected='cooperative-'+role+'-cancel-v1';if(report.cancellationProtocol!==undefined&&report.cancellationProtocol!==expected)throw Error('Unknown auxiliary cancellation protocol');auxiliaryCancellation[role+'Cancellation']=report.cancellationProtocol;}
 if(role==='model'){if(report.cancellationProtocol!==undefined&&report.cancellationProtocol!=='cooperative-model-cancel-v1')throw Error('Unknown model cancellation protocol');modelCancellation=report.cancellationProtocol;}
 if(role==='model'&&report.inferenceSupported!==(singleModel?singleModelRole+'-only':'hr-and-matte'))throw Error('Worker model adapters differ from selected model set');
 if(role==='model'&&report.policySha256!==sha(Buffer.from(JSON.stringify(policy))))throw Error('Model Worker embeds a different policy');
}
const descriptors=JSON.parse(fs.readFileSync(path.join(policyDirectory,'models.library.candidate.json')));
if(policy.stagedHr){
 const stagedApp=JSON.parse(fs.readFileSync(captured(spec.stagedApp)));
 if(stagedApp.scope!==policy.scope||stagedApp.distributionApproved!==false||stagedApp.appOrigin!==origin.origin||stagedApp.stageCount!==policy.stagedHr.stages.length)throw Error('Matching staged app required');
 const worker=stagedApp.mounts.find(item=>origin.origin+item.route===policy.stagedHr.worker);
 if(policy.stagedHr.workerFile&&(!worker||policy.stagedHr.workerFile.url!==policy.stagedHr.worker||policy.stagedHr.workerFile.bytes!==worker.bytes||policy.stagedHr.workerFile.sha256!==worker.sha256))throw Error('Stage Worker descriptor mismatch');
 if(!worker||!/^\/validation-workers\/[a-f0-9]{64}\/stage-worker\.js$/.test(worker.route))throw Error('Missing stage Worker');
 add(policy.stagedHr.worker,worker.source,worker);
 for(const item of stagedApp.mounts.filter(item=>item.route.startsWith(path.posix.dirname(worker.route)+'/')&&item.route!==worker.route))add(origin.origin+item.route,item.source,item);
}
for(const command of commands){
 const model=policy.models.find(item=>item.model===command.model),release=validateLibraryPreparation(command,model);
 const descriptor=descriptors.models.find(item=>item.model===model.model);
 if(release.archive){
  const archive=descriptor.archive;
  if(!archive||archive.url!==release.archive.url||archive.bytes!==release.archive.bytes||archive.sha256!==release.archive.sha256)throw Error('Local archive descriptor mismatch');
  add(release.archive.url,captured(archive.sourceArtifact),release.archive,{model:true});
  command.source.archive=release.archive;
 }else if(command.source.archive!==undefined)throw Error('Untrusted local archive descriptor');
 for(const file of model.resources){
  const source=descriptor.resources.find(item=>item.name===file.name);if(!source||source.bytes!==file.bytes||source.sha256!==file.sha256)throw Error('Local model descriptor mismatch');
  const local=model.model==='hr'&&policy.stagedHr?captured(source.sourceArtifact):file.name==='config.json'?path.join(policyDirectory,model.model,'config.json'):path.join(captured(spec.modelDirectories[model.model]),source.sourceArtifact);
  add(file.url,local,file,{model:file.name!=='config.json'});
 }
}
if(runtime.runtimeFamily!=='native'||(policy.runtimeFamily??'native')!=='native')throw Error('Alternative backend was not adopted');
for(const file of runtime.files){
 const name=file.name.endsWith('.mjs')?'mjs':'wasm';
 if(new URL(policy.runtimeAssets[name]).pathname!=='/'+file.key)throw Error('Runtime policy URL differs from verified artifact');
 add(policy.runtimeAssets[name],path.join(runtimeDirectory,file.hosting,file.key),file);
}
for(const file of runtime.notices){
 const key=`runtime/ort/${runtime.version}/${file.file}`;add(origin.origin+'/'+key,path.join(runtimeDirectory,'pages',key),file);
}
// Retain already captured candidate model evidence alongside the private artifact.
// These documents do not approve any model or replace runtime/binary notice audits.
const {modelNoticeSources,modelNoticeFiles}=readModelNoticeDocuments(path.join(repo,'docs/browser/model-notices'));
const config={privateLanHttps:spec.privateLanHttps===true,modelNoticesHref:'/validation-notices/model-candidates/MODEL_CANDIDATE_NOTICES.txt',executionProvider:singleModelRole?(policy.profiles[singleModelRole].executionProvider??'webgpu'):(policy.profiles.hr.executionProvider??'webgpu'),scope:policy.scope,distributionApproved:false,appOrigin:origin.origin,modelCancellation,...auxiliaryCancellation,workers,
 prepareHr:commands.find(command=>command.model==='hr'),prepareBackground:commands.find(command=>['modnet','portrait','lite','rvm'].includes(command.model)),prepareMatte:commands.find(command=>command.model==='matte'),
 modelLabel:singleModel?(singleModelRole==='rvm'?'RVM＋軽量復元（人物向け・CPU）':singleModelRole==='lite'?`BiRefNet lite ${policy.liteInputSize??1024}px（${policy.profiles.lite.executionProvider==='webgpu'?'GPU':'CPU'}・比較検証）`:singleModelRole==='portrait'?(policy.allowPortraitCpuFallback===true?'人物向けモデル（BiRefNet portrait・GPU/CPU併用検証）':'人物向けモデル（BiRefNet portrait）'):(policy.profiles.modnet.executionProvider==='wasm'?'人物向け軽量モデル（MODNet・CPU）':'人物向け軽量モデル（MODNet・GPU）')):'高解像度モデル（BiRefNet HR）',
 modelResourceBytes:commands.flatMap(command=>command.source.resources).reduce((sum,file)=>sum+file.bytes,0)};
// Reuse already assembled private releases; no new loader, model conversion or weight copy.
if(spec.modelVariants){
 if(!Array.isArray(spec.modelVariants)||spec.modelVariants.length>4)throw Error('Invalid local model variants');
 const versions=new Set([(config.prepareBackground??config.prepareHr).modelVersion]);config.modelVariants=[];
 for(const variant of spec.modelVariants){
  const other=JSON.parse(fs.readFileSync(captured(variant.app))),source=other.runtimeConfig;
  if(other.status!=='local-app-built-not-started'||other.distributionApproved!==false||other.appOrigin!==origin.origin||!source
   ||typeof variant.label!=='string'||!variant.label||typeof variant.description!=='string'||!variant.description)throw Error('Trusted local variant app required');
  if(!isDeepStrictEqual(other.runtimeVerification,runtimeVerification))throw Error('Variant runtime verification differs from primary');
  if(source.modelCancellation!==undefined&&source.modelCancellation!=='cooperative-model-cancel-v1')throw Error('Unknown variant model cancellation protocol');
  const background=source.prepareBackground??source.prepareHr;
  if(!['hr','modnet','portrait','lite','rvm'].includes(background?.model)||versions.has(background.modelVersion))throw Error('Duplicate/invalid local variant');versions.add(background.modelVersion);
  const thumbnail=new URL(source.workers.thumbnail);
  if(thumbnail.origin!==origin.origin||!/^\/validation-workers\/[a-f0-9]{64}\/thumbnail-worker\.js$/.test(thumbnail.pathname))throw Error('Invalid variant thumbnail Worker');
  // The primary configuration owns thumbnail processing for every model choice.
  const unusedThumbnail=thumbnail.href!==workers.thumbnail?new URL('.',thumbnail).pathname:null;
  for(const item of other.mounts.filter(item=>/^\/(models|model-archives|runtime|validation-workers)\//.test(item.route)&&!(unusedThumbnail&&item.route.startsWith(unusedThumbnail)))){
   const existing=mounts.find(m=>m.route===item.route);
   if(existing){if(existing.bytes!==item.bytes||existing.sha256!==item.sha256)throw Error('Variant mount conflict');continue;}
   add(origin.origin+item.route,item.source,item,{model:item.route.startsWith('/models/')||item.route.startsWith('/model-archives/')});
  }
  for(const command of [background,source.prepareMatte].filter(Boolean))for(const resource of [...command.source.resources,...(command.source.archive?[command.source.archive]:[])]){
   if(!mounts.some(item=>origin.origin+item.route===resource.url&&item.bytes===resource.bytes&&item.sha256===resource.sha256))throw Error('Variant resource missing');
  }
  if(variant.defaultRefine!==undefined&&(typeof variant.defaultRefine!=='boolean'||(variant.defaultRefine&&!source.prepareMatte)))throw Error('Invalid variant default refinement');
  config.modelVariants.push({defaultRefine:variant.defaultRefine??false,executionProvider:source.executionProvider??'webgpu',modelCancellation:source.modelCancellation,prepareBackground:background,prepareMatte:source.prepareMatte,modelWorker:source.workers.model,label:variant.label,description:variant.description});
  if(source.workers.trimap){if(source.trimapCancellation!==undefined&&source.trimapCancellation!=='cooperative-trimap-cancel-v1')throw Error('Unknown variant trimap cancellation protocol');workers.trimap=source.workers.trimap;config.trimapCancellation=source.trimapCancellation;}
 }
}
let cropResize=null;
if(spec.cropResize){
 const file=captured(spec.cropResize.file),bytes=fs.readFileSync(file);
 if(bytes.length>65536||bytes.length!==spec.cropResize.bytes||sha(bytes)!==spec.cropResize.sha256)throw Error('Invalid crop resize artifact');
 cropResize={url:origin.origin+'/validation-assets/'+sha(bytes)+'/crop-resize.wasm',bytes:bytes.length,sha256:sha(bytes)};add(cropResize.url,file,cropResize);
}
fs.mkdirSync(output,{mode:0o700});
const noticeOutput=path.join(output,'app/validation-notices/model-candidates');fs.mkdirSync(noticeOutput,{recursive:true,mode:0o700});
for(const [name,bytes] of modelNoticeFiles)fs.writeFileSync(path.join(noticeOutput,name),bytes,{flag:'wx',mode:0o600});
const combinedModelNotices=['Candidate model documents for private comparison only. Includes unused candidates. Not a distribution approval or a complete binary license audit. Application MIT license does not replace model terms.',...modelNoticeSources.documents.map(document=>[document.file,document.scope??'',document.url??'',`SHA256: ${document.sha256}`,modelNoticeFiles.get(document.file).toString('utf8')].join('\n'))].join('\n\n');
fs.writeFileSync(path.join(noticeOutput,'MODEL_CANDIDATE_NOTICES.txt'),combinedModelNotices+'\n',{flag:'wx',mode:0o600});

const {build}=await import(pathToFileURL(path.join(repo,'web/node_modules/vite/dist/node/index.js')).href);
await build({root:path.join(repo,'web'),configFile:path.join(repo,'web/vite.config.ts'),logLevel:'warn',define:{__CROP_RESIZE__:JSON.stringify(cropResize)},plugins:[{
 name:'private-local-validation-config',resolveId(id){if(id==='image-studio-local-config')return '\0image-studio-local-config';},
 load(id){if(id==='\0image-studio-local-config')return 'export default '+JSON.stringify(config);},
}],build:{outDir:path.join(output,'app'),emptyOutDir:false,rolldownOptions:{input:path.join(repo,'web/local-validation.html')}}});
// Append only already captured Worker/runtime notice assets to the private app's
// existing notice endpoint. This does not infer complete binary license coverage.
const runtimeNoticeMounts=mounts.filter(item=>/^\/(runtime|validation-workers|validation-assets)\//.test(item.route)&&/^(NOTICE\.txt|.*LICENSE.*\.txt|.*\.LEGAL\.txt|ThirdPartyNotices\.txt)$/i.test(path.posix.basename(item.route))).sort((a,b)=>a.route.localeCompare(b.route));
const runtimeNoticeGroups=new Map();
for(const item of runtimeNoticeMounts){
 const content=fs.readFileSync(item.source);if(content.length!==item.bytes||sha(content)!==item.sha256)throw Error('Runtime notice changed during assembly');
 const group=runtimeNoticeGroups.get(item.sha256);if(group)group.routes.push(item.route);else runtimeNoticeGroups.set(item.sha256,{routes:[item.route],sha256:item.sha256,content});
}
const runtimeNoticeText=['Private comparison Worker/runtime documents. Captured notices only; not a complete binary/toolchain license audit. Candidate model documents are provided separately.',...[...runtimeNoticeGroups.values()].map(item=>[...item.routes,`SHA256: ${item.sha256}`,item.content.toString('utf8')].join('\n'))].join('\n\n');
fs.appendFileSync(path.join(output,'app/THIRD_PARTY_NOTICES.txt'),'\n\n'+runtimeNoticeText+'\n');
const marker={privateLanHttps:spec.privateLanHttps===true,scope:policy.scope,distributionApproved:false,appOrigin:origin.origin,policySha256:sha(fs.readFileSync(path.join(policyDirectory,'local-runtime-policy.json')))};
fs.writeFileSync(path.join(output,'app/LOCAL_VALIDATION_ONLY.json'),JSON.stringify(marker,null,2)+'\n');
const visit=directory=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
 const file=path.join(directory,entry.name);if(entry.isDirectory())visit(file);else{const bytes=fs.readFileSync(file),relative=path.relative(path.join(output,'app'),file).split(path.sep).join('/');add(origin.origin+'/'+relative,file,{bytes:bytes.length,sha256:sha(bytes)});}
}};visit(path.join(output,'app'));
const report={status:'local-app-built-not-started',...marker,entry:'/local-validation.html',runtimeConfig:config,backgroundModel:singleModel?singleModelRole:'hr',cropResize,mounts,runtimeVerification,
 bundledRuntimeNotices:runtimeNoticeMounts.map(({route,bytes,sha256})=>({route,bytes,sha256})),distinctRuntimeNoticeDocuments:runtimeNoticeGroups.size,
 modelResourceBytes:config.modelResourceBytes,weightFilesRead:0,serversStarted:0,browsersStarted:0,
 limits:['No model/OpenCV initialization, inference, actual browser or CORS/CSP acceptance','Loopback same-origin assembly only; production Pages/R2 remains separate and unapproved','Model sizes checked without rereading weights; existing resource policy must verify each SHA before model loading']};
fs.writeFileSync(path.join(output,'local-app.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,mounts:mounts.length,modelResourceBytes:config.modelResourceBytes,weightFilesRead:0}));
