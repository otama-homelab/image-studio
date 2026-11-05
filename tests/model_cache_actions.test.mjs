import test from 'node:test';
import assert from 'node:assert/strict';
import {createModelCacheActions} from '../tools/browser-library-adapter/model-cache-actions.mjs';
import {createWorkerGate} from '../tools/browser-library-adapter/worker-gate.mjs';
const releases=()=>[{cacheNamespace:'image-studio-hr-test',resources:[{url:'https://fixture.invalid/hr/config.json',bytes:8},{url:'https://fixture.invalid/hr/model.onnx',bytes:32}]},
 {cacheNamespace:'image-studio-matte-test',resources:[{url:'https://fixture.invalid/matte/model.onnx',bytes:64}]}];
test('cache inspection is lazy, counts only configured resource metadata, and never creates missing areas',async()=>{
 const opened=[];let accessed=0;const configured=releases(),native={keys:async()=>['image-studio-hr-test','another-app-cache'],open:async name=>{
  opened.push(name);return {keys:async()=>[{url:configured[0].resources[0].url},{url:'https://private-sentinel.invalid/unrelated'}]};},delete:async()=>{throw Error('Unexpected deletion');}};
 const actions=createModelCacheActions({releases:configured,gate:createWorkerGate(),cacheStorage:()=>{accessed++;return native;}});
 assert.equal(accessed,0);assert.deepEqual(actions.getScope(),{expectedFiles:3,expectedBytes:104});assert.equal(accessed,0);assert.deepEqual(await actions.inspect(),{foundFiles:1,expectedFiles:3,expectedBytes:104,missingBytes:96});assert.deepEqual(opened,['image-studio-hr-test']);
});
test('deletion owns the shared gate and deletes only captured URLs, preserving unrelated files in a shared namespace',async()=>{
 const gate=createWorkerGate(),deleted=[],configured=releases(),foreign='https://private-sentinel.invalid/unrelated';
 const stores=new Map(configured.map(release=>[release.cacheNamespace,new Set([...release.resources.map(file=>file.url),foreign])]));
 const native={keys:async()=>[...stores.keys(),'another-app-cache'],open:async name=>({delete:async url=>{assert.equal(gate.getState().busy,true);deleted.push(url);return stores.get(name).delete(url);}}),delete:async()=>{throw Error('Whole namespace deletion prohibited');}};
 const actions=createModelCacheActions({releases:configured,gate,cacheStorage:()=>native});
 const lease=gate.tryAcquire();await assert.rejects(actions.clear(),/model-cache-busy/);assert.deepEqual(deleted,[]);lease.release();
 const expected=configured.flatMap(release=>release.resources.map(file=>file.url));configured[0].cacheNamespace='another-app-cache';await actions.clear();assert.deepEqual(deleted,expected);assert.ok([...stores.values()].every(files=>files.size===1&&files.has(foreign)));assert.equal(gate.getState().busy,false);
});
test('storage failure releases admission without poisoning image work; foreign scope is refused',async()=>{
 const gate=createWorkerGate(),actions=createModelCacheActions({releases:releases(),gate,cacheStorage:()=>({keys(){throw Error('private detail');},open(){},async delete(){}})});
 await assert.rejects(actions.clear(),error=>error.message==='model-cache-delete-failed');assert.equal(gate.getState().busy,false);assert.equal(gate.getState().blocked,false);
 assert.throws(()=>createModelCacheActions({gate,releases:[{cacheNamespace:'another-app-cache',resources:releases()[0].resources}]}),/invalid-model-cache-scope/);
});

test('CPU/GPU modes sharing the same verified cache resource count it once and reject conflicting descriptors',async()=>{
 const file={url:'https://fixture.invalid/modnet/model.onnx',bytes:32,sha256:'a'.repeat(64)},release={cacheNamespace:'image-studio-shared-model',resources:[file]};
 const actions=createModelCacheActions({gate:createWorkerGate(),releases:[release,structuredClone(release)],cacheStorage:()=>({keys:async()=>['image-studio-shared-model'],open:async()=>({keys:async()=>[{url:file.url}]}),delete:async()=>{}})});assert.deepEqual(await actions.inspect(),{expectedFiles:1,foundFiles:1,expectedBytes:32,missingBytes:0});
 for(const altered of [{...file,sha256:'b'.repeat(64)},{...file,bytes:33}])assert.throws(()=>createModelCacheActions({gate:createWorkerGate(),releases:[release,{...release,resources:[altered]}]}),/invalid-model-cache-scope/);
});

test('missing bytes count unequal resources once per namespace and ignore unrelated or duplicate request metadata',async()=>{
 const a='https://fixture.invalid/a',b='https://fixture.invalid/b';
 const releases=[{cacheNamespace:'image-studio-one',resources:[{url:a,bytes:3},{url:b,bytes:97}]},{cacheNamespace:'image-studio-two',resources:[{url:a,bytes:3}]}];
 const stored=new Map([['image-studio-one',[a,a,'https://fixture.invalid/foreign']]]);
 const actions=createModelCacheActions({gate:createWorkerGate(),releases,cacheStorage:()=>({keys:async()=>[...stored.keys()],open:async name=>({keys:async()=>stored.get(name).map(url=>({url}))}),delete:async()=>{}})});
 assert.deepEqual(await actions.inspect(),{foundFiles:1,expectedFiles:3,expectedBytes:103,missingBytes:100});
 stored.clear();assert.equal((await actions.inspect()).missingBytes,103);
});

test('archive transfer estimate stays full for a partial cache while storage need counts only missing files',async()=>{
 const release={...releases()[0],resources:releases()[0].resources.map((f,i)=>({...f,sha256:String(i+1).repeat(64)})),archive:{url:'https://fixture.invalid/hr.zip',bytes:140,sha256:'a'.repeat(64)}};
 let present=[release.resources[0].url];
 const actions=createModelCacheActions({releases:[release,release],gate:createWorkerGate(),cacheStorage:()=>({keys:async()=>[release.cacheNamespace],open:async()=>({keys:async()=>present.map(url=>({url}))}),delete:async()=>{}})});
 assert.deepEqual(await actions.inspect(),{foundFiles:1,expectedFiles:2,expectedBytes:40,missingBytes:32,downloadBytes:140});
 present=release.resources.map(f=>f.url);assert.equal((await actions.inspect()).downloadBytes,0);
});
test('archive metadata conflicts are rejected instead of understating a transfer',()=>{
 const base={...releases()[0],resources:releases()[0].resources.map((f,i)=>({...f,sha256:String(i+1).repeat(64)})),archive:{url:'https://fixture.invalid/hr.zip',bytes:140,sha256:'a'.repeat(64)}};
 for(const archive of [{...base.archive,bytes:-1},{...base.archive,sha256:'invalid'}])assert.throws(()=>createModelCacheActions({releases:[{...base,archive}],gate:createWorkerGate()}),/invalid-model-cache-scope/);
 assert.throws(()=>createModelCacheActions({releases:[base,{...base,archive:{...base.archive,bytes:141}}],gate:createWorkerGate()}),/invalid-model-cache-scope/);
});
