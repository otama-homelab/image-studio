/** Explicit UI actions over native Cache Storage, not another cache/downloader. */
export function createModelCacheActions({releases,gate,cacheStorage=()=>globalThis.caches}){
 const groups=new Map(),bundles=new Map();let expectedBytes=0;
 for(const release of releases){
  if(!/^image-studio-[A-Za-z0-9._-]+$/.test(release?.cacheNamespace)||!Array.isArray(release.resources)||!release.resources.length)throw Error('invalid-model-cache-scope');
  const files=groups.get(release.cacheNamespace)??new Map();
  for(const file of release.resources){
   if(typeof file.url!=='string'||!Number.isSafeInteger(file.bytes)||file.bytes<1)throw Error('invalid-model-cache-scope');
   const previous=files.get(file.url);
   if(previous){
    if(!/^[a-f0-9]{64}$/.test(file.sha256??'')||previous.sha256!==file.sha256||previous.bytes!==file.bytes)throw Error('invalid-model-cache-scope');
    continue;
   }
   files.set(file.url,{bytes:file.bytes,sha256:file.sha256});expectedBytes+=file.bytes;
  }
  groups.set(release.cacheNamespace,files);
  if(release.archive!==undefined){
   const archive=release.archive;
   if(!archive||typeof archive.url!=='string'||!archive.url||!Number.isSafeInteger(archive.bytes)||archive.bytes<1||!/^[a-f0-9]{64}$/.test(archive.sha256??''))throw Error('invalid-model-cache-scope');
   let bundle=bundles.get(archive.url);
   if(bundle&&(bundle.bytes!==archive.bytes||bundle.sha256!==archive.sha256))throw Error('invalid-model-cache-scope');
   if(!bundle){bundle={bytes:archive.bytes,sha256:archive.sha256,files:new Set()};bundles.set(archive.url,bundle);}
   for(const file of release.resources)bundle.files.add(release.cacheNamespace+'\0'+file.url);
  }
 }
 if(!groups.size)throw Error('invalid-model-cache-scope');
 const scope=Object.freeze({expectedFiles:[...groups.values()].reduce((sum,files)=>sum+files.size,0),expectedBytes});
 const storage=()=>{const value=cacheStorage();if(!value?.keys||!value?.open||!value?.delete)throw Error('model-cache-unavailable');return value;};
 return Object.freeze({
  getScope:()=>scope,
  async inspect(){
   const native=storage();let foundFiles=0,foundBytes=0;
   const missing=new Map([...groups].flatMap(([name,files])=>[...files].map(([url,file])=>[name+'\0'+url,file.bytes])));
   try{
    const existing=new Set(await native.keys());
    for(const [name,files] of groups){
     if(!existing.has(name))continue;
     const cache=await native.open(name),requests=await cache.keys();
     const found=new Set(requests.map(request=>request.url).filter(url=>files.has(url)));foundFiles+=found.size;for(const url of found){foundBytes+=files.get(url).bytes;missing.delete(name+'\0'+url);}
    }
   }catch{throw Error('model-cache-inspection-failed');}
   let downloadBytes=0;
   for(const bundle of bundles.values())if([...bundle.files].some(key=>missing.has(key))){downloadBytes+=bundle.bytes;for(const key of bundle.files)missing.delete(key);}
   for(const bytes of missing.values())downloadBytes+=bytes;
   if(!Number.isSafeInteger(downloadBytes))throw Error('invalid-model-cache-scope');
   return Object.freeze({foundFiles,...scope,missingBytes:expectedBytes-foundBytes,...(bundles.size?{downloadBytes}:{})});
  },
  async clear(){
   const lease=gate.tryAcquire();if(!lease)throw Error('model-cache-busy');
   try{const native=storage(),existing=new Set(await native.keys());for(const [name,files] of groups){if(!existing.has(name))continue;const cache=await native.open(name);for(const url of files.keys())await cache.delete(url);}}
   catch{throw Error('model-cache-delete-failed');}
   finally{lease.release();}
  },
 });
}
