/** Offline descriptor/config preparation. Never reads/copies weights or performs network I/O. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createOrtRuntimeBootstrap} from './browser-library-adapter/ort-runtime-bootstrap.mjs';
import {validateLibraryPreparation} from './browser-library-adapter/preparation-source.mjs';
const [weightsRoot,output,localSettingsFile]=process.argv.slice(2);if(!weightsRoot||!output||fs.existsSync(output))throw Error('Need CAPTURED_WEIGHTS_CONFIG_ROOT NEW_PRIVATE_OUTPUT [LOCAL_VALIDATION_SETTINGS]');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),sourceBytes=fs.readFileSync(path.join(repo,'docs/browser/models.candidate.json')),source=JSON.parse(sourceBytes),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const configSources=JSON.parse(fs.readFileSync(path.join(repo,'docs/browser/validation/2026-11-01-model-config-revisions.json'),'utf8'));
if(configSources.status!=='fixed-revision-config-fetched')throw Error('Missing fixed config evidence');
const selected=[['hr','onnx-birefnet-grid-03-fp32-means-01','birefnet'],['matte','onnx-vitmatte-03','vitmatte']];
const plans=selected.map(([role,id,directory])=>{
 const model=source.models.find(item=>item.id===id);if(!model||model.role!==role||model.input.dtype!==(role==='hr'?'float16':'float32'))throw Error('Unexpected fixed candidate');
 const originalConfig=fs.readFileSync(path.join(weightsRoot,directory,'config.json'));if(originalConfig.length>65536)throw Error('Config oversized');const original=JSON.parse(originalConfig);
 if(role==='matte'&&(original.model_type!=='vitmatte'||original.hidden_size!==768))throw Error('Expected Base ViTMatte config');
 const configSource=configSources.records.find(record=>record.sourceCandidateId===id&&record.revision===model.source.revision&&record.repository===model.source.repository);
 if(!configSource||configSource.bytes!==originalConfig.length||configSource.sha256!==sha(originalConfig))throw Error('Fixed revision config mismatch');
 const config=role==='hr'?Buffer.from(JSON.stringify({model_type:'custom',_name_or_path:model.source.repository},null,2)+'\n'):originalConfig;
 const graph=model.files.find(file=>file.name.endsWith('.onnx')),external=model.files.find(file=>file.name==='model.onnx.data');if(!graph||!external)throw Error('Missing fixed graph or external weights');
 return {role,model,config,originalConfig,graph,external,directory};
});
fs.mkdirSync(output,{mode:0o700});const models=[];
for(const plan of plans){
 const {role,model,config,originalConfig,graph,external}=plan,directory=path.join(output,role);fs.mkdirSync(directory,{mode:0o700});fs.writeFileSync(path.join(directory,'config.json'),config);fs.writeFileSync(path.join(directory,'source-config.json'),originalConfig);
 const alias=role==='hr'?'onnx/model_fp16.onnx':'onnx/model.onnx';
 models.push({model:role,modelVersion:'candidate-not-approved',releaseId:'candidate-not-approved',cacheNamespace:null,sourceCandidateId:model.id,precision:model.precision,input:model.input,output:model.output,source:model.source,configProvenance:{kind:role==='hr'?'Browser routing config derived; Python auto_map excluded':'Captured Base config copied byte-for-byte',sourceConfigSha256:sha(originalConfig),fixedRevisionConfigFileVerified:true,sourceConfigUrl:configSources.records.find(record=>record.sourceCandidateId===model.id).url},resources:[{name:'config.json',url:null,bytes:config.length,sha256:sha(config),localConfig:role+'/config.json'},{name:alias,url:null,bytes:graph.bytes,sha256:graph.sha256,sourceArtifact:graph.name},{name:'onnx/model.onnx.data',url:null,bytes:external.bytes,sha256:external.sha256,sourceArtifact:external.name}],license:model.license,distributionApproved:false});
}
const report={status:'candidate-descriptors-only-not-deployed',sourceManifestSha256:sha(sourceBytes),runtime:'ORT Web1.31.1, Transformers4.3.2 shared Tensor binding candidate',models,limits:['Graph/weight bytes were not read or copied; alias preserves recorded bytes/SHA only','Actual origins/cache namespaces, model license/quality adoption remain','Not a valid runtime policy: null URLs/namespaces deliberately prevent preparation','No downloads/models/GPU/browser/runtime initialized']};fs.writeFileSync(path.join(output,'models.library.candidate.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,roles:models.map(model=>({role:model.model,precision:model.precision,graph:model.resources[1].name})),weightFilesRead:0}));
if(localSettingsFile){
 const settings=JSON.parse(fs.readFileSync(localSettingsFile,'utf8'));
 // Local validation is a separate artifact, never an approval or production release.
 for(const key of ['appOrigin','modelOrigin','wasmOrigin']){
  const url=new URL(settings[key]);if(url.origin!==settings[key]||url.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Local validation requires explicit loopback origins');
 }
 const releaseId='local-candidate-'+sha(Buffer.from(JSON.stringify(models.map(model=>({model:model.model,source:model.source,resources:model.resources.map(({name,bytes,sha256})=>({name,bytes,sha256}))}))))).slice(0,24);
 const localModelPath=settings.modelOrigin+'/models/'+releaseId+'/';
 if(settings.runtimeFamily!==undefined&&settings.runtimeFamily!=='native')throw Error('Alternative backend was not adopted');
 const runtime=JSON.parse(fs.readFileSync(path.join(repo,'docs/browser/runtime-assets.candidate.json'),'utf8'));
 const runtimeAssets=Object.fromEntries(runtime.files.map(file=>[file.name.endsWith('.mjs')?'mjs':'wasm',
  (file.hosting==='pages'?settings.appOrigin:settings.wasmOrigin)+`/runtime/ort/${runtime.version}/${file.sha256}/${file.name}`]));
 const bound=models.map(model=>({...model,modelVersion:releaseId,releaseId,cacheNamespace:'image-studio-'+releaseId+'-'+model.model,
  resources:model.resources.map(file=>({name:file.name,url:localModelPath+model.model+'/'+file.name,bytes:file.bytes,sha256:file.sha256}))}));
 const prepareCommands=bound.map(model=>({type:'prepare',model:model.model,modelVersion:model.modelVersion,
  source:{mode:'library-resources',releaseId,cacheNamespace:model.cacheNamespace,resources:model.resources}}));
 for(let i=0;i<bound.length;i++){
  validateLibraryPreparation(prepareCommands[i],bound[i]);
  // Reuse bootstrap's pure policy admission; configureRuntime is deliberately never called.
  createOrtRuntimeBootstrap({ort:{env:{versions:{web:'1.31.1'},wasm:{},webgpu:{}}},gpu:{requestAdapter(){throw Error('Offline preparation must not request a GPU');}},
   origin:settings.appOrigin,wasmOrigin:settings.wasmOrigin,runtimeAssets,requiredLimits:settings.profiles?.[bound[i].model]?.requiredLimits,storageBufferCacheMode:settings.profiles?.[bound[i].model]?.storageBufferCacheMode,maxNumPendingDispatches:settings.profiles?.[bound[i].model]?.maxNumPendingDispatches});
 }
 const processorBytes=fs.readFileSync(path.join(weightsRoot,'vitmatte/preprocessor_config.json'));
 const processorSource=configSources.preprocessor;
 if(!processorSource||processorSource.revision!==plans.find(plan=>plan.role==='matte').model.source.revision
  ||processorSource.sha256!==sha(processorBytes)||processorSource.bytes!==processorBytes.length)throw Error('Unverified fixed matte processor config');
 const policy={scope:'local-validation-only-not-approved-for-distribution',distributionApproved:false,recordLocalLoadErrors:true,appOrigin:settings.appOrigin,
  wasmOrigin:settings.wasmOrigin,localModelPath,runtimeAssets,profiles:settings.profiles,models:bound,
  enableHrInference:true,enableMatteInference:true,hrResizeMaxMemoryBytes:134217728,matteProcessor:JSON.parse(processorBytes)};
 fs.writeFileSync(path.join(output,'local-runtime-policy.json'),JSON.stringify(policy,null,2)+'\n');
 fs.writeFileSync(path.join(output,'local-prepare-commands.json'),JSON.stringify(prepareCommands,null,2)+'\n');
 fs.writeFileSync(path.join(output,'local-mounts.json'),JSON.stringify({status:'mount-plan-only-no-server-started',releaseId,
  models:bound.map((model,index)=>({role:model.model,resources:model.resources.map((file,i)=>({...file,
   localSource:i===0?path.join(output,model.model,'config.json'):null,sourceCandidateId:plans[index].model.id,sourceArtifact:models[index].resources[i].sourceArtifact??null}))})),
  limits:['Weights must be mounted from the captured verified artifacts; no copying or model download performed','Production URLs, licenses, quality/resource acceptance and deployment remain unapproved']},null,2)+'\n');
 console.log(JSON.stringify({status:policy.scope,releaseId,modelResourceBytes:bound.flatMap(model=>model.resources).reduce((sum,file)=>sum+file.bytes,0),gpuRequests:0}));
}
