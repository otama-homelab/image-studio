import test from 'node:test';
import assert from 'node:assert/strict';
import {createImageRegistry} from '../tools/browser-library-adapter/image-registry.mjs';
import {createExportJobs} from '../tools/browser-library-adapter/export-job.mjs';
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve:v=>resolve(v)};};
function setup({paper=false,encode}={}){
 const registry=createImageRegistry(),width=paper?1500:2,height=paper?1051:1;
 const asset=registry.register({width,height,format:'rgb-u8',data:new ArrayBuffer(width*height*3)},'session');
 let current={assetId:asset.id,dependencyKey:'artifact-1'};
 const options=paper?{kind:'paper',paper:'l'}:{kind:'background'};
 const file=format=>({bytes:Uint8Array.of(1,2,3),mime:format==='pdf'?'application/pdf':'image/png',filename:paper?`image-studio-paper-l${format==='pdf'?'': '-300dpi'}.${format}`:'image-studio-background.png',width,height});
 const jobs=createExportJobs({registry,getCurrent:()=>current,encode:encode??(async(_,o)=>file(o.format))});
 return {registry,asset,jobs,options,file,setCurrent:c=>{current=c;}};
}
test('source is pinned during encoding and released only after completion',async()=>{
 const work=deferred();let received;
 const f=setup({encode:async image=>{received=image;return work.promise;}}),pending=f.jobs.start(f.options);
 f.registry.release(f.asset.id,'session');assert.equal(f.registry.get(f.asset.id),f.asset);assert.equal(received.data.byteLength,6);
 work.resolve(f.file('png'));assert.equal((await pending).status,'ready');assert.throws(()=>f.registry.get(f.asset.id),e=>e.code==='image-not-found');
});
test('settings changes discard generated files and invalidate an older ready file',async()=>{
 const f=setup();await f.jobs.start(f.options);assert.ok(f.jobs.getReady(f.options));
 f.setCurrent({assetId:f.asset.id,dependencyKey:'artifact-2'});assert.equal(f.jobs.getReady(f.options),null);
 const work=deferred(),slow=setup({encode:()=>work.promise}),pending=slow.jobs.start(slow.options);
 slow.setCurrent({assetId:slow.asset.id,dependencyKey:'artifact-2'});work.resolve(slow.file('png'));
 assert.equal((await pending).status,'stale');assert.equal(slow.jobs.getReady(slow.options),null);
});
test('cancel marks intent and aborts encoder but blocks overlap until it settles',async()=>{
 const work=deferred();let signal;
 const f=setup({encode:(_,__,hooks)=>{signal=hooks.signal;return work.promise;}}),pending=f.jobs.start(f.options);
 f.jobs.cancel();assert.equal(signal.aborted,true);assert.equal(f.jobs.getState().busy,true);assert.equal(f.jobs.getState().cancelling,true);assert.ok(f.jobs.getState().jobId);
 await assert.rejects(f.jobs.start(f.options),e=>e.code==='export-busy');work.resolve(f.file('png'));
 assert.equal((await pending).status,'cancelled');assert.equal(f.jobs.getReady(f.options),null);assert.equal(f.jobs.getState().busy,false);
});
test('PNG failure preserves a ready PDF of the same paper revision',async()=>{
 let fail=false;
 const f=setup({paper:true,encode:async(_,o)=>{if(fail)throw Error('private encoder payload');return f.file(o.format);}});
 await f.jobs.start({...f.options,format:'pdf'});fail=true;
 await assert.rejects(f.jobs.start({...f.options,format:'png'}),e=>e.code==='export-failed'&&e.message==='export-failed');
 assert.ok(f.jobs.getReady({...f.options,format:'pdf'}));assert.equal(f.jobs.getReady({...f.options,format:'png'}),null);
});
test('invalid source dimensions or kind are stopped before encoder use',async()=>{
 let calls=0;const f=setup({encode:()=>{calls++;}});
 await assert.rejects(f.jobs.start({kind:'paper',paper:'a4'}),e=>e.code==='invalid-export-source');
 await assert.rejects(f.jobs.start({kind:'background',format:'pdf'}),e=>e.code==='invalid-export-options');assert.equal(calls,0);
});
test('scoped cancelAndWait retains busy/source pin until encoder termination',async()=>{
 const work=deferred(),f=setup({encode:()=>work.promise}),pending=f.jobs.start(f.options),id=f.jobs.getState().jobId;
 f.registry.release(f.asset.id,'session');let finished=false;const waiting=f.jobs.cancelAndWait(id).then(()=>{finished=true;});
 await Promise.resolve();assert.equal(finished,false);assert.equal(f.jobs.getState().busy,true);assert.ok(f.registry.get(f.asset.id));
 assert.equal(await f.jobs.cancelAndWait('other-job'),false);work.resolve(f.file('png'));await waiting;assert.equal((await pending).status,'cancelled');assert.throws(()=>f.registry.get(f.asset.id));
});
test('termination failure during cancel is not reported as a successful cancellation',async()=>{
 let reject;const work=new Promise((_,r)=>{reject=r;}),f=setup({encode:()=>work}),pending=f.jobs.start(f.options);
 const rejected=assert.rejects(pending,e=>e.code==='export-stop-failed'),waiting=f.jobs.cancelAndWait(),waitRejected=assert.rejects(waiting,e=>e.code==='export-stop-failed');
 const failure=Error('private shutdown');failure.code='export-worker-stop-failed';reject(failure);await rejected;await waitRejected;
 assert.equal(f.jobs.getState().blocked,true);await assert.rejects(f.jobs.start(f.options),e=>e.code==='export-unavailable');
});
test('background color is snapshotted and ready files cannot be reused for another color',async()=>{
 const registry=createImageRegistry(),asset=registry.register({width:2,height:1,format:'rgba-u8',data:new ArrayBuffer(8)},'session');let received;
 const jobs=createExportJobs({registry,getCurrent:()=>({assetId:asset.id,dependencyKey:'same-cutout'}),encode:async(image,options)=>{received=options;assert.equal(image.format,'rgba-u8');return {bytes:Uint8Array.of(1),mime:'image/png',filename:'image-studio-background.png',width:2,height:1};}});
 const color=[255,0,0];await jobs.start({kind:'background',backgroundColor:color});color[0]=0;assert.deepEqual(received.backgroundColor,[255,0,0]);assert.ok(jobs.getReady({kind:'background',backgroundColor:[255,0,0]}));assert.equal(jobs.getReady({kind:'background',backgroundColor:[0,0,0]}),null);assert.equal(jobs.getReady({kind:'background'}),null);
});
