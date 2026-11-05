import {releaseAssetPath} from '../../tools/browser-library-adapter/release-asset.mjs';
import {createResourcePolicy} from '../../tools/browser-library-adapter/resource-policy.mjs';
import {validateModelArchiveFiles} from '../../tools/browser-library-adapter/model-archive.mjs';
import {createModelCacheActions} from '../../tools/browser-library-adapter/model-cache-actions.mjs';
const invalid=()=>{throw Error('invalid-background-release');};
const keys=(value,allowed)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))invalid();};
const text=(value,max)=>{if(typeof value!=='string'||!value.trim()||value.length>max)invalid();};
const id=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value))invalid();};
const unused=()=>{throw Error('Build validation must not access network, cache, models or GPU');};
/** Validate the serialized four-choice release contract. This is not a live Hub or rights approval. */
export function parseBackgroundRelease(definition){
 try{
  const config=typeof definition==='string'?JSON.parse(definition):definition??null;
  if(config===null)return null;
  keys(config,['workers','modelNoticesHref','executionProvider','modelLabel','downloadDescription','modelCancellation','foregroundCancellation','trimapCancellation','prepareBackground','prepareMatte','defaultRefine','modelVariants']);
  keys(config.workers,['model','foreground','export','thumbnail','trimap']);
  for(const role of ['model','foreground','export','thumbnail','trimap'])releaseAssetPath(config.workers[role],'js');
  releaseAssetPath(config.modelNoticesHref,'txt');text(config.modelLabel,200);text(config.downloadDescription,2000);
  if(config.foregroundCancellation!=='cooperative-foreground-cancel-v1'||config.trimapCancellation!=='cooperative-trimap-cancel-v1'||!Array.isArray(config.modelVariants)||config.modelVariants.length!==3)invalid();
  const choices=[{...config,modelWorker:config.workers.model},...config.modelVariants],versions=new Set(),pairs=new Set(),workers=new Set(),archives=new Map(),resources=new Map(),releases=[];
  let hub=null,totalArchiveBytes=0;
  const fixedUrl=value=>{
   const url=new URL(value),match=url.href.match(/^(https:\/\/huggingface\.co\/[\w.-]+\/[\w.-]+\/resolve\/[a-f0-9]{40}\/)/);
   if(!match||url.href!==value||url.username||url.password||url.search||url.hash)invalid();
   if(hub!==null&&hub!==match[1])invalid();hub=match[1];
  };
  const command=(value,role)=>{
   keys(value,['type','model','modelVersion','source']);if(value.type!=='prepare'||value.model!==role)invalid();id(value.modelVersion);
   const source=value.source;keys(source,['mode','releaseId','cacheNamespace','resources','archive']);
   if(source.mode!=='library-resources')invalid();id(source.releaseId);
   validateModelArchiveFiles(source.resources);
   for(const file of source.resources){
    keys(file,['name','url','bytes','sha256']);fixedUrl(file.url);
    const prior=resources.get(file.url);if(prior&&(prior.bytes!==file.bytes||prior.sha256!==file.sha256))invalid();resources.set(file.url,file);
   }
   keys(source.archive,['url','bytes','sha256']);fixedUrl(source.archive.url);
   if(!source.archive.url.endsWith('.zip'))invalid();
   const memberBytes=source.resources.reduce((sum,file)=>sum+file.bytes,0);
   if(!Number.isSafeInteger(memberBytes)||source.archive.bytes<memberBytes)invalid();
   createResourcePolicy({files:source.resources,fetchImpl:unused,makeHasher:unused,cache:{match:unused,put:unused}});
   createResourcePolicy({files:[source.archive],fetchImpl:unused,makeHasher:unused,cache:{match:unused,put:unused}});
   const members=source.resources.map(({name,url,bytes,sha256})=>({name,url,bytes,sha256})).sort((a,b)=>a.name.localeCompare(b.name));
   const identity=JSON.stringify({bytes:source.archive.bytes,sha256:source.archive.sha256,members});
   if(archives.has(source.archive.url)&&archives.get(source.archive.url)!==identity)invalid();
   if(!archives.has(source.archive.url))totalArchiveBytes+=source.archive.bytes;
   if(!Number.isSafeInteger(totalArchiveBytes))invalid();archives.set(source.archive.url,identity);releases.push(source);
   return value;
  };
  for(const [index,choice] of choices.entries()){
   if(index>0){keys(choice,['modelWorker','label','description','executionProvider','modelCancellation','defaultRefine','prepareBackground','prepareMatte']);text(choice.label,200);text(choice.description,2000);}
   releaseAssetPath(choice.modelWorker,'js');if(workers.has(choice.modelWorker))invalid();workers.add(choice.modelWorker);
   if(!['wasm','webgpu'].includes(choice.executionProvider)||choice.modelCancellation!=='cooperative-model-cancel-v1'||!['hr','modnet'].includes(choice.prepareBackground?.model))invalid();
   const model=command(choice.prepareBackground,choice.prepareBackground.model),pair=model.model+':'+choice.executionProvider;
   if(pairs.has(pair)||versions.has(model.modelVersion))invalid();pairs.add(pair);versions.add(model.modelVersion);
   if(model.model==='hr'){
    const matte=command(choice.prepareMatte,'matte');if(choice.defaultRefine!==true||matte.modelVersion!==model.modelVersion)invalid();
   }else if(choice.prepareMatte!==undefined||(choice.defaultRefine!==undefined&&choice.defaultRefine!==false))invalid();
  }
  if(config.prepareBackground.model!=='modnet'||config.executionProvider!=='wasm'||archives.size!==5)invalid();
  const light=choices.filter(choice=>choice.prepareBackground.model==='modnet').map(choice=>choice.prepareBackground.source);
  if(light[0].cacheNamespace!==light[1].cacheNamespace||light[0].archive.url!==light[1].archive.url)invalid();
  const scope=createModelCacheActions({releases,gate:{tryAcquire:unused},cacheStorage:unused}).getScope();
  if(!Number.isSafeInteger(scope.expectedBytes))invalid();
  return config;
 }catch{throw Error('invalid-background-release');}
}
