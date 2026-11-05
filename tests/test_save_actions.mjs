import test from 'node:test';
import assert from 'node:assert/strict';
import {createImageRegistry} from '../tools/browser-library-adapter/image-registry.mjs';
import {createExportJobs} from '../tools/browser-library-adapter/export-job.mjs';
import {createDownloadLinks} from '../tools/browser-library-adapter/download-links.mjs';
import {createSaveActions} from '../tools/browser-library-adapter/save-actions.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function setup(){
 const registry=createImageRegistry();
 const asset=registry.register({width:1,height:1,format:'rgb-u8',data:Uint8Array.of(1,2,3).buffer},'session');
 let key='revision-1',selected={kind:'background'},calls=0,signal,failUrl=false;
 const work=deferred(),created=[],revoked=[],events=[];
 const file={bytes:Uint8Array.of(1),width:1,height:1,mime:'image/png',filename:'image-studio-background.png'};
 const jobs=createExportJobs({registry,getCurrent:()=>({assetId:asset.id,dependencyKey:key}),encode:(_,__,hooks)=>{calls++;signal=hooks.signal;return work.promise;}});
 const links=createDownloadLinks({getReady:jobs.getReady,urlApi:{createObjectURL(){if(failUrl)throw Error('private');const url='blob:'+created.length;created.push(url);return url;},revokeObjectURL:url=>revoked.push(url)},setTimer:()=>1,clearTimer:()=>{}});
 const control=onChange=>createSaveActions({jobs,links,getOptions:()=>selected,onChange:onChange??(s=>events.push(s))});
 return {registry,asset,jobs,links,work,file,created,revoked,events,control,get calls(){return calls;},get signal(){return signal;},changeKey(){key='revision-2';},select:value=>{selected=value;},failUrl:value=>{failUrl=value;}};
}
test('explicit generation exposes only ready metadata; explicit download and close release resources',async()=>{
 const f=setup(),c=f.control(),idle=c.getState();assert.equal(c.getState(),idle);
 const pending=c.generate();assert.equal(c.getState().phase,'generating');assert.equal(c.beginDownload(),null);assert.equal(f.created.length,0);
 f.work.resolve(f.file);assert.deepEqual(await pending,{status:'ready'});
 assert.equal(c.getState().phase,'ready');assert.equal(c.getState().busy,false);
 assert.deepEqual(Object.keys(c.getState().link).sort(),['filename','id','mime','url']);
 assert.equal(c.beginDownload().filename,f.file.filename);c.close();c.close();f.links.close();assert.deepEqual(f.revoked,f.created);
 assert.equal(f.registry.copy(f.asset.id).data.byteLength,3);
});
test('click rejects a changed source even without a reconciliation event',async()=>{
 const f=setup(),c=f.control(),pending=c.generate();f.work.resolve(f.file);await pending;f.changeKey();
 assert.equal(c.beginDownload(),null);assert.equal(c.getState().phase,'stale');assert.equal(f.revoked.length,1);c.close();f.links.close();
});
test('click rejects changed output selection even when source is still current',async()=>{
 const f=setup(),c=f.control(),pending=c.generate();f.work.resolve(f.file);await pending;f.select({kind:'crop'});
 assert.equal(c.beginDownload(),null);assert.equal(c.getState().phase,'stale');c.close();f.links.close();
});
test('reconciliation aborts stale pending work and never creates its URL',async()=>{
 const f=setup(),c=f.control(),pending=c.generate();f.changeKey();c.reconcile();
 assert.equal(f.signal.aborted,true);assert.equal(c.getState().busy,true);f.work.resolve(f.file);
 assert.deepEqual(await pending,{status:'stale'});assert.equal(c.getState().phase,'stale');assert.equal(c.getState().busy,false);assert.equal(f.created.length,0);c.close();f.links.close();
});
test('closing an unrelated control preserves the active job; late completion after owner close is silent',async()=>{
 const f=setup(),a=f.control(),b=f.control(),pending=a.generate();assert.equal(b.getState().busy,true);
 assert.deepEqual(await b.generate(),{status:'busy'});b.close();assert.equal(f.signal.aborted,false);
 a.close();const count=f.events.length;assert.equal(f.signal.aborted,true);f.work.resolve(f.file);
 assert.deepEqual(await pending,{status:'stale'});assert.equal(f.events.length,count);assert.equal(f.created.length,0);f.links.close();
});
test('synchronous close during start notification prevents encoder use and clears pin',async()=>{
 const f=setup();let c;c=f.control(s=>{if(s.busy)c.close();});
 assert.deepEqual(await c.generate(),{status:'stale'});assert.equal(f.calls,0);assert.equal(f.jobs.getState().busy,false);
 assert.equal(f.jobs.isCurrent(undefined),false);f.registry.release(f.asset.id,'session');assert.throws(()=>f.registry.get(f.asset.id));f.links.close();
});
test('URL failure preserves ready bytes and reconciliation retries without encoding again',async()=>{
 const f=setup(),c=f.control();f.failUrl(true);const pending=c.generate();f.work.resolve(f.file);
 assert.deepEqual(await pending,{status:'error'});assert.equal(c.getState().errorCode,'save-prepare-failed');assert.ok(f.jobs.getReady({kind:'background'}));
 f.failUrl(false);c.reconcile();assert.equal(c.getState().phase,'ready');assert.equal(f.calls,1);c.close();f.links.close();
});
test('shared ready URL survives one control closing and is revoked after last owner closes',async()=>{
 const f=setup(),a=f.control(),b=f.control(),pending=a.generate();f.work.resolve(f.file);await pending;b.reconcile();
 assert.equal(a.getState().link.id,b.getState().link.id);a.close();assert.equal(f.revoked.length,0);assert.equal(b.getState().phase,'ready');b.close();assert.equal(f.revoked.length,1);f.links.close();
});

test('owned cancelAndWait stays cancelling until encoder terminates',async()=>{
 const f=setup(),control=f.control(),pending=control.generate();let stopped=false;const stopping=control.cancelAndWait().then(()=>{stopped=true;});
 await Promise.resolve();assert.equal(stopped,false);assert.equal(control.getState().phase,'cancelling');assert.equal(f.signal.aborted,true);
 f.work.resolve(f.file);await stopping;assert.equal((await pending).status,'stale');assert.equal(control.getState().phase,'cancelled');assert.equal(control.getState().busy,false);assert.equal(f.created.length,0);control.close();f.links.close();
});
test('a control with no owned job cannot stop another control while waiting',async()=>{
 const f=setup(),owner=f.control(),other=f.control(),pending=owner.generate();await other.cancelAndWait();assert.equal(f.signal.aborted,false);
 f.work.resolve(f.file);assert.equal((await pending).status,'ready');other.close();assert.equal(f.revoked.length,0);owner.close();f.links.close();
});
test('stop failure is propagated and never shown as cancelled',async()=>{
 const f=setup(),control=f.control(),pending=control.generate(),stopping=control.cancelAndWait(),rejected=assert.rejects(stopping,e=>e.message==='save-stop-failed');
 const error=Error('private stop');error.code='export-worker-stop-failed';f.work.reject(error);await rejected;await pending;
 assert.equal(control.getState().phase,'error');assert.equal(control.getState().errorCode,'save-stop-failed');assert.equal(f.jobs.getState().blocked,true);control.close();f.links.close();
});
