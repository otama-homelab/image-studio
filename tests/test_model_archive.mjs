import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Unzip,zipSync} from '../web/node_modules/fflate/esm/browser.js';
import {createWorkerHandler} from '../tools/browser-library-adapter/worker-handler.mjs';
import {createStagedHrPreparation} from '../tools/browser-library-adapter/staged-hr-prepare.mjs';
import {storeModelArchive,validateModelArchiveFiles} from '../tools/browser-library-adapter/model-archive.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const makeHasher=()=>{const h=createHash('sha256');return {update:b=>h.update(b),digestHex:()=>h.digest('hex')};};
function fixture({entries,corrupt=false,truncate=false,quota=false,signal,slow=false,compressed=false,duplicate=false,onChunk,chunkBytes=12000,content:providedContent}={}){
 const content=providedContent??Object.fromEntries(Array.from({length:40},(_,i)=>[`stage-${i}/config.json`,new Uint8Array(82).fill(i)]));
 const files=Object.entries(content).map(([name,b])=>({name,url:'https://assets.invalid/'+name,bytes:b.length,sha256:sha(b)}));
 const original=zipSync(entries??content,{level:compressed?6:0});
 if(duplicate){const from=Buffer.from('stage-1/config.json'),to=Buffer.from('stage-0/config.json');let offset=0;while((offset=Buffer.from(original).indexOf(from,offset))>=0){original.set(to,offset);offset+=to.length;}}
 const body=original.slice();if(corrupt)body[60]^=1;
 const archive={url:'https://assets.invalid/archive.zip',bytes:original.length,sha256:sha(original)};
 let network=0,active=0,maxActive=0,maxChunkBytes=0,cancelled=false;const stored=new Map();
 const cache={async match(url){return stored.has(url)?new Response(stored.get(url)):undefined;},async put(url,r){
  active++;maxActive=Math.max(maxActive,active);
  try{if(quota)throw new DOMException('private quota details','QuotaExceededError');const reader=r.body.getReader(),chunks=[];
   try{while(true){const {done,value}=await reader.read();if(done)break;maxChunkBytes=Math.max(maxChunkBytes,value.length);onChunk?.();if(slow)await new Promise(r=>setImmediate(r));chunks.push(value);}}finally{reader.releaseLock();}
   const b=new Uint8Array(chunks.reduce((n,v)=>n+v.length,0));let offset=0;for(const v of chunks){b.set(v,offset);offset+=v.length;}stored.set(url,b);
  }finally{active--;}
 }};
 const fetchImpl=async()=>{network++;let offset=0;return new Response(new ReadableStream({pull(c){if(signal?.aborted){c.error(new DOMException('aborted','AbortError'));return;}const end=Math.min(offset+chunkBytes,truncate?body.length-9:body.length);if(end===offset){c.close();return;}c.enqueue(body.subarray(offset,end));offset=end;},cancel(){cancelled=true;}}));};
 return {files,archive,cache,stored,options:{files,archive,cache,fetchImpl,makeHasher,Unzip,signal},run:()=>storeModelArchive({files,archive,cache,fetchImpl,makeHasher,Unzip,signal}),stats:()=>({network,active,maxActive,maxChunkBytes,cancelled})};
}
test('stored archive streams into SHA-verified cache with exactly one active cache write; warm cache avoids transport',async()=>{
 const f=fixture({slow:true});const result=await f.run();assert.equal(result.status,'stored');assert.equal(f.stats().maxActive,1);assert.equal(f.stats().network,1);assert.equal(f.stored.size,40);
 for(const file of f.files)assert.equal(sha(f.stored.get(file.url)),file.sha256);
 assert.equal((await f.run()).status,'cached');assert.equal(f.stats().network,1);assert.equal(f.stats().active,0);
});
test('unknown names, changed sizes and missing entries cannot complete preparation',async()=>{
 for(const entries of [{'../escape':new Uint8Array(82)}, {'stage-0/config.json':new Uint8Array(83)}, {'stage-0/config.json':new Uint8Array(82)}]){
  const f=fixture({entries});await assert.rejects(f.run(),e=>['archive-entry-invalid','archive-entry-missing'].includes(e.code));assert.equal(f.stats().active,0);
 }
});
test('corruption and truncated network bodies fail closed without a completed archive',async()=>{
 for(const options of [{corrupt:true},{truncate:true}]){const f=fixture(options);await assert.rejects(f.run());assert.equal(f.stats().active,0);}
});
test('quota errors and already-aborted requests expose fixed errors without private details',async()=>{
 const q=fixture({quota:true});await assert.rejects(q.run(),e=>e.code==='cache-quota-exceeded'&&!e.message.includes('private'));assert.equal(q.stats().active,0);
 const abort=new AbortController();abort.abort('private photo');const f=fixture({signal:abort.signal});await assert.rejects(f.run(),e=>e.name==='AbortError'&&!e.message.includes('private'));assert.equal(f.stats().network,0);
});

