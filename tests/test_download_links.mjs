import test from 'node:test';
import assert from 'node:assert/strict';
import {createDownloadLinks} from '../tools/browser-library-adapter/download-links.mjs';
const options={kind:'background'};
test('background color is snapshotted and preserved through download revalidation',()=>{
 const file={bytes:Uint8Array.of(1),mime:'image/png',filename:'image-studio-background.png'};
 let selected=[255,255,255];const revoked=[];
 const links=createDownloadLinks({getReady:input=>JSON.stringify(input.backgroundColor)===JSON.stringify(selected)?file:null,
  urlApi:{createObjectURL:()=> 'blob:color',revokeObjectURL:url=>revoked.push(url)}});
 const color=[255,255,255],link=links.acquire({kind:'background',backgroundColor:color},'view');color[0]=0;
 assert.equal(links.beginDownload(link.id,'view').url,'blob:color');
 selected=[0,0,0];assert.throws(()=>links.beginDownload(link.id,'view'),error=>error.code==='export-not-ready');
 links.close();assert.deepEqual(revoked,['blob:color']);
});
function setup({createFailure=false}={}){
 let current={bytes:Uint8Array.of(1,2,3),mime:'image/png',filename:'image-studio-background.png'},time=0,sequence=0;
 const revoked=[],created=[],timers=new Map();
 const links=createDownloadLinks({getReady:()=>current,now:()=>time,
  urlApi:{createObjectURL(blob){if(createFailure)throw Error('private URL failure');created.push(blob);return 'blob:test-'+created.length;},revokeObjectURL(url){revoked.push(url);}},
  setTimer(fn,delay){const id=++sequence;timers.set(id,{fn,at:time+delay});return id;},clearTimer:id=>timers.delete(id)});
 return {links,revoked,created,unset:()=>{current=null;},replace:()=>{current={...current};},advance:ms=>{time+=ms;for(const [id,timer] of [...timers])if(timer.at<=time){timers.delete(id);timer.fn();}}};
}
test('stable owners share one Blob URL; final unused release revokes it',()=>{
 const f=setup(),a=f.links.acquire(options,'panel'),again=f.links.acquire(options,'panel'),b=f.links.acquire(options,'dialog');
 assert.equal(a.id,again.id);assert.equal(a.url,b.url);assert.equal(f.created.length,1);assert.equal(f.created[0].type,'image/png');
 f.links.release(a.id,'panel');assert.equal(f.revoked.length,0);f.links.release(b.id,'dialog');assert.deepEqual(f.revoked,[a.url]);
});
test('download gets a 60-second release grace without a real wait',()=>{
 const f=setup(),a=f.links.acquire(options,'panel');f.links.beginDownload(a.id,'panel');f.links.release(a.id,'panel');
 assert.equal(f.links.getState().deferred,1);f.advance(59_999);assert.equal(f.revoked.length,0);f.advance(1);assert.deepEqual(f.revoked,[a.url]);
});
test('source invalidation disables future clicks but preserves an already-started download grace',()=>{
 const f=setup(),a=f.links.acquire(options,'panel');f.links.beginDownload(a.id,'panel');f.unset();f.links.reconcile();
 assert.equal(f.links.getState().current,0);assert.equal(f.revoked.length,0);
 assert.throws(()=>f.links.beginDownload(a.id,'panel'),e=>e.code==='download-link-unavailable');f.advance(60_000);assert.deepEqual(f.revoked,[a.url]);
});
test('click checks current readiness even when no reconcile notification occurred',()=>{
 const f=setup(),a=f.links.acquire(options,'panel');f.unset();
 assert.throws(()=>f.links.beginDownload(a.id,'panel'),e=>e.code==='export-not-ready');assert.deepEqual(f.revoked,[a.url]);
});
test('replacement creates a new URL and old owner cleanup cannot release the new link',()=>{
 const f=setup(),old=f.links.acquire(options,'panel');f.replace();const next=f.links.acquire(options,'panel');
 assert.notEqual(old.id,next.id);assert.deepEqual(f.revoked,[old.url]);f.links.release(old.id,'panel');assert.equal(f.links.getState().current,1);
 f.links.close();assert.deepEqual(f.revoked,[old.url,next.url]);
});
test('page teardown revokes grace URLs immediately and forbids recreation',()=>{
 const f=setup(),a=f.links.acquire(options,'panel');f.links.beginDownload(a.id,'panel');f.links.release(a.id,'panel');
 f.links.close();f.links.close();assert.deepEqual(f.revoked,[a.url]);f.advance(60_000);assert.equal(f.revoked.length,1);
 assert.throws(()=>f.links.acquire(options,'panel'),e=>e.code==='download-links-closed');
});
test('URL creation errors are fixed and do not change the prepared file',()=>{
 const f=setup({createFailure:true});
 assert.throws(()=>f.links.acquire(options,'panel'),e=>e.code==='download-prepare-failed'&&e.message==='download-prepare-failed');assert.equal(f.links.getState().urls,0);
});
test('real Node Blob URL can be read locally and is revoked on close',async()=>{
 const file={bytes:Uint8Array.of(1,2,3),mime:'image/png',filename:'image-studio-background.png'};
 const links=createDownloadLinks({getReady:()=>file});
 try{
  const link=links.acquire(options,'panel'),download=links.beginDownload(link.id,'panel');
  assert.deepEqual([...new Uint8Array(await(await fetch(download.url)).arrayBuffer())],[1,2,3]);
  links.close();await assert.rejects(fetch(download.url));
 }finally{links.close();}
});
