import {ImageRegistryError} from './image-registry.mjs';
const sameKey=(a,b)=>!!a&&!!b&&a.inputId===b.inputId&&a.inferenceRevision===b.inferenceRevision&&a.modelVersion===b.modelVersion;

/** Final domain-key guard after Worker admission, before allocating an alpha asset. */
export function createAlphaCommitter({registry,getCurrent}){
 const owner='alpha-result-'+crypto.randomUUID();let record=null,sourceId=null,closed=false;
 const release=value=>{registry.release(value.image.id,owner);if(value.cutout)registry.release(value.cutout.id,owner);};
 const clear=()=>{if(record)release(record);record=null;sourceId=null;};
 const reconcile=current=>{
  if(record&&(!current||current.key.inputId!==record.key.inputId||current.rgbAssetId!==sourceId))clear();
 };
 return Object.freeze({
  commit(result){
   if(closed)throw new ImageRegistryError('alpha-owner-closed');
   const current=getCurrent();reconcile(current);
   if(!current||!sameKey(result?.key,current.key))return {status:'stale'};
   const source=registry.get(current.rgbAssetId),alpha=result.alpha;
   if(source.format!=='rgb-u8'||!alpha||alpha.layout!=='alpha-u8'||alpha.width!==source.width||alpha.height!==source.height
    ||!(alpha.data instanceof ArrayBuffer)||alpha.data.byteLength!==source.width*source.height)throw new ImageRegistryError('invalid-alpha-result');
   const rgba=result.cutout;
   if(rgba!==undefined&&(!rgba||rgba.format!=='rgba-u8'||rgba.width!==source.width||rgba.height!==source.height||!(rgba.data instanceof ArrayBuffer)||rgba.data.byteLength!==source.width*source.height*4))throw new ImageRegistryError('invalid-cutout-result');
   const image=registry.register({width:alpha.width,height:alpha.height,format:'alpha-u8',data:alpha.data},owner);
   let cutout;
   try{if(rgba)cutout=registry.register(rgba,owner);}catch(error){registry.release(image.id,owner);throw error;}
   const previous=record;
   record=Object.freeze({image,...(cutout?{cutout}:{}),key:Object.freeze({inputId:current.key.inputId,inferenceRevision:current.key.inferenceRevision,modelVersion:current.key.modelVersion})});
   sourceId=current.rgbAssetId;
   if(previous)release(previous);
   return {status:'committed',image,...(cutout?{cutout}:{})};
  },
  get(){
   if(closed)return null;
   const current=getCurrent();reconcile(current);
   return record?Object.freeze({...record,status:sameKey(record.key,current?.key)?'valid':'stale'}):null;
  },
  close(){if(!closed){closed=true;clear();}},
 });
}
