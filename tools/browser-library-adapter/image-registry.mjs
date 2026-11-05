const channels=Object.freeze({'rgb-u8':3,'rgba-u8':4,'alpha-u8':1});
export class ImageRegistryError extends Error {
 constructor(code){super(code);this.name='ImageRegistryError';this.code=code;}
}
const fail=code=>{throw new ImageRegistryError(code);};

/** Main-thread pixel ownership. Registration consumes the supplied ArrayBuffer. */
export function createImageRegistry(){
 const assets=new Map();
 const entry=id=>{const value=assets.get(id);if(!value)fail('image-not-found');return value;};
 const ownerValid=owner=>typeof owner==='string'&&owner.length>0;
 return Object.freeze({
  register({width,height,format,data},owner){
   if(!ownerValid(owner)||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1
    ||!Object.hasOwn(channels,format)||!Number.isSafeInteger(width*height*channels[format])
    ||!(data instanceof ArrayBuffer)||data.byteLength!==width*height*channels[format])fail('invalid-image-asset');
   const owned=structuredClone(data,{transfer:[data]});
   const metadata=Object.freeze({id:'image-'+crypto.randomUUID(),width,height,format});
   assets.set(metadata.id,{metadata,data:owned,owners:new Set([owner])});return metadata;
  },
  get(id){return entry(id).metadata;},
  retain(id,owner){if(!ownerValid(owner))fail('invalid-image-owner');entry(id).owners.add(owner);},
  release(id,owner){
   const asset=entry(id);if(!asset.owners.delete(owner))fail('image-owner-mismatch');
   if(asset.owners.size===0){assets.delete(id);asset.data=null;}
  },
  copy(id){const asset=entry(id);return {...asset.metadata,data:asset.data.slice(0)};},
  inferencePlanes(rgbId,alphaId){
   const rgb=entry(rgbId);
   if(rgb.metadata.format!=='rgb-u8'||rgb.metadata.width>2000||rgb.metadata.height>2000)fail('invalid-inference-image');
   let alpha;
   if(alphaId!==undefined){alpha=entry(alphaId);if(alpha.metadata.format!=='alpha-u8'||alpha.metadata.width!==rgb.metadata.width||alpha.metadata.height!==rgb.metadata.height)fail('invalid-inference-image');}
   const planes={rgb:{width:rgb.metadata.width,height:rgb.metadata.height,layout:'rgb-u8-interleaved',data:rgb.data.slice(0)}};
   if(alpha)planes.hrAlpha={width:alpha.metadata.width,height:alpha.metadata.height,layout:'alpha-u8',data:alpha.data.slice(0)};
   return planes;
  },
 });
}
