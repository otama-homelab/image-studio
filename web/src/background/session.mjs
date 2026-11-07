import {MAX_HR_STAGES} from '../../../tools/browser-library-adapter/stage-tensors.mjs';
import {createImageRegistry} from '../../../tools/browser-library-adapter/image-registry.mjs';
import {createAlphaCommitter} from '../../../tools/browser-library-adapter/alpha-commit.mjs';
import {createInferenceOperation} from '../../../tools/browser-library-adapter/inference-operation.mjs';
import {createSerialInference} from '../../../tools/browser-library-adapter/serial-inference.mjs';
import {createExportJobs} from '../../../tools/browser-library-adapter/export-job.mjs';
import {workerFailure} from '../../../tools/browser-library-adapter/worker-failure.mjs';

/** Application ownership only. Pixel operations, Workers and encoding stay in existing adapters.
 * No model/resource work occurs until run(). Factories receive the page's shared admission gate.
 */
export function createBackgroundSession({gate,prepareHr,prepareBackground,prepareMatte,makeTrimap,defaultRefine=false,modelVariants=/** @type {Array<{prepareBackground:any,prepareMatte?:any,defaultRefine?:boolean}>} */ ([]),
 createModelClient,createForegroundClient,createExportClient,createTrimapClient=/** @type {Function|null} */ (null),onChange=/** @type {(state: any) => void} */ ((_state)=>{})}){
 if((prepareHr&&prepareBackground)||(prepareHr&&prepareHr.model!=='hr'))throw Error('invalid-model-set');
 const validate=(background,matte)=>{
  if(!['hr','modnet','portrait','lite'].includes(background?.model)||typeof background.modelVersion!=='string'||!background.modelVersion
   ||(matte&&(background.model!=='hr'||matte.model!=='matte'||matte.modelVersion!==background.modelVersion)))throw Error('invalid-model-set');
 };
 let hr=structuredClone(prepareBackground??prepareHr),matte=prepareMatte?structuredClone(prepareMatte):null;
 validate(hr,matte);
 const refinementDefault=(value,matte)=>{
  if(typeof value!=='boolean'||(value&&(!matte||(typeof makeTrimap!=='function'&&typeof createTrimapClient!=='function'))))throw Error('invalid-default-refinement');
  return value;
 };
 const models=new Map([[hr.modelVersion,{background:hr,matte,defaultRefine:refinementDefault(defaultRefine,matte)}]]);
 for(const variant of modelVariants){
  const background=structuredClone(variant.prepareBackground),matte=variant.prepareMatte?structuredClone(variant.prepareMatte):null;
  validate(background,matte);if(models.has(background.modelVersion))throw Error('invalid-model-set');
  models.set(background.modelVersion,{background,matte,defaultRefine:refinementDefault(variant.defaultRefine??false,matte)});
 }
 const registry=createImageRegistry(),owner='background-photo-'+crypto.randomUUID();
 let current=null,revision=0,refine=defaultRefine,closed=false,closing=null,working=false;
 const maskOwner='background-mask-'+crypto.randomUUID();let backgroundMask=null;
 const clearBackgroundMask=()=>{if(backgroundMask)registry.release(backgroundMask.id,maskOwner);backgroundMask=null;};
 const matchingBackgroundMask=context=>!!backgroundMask&&context?.rgbAssetId===backgroundMask.rgbAssetId
  &&context?.key.modelVersion===backgroundMask.modelVersion;

 let model=null,foreground=null,exportClient=null,trimap=null;
 let phase='idle',modelRole=null,resourceProgress=null,resourceError=null,inferenceError=null,stageProgress=null,lastFailure=null;
 const retainFailure=(code='runtime-error')=>{lastFailure??=Object.freeze({
  phase:['model-load','inference','releasing','trimap','foreground','export'].includes(phase)?phase:null,
  modelRole:phase!=='export'&&['hr','modnet','portrait','lite','matte'].includes(modelRole)?modelRole:null,
  code:workerFailure({},code).code,
 });};
 const getCurrent=()=>current;
 const committer=createAlphaCommitter({registry,getCurrent});
 const publish=()=>{try{onChange(snapshot());}catch{}};
 const result=()=>{const value=committer.get();return value?.status==='valid'&&value.cutout?value:null;};
 function snapshot(){return Object.freeze({hasPhoto:!!current,hasBackgroundMask:matchingBackgroundMask(current),refine,modelId:hr.modelVersion,refineAvailable:!!matte&&(typeof makeTrimap==='function'||typeof createTrimapClient==='function'),running:operation.getState().running,
  busy:working||operation.getState().running||operation.getState().stopping||exports.getState().busy,
  hasResult:!!result(),blocked:operation.getState().blocked||exports.getState().blocked||gate.getState().blocked,closed,phase,modelRole,resourceProgress,resourceError,inferenceError,stageProgress,lastFailure});}
 const exports=createExportJobs({registry,getCurrent(options){
  const value=result();if(!value||!['transparent','background'].includes(options.kind))return null;
  return {assetId:value.cutout.id,dependencyKey:JSON.stringify(value.key)};
 },encode(image,options,hooks){
  exportClient??=createExportClient({gate});return exportClient.encode(image,options,hooks);
 }});
 const operation=createInferenceOperation({gate,getCurrent,committer,
  async cancelOwned(){
   // Stop every owned resource even when one shutdown fails.
   const stopped=await Promise.allSettled([model?.cancel(),foreground?.close(),trimap?.close()]);
   model=null;foreground=null;trimap=null;
   if(stopped.some(item=>item.status==='rejected'))throw Error('background-stop-failed');
  },
  async execute(context,hooks){
   const client=createModelClient({modelVersion:hr.modelVersion,gate:hooks.workerGate,onEvent:event=>{
    if(model!==client||!hooks.isCurrent())return;
    if(event?.type==='error'){retainFailure(event.code);inferenceError=event.code==='device-lost'?'device-lost':null;publish();return;}
    if(event?.type==='progress'&&event.phase==='hr'&&phase==='inference'&&modelRole==='hr'
     &&Number.isSafeInteger(event.totalStages)&&event.totalStages>0&&event.totalStages<=MAX_HR_STAGES
     &&Number.isSafeInteger(event.completedStages)&&event.completedStages>=0&&event.completedStages<=event.totalStages){
     if(stageProgress&&(stageProgress.totalStages!==event.totalStages||stageProgress.completedStages>event.completedStages))return;
     stageProgress=Object.freeze({completedStages:event.completedStages,totalStages:event.totalStages});publish();return;
    }
    if(event?.type!=='resource-state'||!Array.isArray(event.resources))return;
    const files=(modelRole==='matte'?matte:hr)?.source?.resources??[];
    const stored=files.filter(file=>event.resources.some(item=>item.stored===true&&item.sha256===file.sha256&&item.bytes===file.bytes)).reduce((sum,file)=>sum+file.bytes,0);
    if(resourceProgress&&stored<=resourceProgress.totalBytes)resourceProgress=Object.freeze({...resourceProgress,storedBytes:stored});
    const error=event.resources.find(item=>['cache-quota-exceeded','cache-write-failed','checksum-mismatch','bytes-mismatch','bytes-overflow','transport-failed','resource-rate-limited','resource-access-denied'].includes(item.lastError));
    resourceError=error?.lastError??null;publish();
   }});model=client;
   const observedClient={request(command){
    if(command.type==='prepare'){
     phase='model-load';modelRole=command.model;stageProgress=null;
     resourceProgress=Object.freeze({storedBytes:0,totalBytes:command.source?.resources?.reduce((sum,file)=>sum+file.bytes,0)??0});
    }else if(command.type==='infer')phase='inference';else if(command.type==='dispose')phase='releasing';
    publish();return client.request(command);
   }};
   const make=typeof createTrimapClient==='function'?async(alpha,{workerGate})=>{
    phase='trimap';publish();
    const client=createTrimapClient({gate:workerGate});trimap=client;
    try{return await client.make(alpha);}finally{await client.close();if(trimap===client)trimap=null;}
   }:typeof makeTrimap==='function'?async(...args)=>{phase='trimap';publish();return makeTrimap(...args);}:makeTrimap;
   const execute=createSerialInference({registry,client:observedClient,prepareBackground:hr,prepareMatte:matte,makeTrimap:make,
    getBackgroundAlpha(context){
     if(!matchingBackgroundMask(context))return null;
     const image=registry.copy(backgroundMask.id);return {width:image.width,height:image.height,layout:'alpha-u8',data:image.data};
    },
    onBackgroundAlpha(alpha,context){
     if(!matte||closed||current?.rgbAssetId!==context.rgbAssetId||current?.key.modelVersion!==context.key.modelVersion)return;
     const image=registry.register({width:alpha.width,height:alpha.height,format:'alpha-u8',data:alpha.data.slice(0)},maskOwner);
     clearBackgroundMask();backgroundMask={id:image.id,rgbAssetId:context.rgbAssetId,modelVersion:context.key.modelVersion};
    },
    async recoverForeground(input,{workerGate}){
     phase='foreground';publish();
     const client=createForegroundClient({gate:workerGate,rgba:true});foreground=client;
     try{return await client.estimate(input);}finally{await client.close();if(foreground===client)foreground=null;}
    }});
   const value=await execute(context,hooks);model=null;return value;
  }});
 const idle=()=>{
  if(closed)throw Error('background-session-closed');
  if(snapshot().busy)throw Error('background-session-busy');
  if(snapshot().blocked)throw Error('background-session-unavailable');
 };
 function invalidate(){
  inferenceError=null;lastFailure=null;
  if(current)current={...current,key:{...current.key,inferenceRevision:++revision},refine};
  committer.get();exports.reconcile();
 }
 return Object.freeze({
  getState:snapshot,
  setModel(id){
   idle();const next=models.get(id);if(!next)throw Error('unknown-background-model');
   if(id===hr.modelVersion)return;
   clearBackgroundMask();hr=next.background;matte=next.matte;refine=next.defaultRefine;
   if(current)current={...current,key:{...current.key,modelVersion:id}};
   invalidate();resourceProgress=null;resourceError=null;stageProgress=null;publish();
  },
  setPhoto(image){
   idle();
   if(image?.format!=='rgb-u8'||image.width>2000||image.height>2000)throw Error('invalid-inference-image');
   // Validate/register before releasing the accepted photo and its results.
   const asset=registry.register(image,owner),previous=current;clearBackgroundMask();
   current={rgbAssetId:asset.id,refine,key:{inputId:crypto.randomUUID(),inferenceRevision:++revision,modelVersion:hr.modelVersion}};
   committer.get();exports.reconcile();if(previous)registry.release(previous.rgbAssetId,owner);resourceError=null;inferenceError=null;lastFailure=null;resourceProgress=null;publish();
  },
  setRefine(value){
   idle();if(typeof value!=='boolean'||(value&&(!matte||(typeof makeTrimap!=='function'&&typeof createTrimapClient!=='function'))))throw Error('refinement-unavailable');
   if(refine!==value){refine=value;invalidate();publish();}
  },
  async run(){
   idle();if(!current)throw Error('background-photo-required');
   working=true;resourceError=null;inferenceError=null;lastFailure=null;resourceProgress=null;stageProgress=null;modelRole=null;publish();
   try{return await operation.start();}
   catch(error){if(!closed&&phase!=='stopping')retainFailure();throw error;}
   finally{working=false;phase='idle';exports.reconcile();publish();}
  },
  async save(options){
   idle();if(!['transparent','background'].includes(options?.kind)||(options.kind==='background'&&!options.backgroundColor))throw Error('invalid-background-export');
   working=true;phase='export';lastFailure=null;publish();
   try{return await exports.start(options);}
   catch(error){if(!closed&&phase!=='stopping')retainFailure();throw error;}
   finally{working=false;phase='idle';publish();}
  },
  getPrepared:options=>exports.getReady(options),
  async cancel(){
   phase='stopping';publish();
   const stopped=await Promise.allSettled([operation.cancel(),exports.cancelAndWait()]);publish();
   if(!working)phase='idle';publish();
   if(stopped.some(item=>item.status==='rejected'))throw Error('background-stop-failed');
  },
  close(){
   if(closing)return closing;
   closed=true;
   closing=(async()=>{
    const stopped=await Promise.allSettled([operation.cancel(),exports.cancelAndWait(),exportClient?.close()]);
    committer.close();exports.clear();clearBackgroundMask();if(current){registry.release(current.rgbAssetId,owner);current=null;}publish();
    if(stopped.some(item=>item.status==='rejected'))throw Error('background-stop-failed');
   })();return closing;
  },
 });
}
