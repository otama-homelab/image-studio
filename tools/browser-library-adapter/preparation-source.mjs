/** Bind an incoming prepare command to an application-owned immutable role manifest. */
export function validateLibraryPreparation(request,trusted){
 const fail=()=>{throw new TypeError('invalid-preparation-source');};
 if(!request||request.type!=='prepare'||!trusted||request.model!==trusted.model||request.modelVersion!==trusted.modelVersion)fail();
 const source=request.source;
 if(!source||source.mode!=='library-resources'||source.releaseId!==trusted.releaseId||source.cacheNamespace!==trusted.cacheNamespace
  ||!Array.isArray(source.resources)||!Array.isArray(trusted.resources)||trusted.resources.length===0||source.resources.length!==trusted.resources.length)fail();
 const names=new Set();
 for(const file of source.resources){
  if(!file||names.has(file.name))fail();names.add(file.name);
  const expected=trusted.resources.find(f=>f.name===file.name);
  if(!expected||file.url!==expected.url||file.sha256!==expected.sha256||file.bytes!==expected.bytes)fail();
 }
 // Return fresh copies of trusted descriptors, never request-owned mutable objects.
 return Object.freeze({model:trusted.model,modelVersion:trusted.modelVersion,releaseId:trusted.releaseId,
  cacheNamespace:trusted.cacheNamespace,resources:Object.freeze(trusted.resources.map(f=>Object.freeze({name:f.name,url:f.url,sha256:f.sha256,bytes:f.bytes}))),
  ...(trusted.archive!==undefined?{archive:Object.freeze({url:trusted.archive.url,bytes:trusted.archive.bytes,sha256:trusted.archive.sha256})}:{})});
}
