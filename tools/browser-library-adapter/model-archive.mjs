import {createResourcePolicy,ResourcePolicyError} from './resource-policy.mjs';

/** Shared build/runtime validation of ZIP member names; does not read model bytes. */
export function validateModelArchiveFiles(files){
 if(!Array.isArray(files)||!files.length||files.length>16384)throw new ResourcePolicyError('invalid-model-archive');
 const expected=new Map();
 for(const file of files){
  if(typeof file?.name!=='string'||!file.name||!/^[A-Za-z0-9_./-]+$/.test(file.name)||file.name.startsWith('/')||file.name.endsWith('/')||file.name.includes('//')||file.name.split('/').some(x=>x==='.'||x==='..')||expected.has(file.name))throw new ResourcePolicyError('invalid-model-archive');
  expected.set(file.name,file);
 }
 return expected;
}

/** Stored ZIP transport only. Inference still consumes the original verified files. */
export async function storeModelArchive({archive,files,fetchImpl,cache,makeHasher,Unzip,signal,onState=()=>{}}){
 const fail=code=>{throw new ResourcePolicyError(code);};
 const abortError=()=>new DOMException('aborted','AbortError');
 if(typeof Unzip!=='function'||typeof onState!=='function')fail('invalid-model-archive');
 const expected=validateModelArchiveFiles(files);
 let policy;
 policy=createResourcePolicy({files,fetchImpl,cache,makeHasher,signal,onEvent:()=>onState(policy.getState())});
 const transport=createResourcePolicy({files:[archive],fetchImpl,cache:{async match(){},async put(){fail('archive-cache-unused');}},makeHasher,signal,onEvent:event=>{
  if(event.type==='error')onState(policy.getState().map(state=>({...state,lastError:event.code})));
 }});
 if(signal?.aborted)throw abortError();
 // Read and verify rather than treating a cache key's existence as preparation.
 let cached=0;
 for(const file of files){
  try{
   const response=await policy.cache.match(file.url);if(!response)continue;
   const reader=response.body.getReader();try{while(!(await reader.read()).done){}}finally{reader.releaseLock();}cached++;
  }catch(error){
   // Only corrupt content is repairable; aborts and storage failures must stay visible.
   if(!(error instanceof ResourcePolicyError)||!['bytes-mismatch','bytes-overflow','checksum-mismatch'].includes(error.code))throw error;
  }
 }
 if(cached===files.length)return {status:'cached',files:cached};
 const response=await transport.fetch(archive.url),reader=response.body.getReader();
 const seen=new Set(),queue=[],streams=new Set();let current=null,tasks=[],fatal=null,ended=false;
 const track=promise=>{promise.catch(()=>{});tasks.push(promise);};
 function stop(error){
  fatal??=error instanceof ResourcePolicyError||error?.name==='AbortError'?error:new ResourcePolicyError('archive-invalid');
  for(const entry of streams){entry.file.terminate();void entry.writer.abort(fatal).catch(()=>{});}
  void reader.cancel(fatal).catch(()=>{});
 }
 function startNext(){
  if(current||fatal)return;
  const file=queue.shift();if(!file)return;
  const descriptor=expected.get(file.name),stream=new TransformStream(),writer=stream.writable.getWriter();
  const entry={file,writer,stored:null};current=entry;streams.add(entry);
  entry.stored=policy.cache.put(descriptor.url,new Response(stream.readable));
  entry.stored.catch(stop);
  file.ondata=(error,chunk,final)=>{
   if(error){stop(error);return;}if(fatal)return;
   track(writer.write(chunk));
   if(final)track((async()=>{
    await writer.close();await entry.stored;streams.delete(entry);current=null;startNext();
   })());
  };
  try{file.start();}catch(error){stop(error);}
 }
 const unzip=new Unzip(file=>{
  const descriptor=expected.get(file.name);
  if(!descriptor||seen.has(file.name)||file.compression!==0||file.originalSize!==descriptor.bytes){file.terminate();stop(new ResourcePolicyError('archive-entry-invalid'));return;}
  seen.add(file.name);queue.push(file);startNext();
 });
 const aborted=()=>stop(abortError());signal?.addEventListener('abort',aborted,{once:true});
 async function drain(){
  // Starting the next entry may schedule more work while the current batch drains.
  while(tasks.length){await Promise.all(tasks.splice(0));if(fatal)throw fatal;}
  if(fatal)throw fatal;
 }
 try{
  if(signal?.aborted)throw abortError();
  while(true){
   const {done,value}=await reader.read();if(done){ended=true;break;}
   // Bound fflate's pending entry data while a cache write applies backpressure.
   for(let offset=0;offset<value.length;offset+=4096){unzip.push(value.subarray(offset,offset+4096));await drain();}
  }
  unzip.push(new Uint8Array(),true);await drain();
  if(current||queue.length||seen.size!==files.length)fail('archive-entry-missing');
  if(!transport.getState()[0].networkVerified||!policy.getState().every(x=>x.stored))fail('archive-invalid');
  return {status:'stored',files:seen.size};
 }catch(error){
  stop(error);throw fatal;
 }finally{
  signal?.removeEventListener('abort',aborted);
  if(!ended)void reader.cancel().catch(()=>{});
  await Promise.allSettled([...tasks,...[...streams].map(x=>x.stored)]);
  reader.releaseLock();
 }
}