test('compressed ZIP entries and duplicate local names are rejected',async()=>{
 for(const options of [{compressed:true},{duplicate:true}]){const f=fixture(options);await assert.rejects(f.run(),e=>e.code==='archive-entry-invalid');assert.equal(f.stats().active,0);}
});
test('abort during a cache write cancels the transfer and settles all cache writers',{timeout:2000},async()=>{
 const abort=new AbortController();const f=fixture({signal:abort.signal,chunkBytes:64,onChunk:()=>abort.abort('private photo')});
 await assert.rejects(f.run(),e=>e.name==='AbortError'&&!e.message.includes('private'));assert.equal(f.stats().active,0);assert.ok(f.stats().cancelled);
});
test('corrupted cached content is repaired from one complete archive, then stays warm',async()=>{
 for(const bad of [new Uint8Array(82).fill(255),new Uint8Array(81),new Uint8Array(83)]){
  const f=fixture();await f.run();f.stored.set(f.files[0].url,bad);
  assert.equal((await f.run()).status,'stored');assert.equal(f.stats().network,2);
  for(const file of f.files)assert.equal(sha(f.stored.get(file.url)),file.sha256);
  assert.equal((await f.run()).status,'cached');assert.equal(f.stats().network,2);
 }
});
test('cache read failures are not hidden by archive retries',async()=>{
 const f=fixture();f.cache.match=async()=>{throw Error('private storage failure');};
 await assert.rejects(f.run(),e=>e.code==='cache-read-failed');assert.equal(f.stats().network,0);
});

test('multi-megabyte entries preserve single-writer backpressure and bounded output chunks',async()=>{
 const content=Object.fromEntries(Array.from({length:32},(_,i)=>[`stage-${i}/config.json`,new Uint8Array(82).fill(i)]));
 content['model.onnx']=new Uint8Array(1024*1024).fill(7);content['model.onnx.data']=new Uint8Array(2*1024*1024).fill(19);
 const f=fixture({content,slow:true,chunkBytes:65536});await f.run();assert.equal(f.stats().maxActive,1);assert.ok(f.stats().maxChunkBytes<=4096);assert.equal(f.stats().active,0);assert.equal(f.stored.size,34);
 for(const file of f.files)assert.equal(sha(f.stored.get(file.url)),file.sha256);
});

test('real preparation receiver and staged HR gate accept archive-seeded cache without individual file downloads',async()=>{
 const f=fixture({content:{'stage-000/config.json':new Uint8Array(82).fill(7)}}),events=[];
 const trusted={model:'hr',modelVersion:'archive-test',releaseId:'archive-test',cacheNamespace:'archive-test',resources:f.files,archive:f.archive};
 const stages=[{inputs:[{name:'pixels',dtype:'float16',dims:[1,3,2048,2048]}],outputs:[{name:'alpha',dtype:'float32',dims:[1,1,2048,2048]}],release:{resources:f.files.map(x=>({...x,name:'config.json'}))}}];
 const prepare=createStagedHrPreparation({library:{Tensor:class{}},stages,cache:f.cache,makeHasher,fetchImpl:()=>{throw Error('individual download forbidden');},createWorker:()=>{throw Error('inference must not start during preparation');}});
 const handler=createWorkerHandler({trustedModels:[trusted],prepare:async(release,hooks)=>{
  assert.equal(release.archive.url,f.archive.url);await storeModelArchive({...f.options,files:release.resources,archive:release.archive,signal:hooks.signal});return prepare(release,hooks);
 },infer:()=>{throw Error('unused');},postMessage:e=>events.push(e)});
 await handler({type:'prepare',workerId:'archive-worker',jobId:'prepare',model:trusted.model,modelVersion:trusted.modelVersion,source:{mode:'library-resources',releaseId:trusted.releaseId,cacheNamespace:trusted.cacheNamespace,resources:f.files,archive:{url:'https://evil.invalid/ignored'}}});
 assert.equal(events.at(-1).type,'prepared');assert.equal(f.stats().network,1);assert.ok(events.some(e=>e.type==='resource-state'&&e.resources.every(x=>x.stored&&x.cacheVerified)));
 await handler({type:'dispose',workerId:'archive-worker',jobId:'dispose'});assert.equal(events.at(-1).type,'disposed');assert.equal(f.stats().active,0);
});

test('archive progress reports verified file storage incrementally without claiming network-byte progress',async()=>{
 const f=fixture(),snapshots=[];await storeModelArchive({...f.options,onState:states=>snapshots.push(states)});
 assert.ok(snapshots.some(states=>{const n=states.filter(x=>x.stored).length;return n>0&&n<f.files.length;}));
 assert.ok(snapshots.at(-1).every(x=>x.stored));assert.ok(!JSON.stringify(snapshots).includes('https:'));
});

test('archive transport rate limit reaches original resource state without URLs or retrying',async()=>{
 const f=fixture(),states=[];let calls=0;
 await assert.rejects(storeModelArchive({...f.options,fetchImpl:async()=>{calls++;return new Response('private source details',{status:429});},onState:s=>states.push(s)}),e=>e.code==='resource-rate-limited');
 assert.equal(calls,1);assert.ok(states.at(-1).every(s=>s.lastError==='resource-rate-limited'&&!s.stored));
 assert.ok(!JSON.stringify(states).includes('https:'));assert.ok(!JSON.stringify(states).includes('private'));
});


test('build and runtime share bounded ZIP member validation without changing descriptor identity',()=>{
 const file={name:'stage-000/onnx/model_fp16.onnx',url:'https://fixture.invalid/model',bytes:4,sha256:'a'.repeat(64)};
 assert.equal(validateModelArchiveFiles([file]).get(file.name),file);
 for(const files of [undefined,[],Array(16385).fill(file),[file,file],...[null,'','/absolute','../escape','a/../escape','a//b','a/','a/./b','a\\b'].map(name=>[{name}])])assert.throws(()=>validateModelArchiveFiles(files),error=>error.code==='invalid-model-archive');
});
