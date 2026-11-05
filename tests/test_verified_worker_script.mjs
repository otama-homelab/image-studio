import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {createVerifiedWorkerScript} from '../tools/browser-library-adapter/verified-worker-script.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function setup({wrong=false,signal}={}){
 const source=new TextEncoder().encode('self.onmessage=()=>{}'),file={url:'https://assets.example.test/worker-v1.js',bytes:source.length,sha256:createHash('sha256').update(source).digest('hex')},urlEvents=[],stops=[],created=[];
 class Worker extends EventTarget{constructor(url){super();created.push(url);this.done=deferred();stops.push(this.done);}postMessage(){}terminate(){return this.done.promise;}}
 const owner=createVerifiedWorkerScript({file,signal,fetchImpl:async(url,init)=>{assert.equal(url,file.url);assert.equal(init.credentials,'omit');return new Response(wrong?new Uint8Array(source.length).fill(0):source);},makeHasher:async()=>{const h=createHash('sha256');return {update:bytes=>h.update(bytes),digestHex:()=>h.digest('hex')};},WorkerClass:Worker,urlApi:{createObjectURL(blob){urlEvents.push(['create',blob.type]);return 'blob:verified';},revokeObjectURL(url){urlEvents.push(['revoke',url]);}}});
 return {owner,urlEvents,stops,created};
}
test('verified bytes required before Worker construction; URL outlives asynchronous termination',async()=>{
 const f=setup();assert.throws(()=>f.owner.createWorker(),e=>e.code==='worker-script-not-ready');const first=f.owner.prepare();assert.equal(first,f.owner.prepare());await first;const worker=f.owner.createWorker();assert.deepEqual(f.created,['blob:verified']);const ending=worker.terminate(),closed=f.owner.close();assert.equal(closed,f.owner.close());await Promise.resolve();assert.equal(f.owner.getState().workers,1);assert.equal(f.urlEvents.length,1);f.stops[0].resolve();await ending;await closed;assert.deepEqual(f.urlEvents,[['create','text/javascript'],['revoke','blob:verified']]);assert.equal(f.owner.getState().workers,0);
});
test('hash mismatch creates neither URL nor Worker and is redacted',async()=>{
 const f=setup({wrong:true});await assert.rejects(f.owner.prepare(),e=>e.code==='worker-script-prepare-failed'&&e.message==='worker-script-prepare-failed');assert.deepEqual(f.urlEvents,[]);assert.deepEqual(f.created,[]);await f.owner.close();
});
test('failed termination retains ownership and blocks reuse without revoking active script',async()=>{
 const f=setup();await f.owner.prepare();f.owner.createWorker();const closed=f.owner.close(),rejected=assert.rejects(closed,e=>e.code==='worker-script-stop-failed');await Promise.resolve();f.stops[0].reject(Error('private failure'));await rejected;assert.equal(f.owner.getState().blocked,true);assert.equal(f.owner.getState().workers,1);assert.equal(f.urlEvents.length,1);assert.throws(()=>f.owner.createWorker(),e=>e.code==='worker-script-unavailable');
});
test('close before prepared completion cannot create a late Blob URL',async()=>{
 const f=setup(),pending=f.owner.prepare(),rejected=assert.rejects(pending,e=>e.code==='worker-script-unavailable');await f.owner.close();await rejected;assert.deepEqual(f.urlEvents,[]);assert.deepEqual(f.created,[]);
});

test('parent job abort prevents a late child script URL or Worker from being published',async()=>{
 const controller=new AbortController(),f=setup({signal:controller.signal});const pending=f.owner.prepare();controller.abort();await assert.rejects(pending,e=>e.code==='worker-script-prepare-failed');assert.deepEqual(f.urlEvents,[]);assert.deepEqual(f.created,[]);await f.owner.close();
});


test('larger stage script allowance is explicit and still rejects an oversized descriptor before fetching',async()=>{
 const bytes=new Uint8Array(1024*1024+1).fill(32),file={url:'https://app.invalid/assets/stage.js',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
 let fetches=0,urls=0;
 const options={file,WorkerClass:class{},fetchImpl:async()=>{fetches++;return new Response(bytes);},makeHasher:()=>{const h=createHash('sha256');return {update:b=>h.update(b),digestHex:()=>h.digest('hex')};},urlApi:{createObjectURL(){urls++;return 'blob:stage';},revokeObjectURL(){}}};
 assert.throws(()=>createVerifiedWorkerScript(options),e=>e.code==='invalid-worker-script');
 assert.equal(fetches,0);
 const owner=createVerifiedWorkerScript({...options,maxScriptBytes:2*1024*1024});await owner.prepare();assert.equal(fetches,1);assert.equal(urls,1);await owner.close();
 assert.throws(()=>createVerifiedWorkerScript({...options,maxScriptBytes:2*1024*1024,file:{...file,bytes:2*1024*1024+1}}));assert.equal(fetches,1);
});
