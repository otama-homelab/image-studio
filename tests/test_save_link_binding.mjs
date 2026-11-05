import test from 'node:test';
import assert from 'node:assert/strict';
import {bindSaveLink} from '../tools/browser-library-adapter/save-link-binding.mjs';
class Anchor extends EventTarget{
 attributes=new Map();setAttribute(k,v){this.attributes.set(k,v);}removeAttribute(k){this.attributes.delete(k);}getAttribute(k){return this.attributes.get(k)??null;}
}
function setup(){
 const anchor=new Anchor(),pageTarget=new EventTarget();let link={url:'blob:owned',filename:'paper-l.pdf'},reads=0,closed=0,cleanup=0;
 const control={reconcile(){},getState:()=>({phase:link?'ready':'stale',link}),beginDownload(){reads++;return link;},close(){closed++;}};
 const binding=bindSaveLink({anchor,control,pageTarget,onPageHide:()=>cleanup++});
 return {anchor,pageTarget,binding,invalidate:()=>{link=null;},get reads(){return reads;},get closed(){return closed;},get cleanup(){return cleanup;}};
}
test('explicit refresh publishes native download attributes without activating download',()=>{
 const f=setup();assert.equal(f.anchor.getAttribute('href'),null);f.binding.refresh();
 assert.equal(f.anchor.getAttribute('href'),'blob:owned');assert.equal(f.anchor.getAttribute('download'),'paper-l.pdf');assert.equal(f.reads,0);f.binding.close();
});
for(const type of ['click','auxclick','contextmenu'])test(type+' revalidates synchronously and prevents stale activation',()=>{
 const f=setup();f.binding.refresh();const valid=new Event(type,{cancelable:true});assert.equal(f.anchor.dispatchEvent(valid),true);assert.equal(f.reads,1);
 f.invalidate();const stale=new Event(type,{cancelable:true});assert.equal(f.anchor.dispatchEvent(stale),false);assert.equal(f.reads,2);
 assert.equal(f.anchor.getAttribute('href'),null);assert.equal(f.anchor.getAttribute('download'),null);assert.equal(f.anchor.getAttribute('aria-disabled'),'true');f.binding.close();
});
test('pagehide removes links/listeners and closes owned control and session callback once',()=>{
 const f=setup();f.binding.refresh();f.pageTarget.dispatchEvent(new Event('pagehide'));f.pageTarget.dispatchEvent(new Event('pagehide'));
 assert.equal(f.closed,1);assert.equal(f.cleanup,1);assert.equal(f.anchor.getAttribute('href'),null);
 f.binding.refresh();f.anchor.dispatchEvent(new Event('click'));assert.equal(f.reads,0);f.binding.close();
});
test('unmount removes only binding and leaves shared control lifecycle to caller',()=>{
 const f=setup();f.binding.refresh();f.binding.close();f.pageTarget.dispatchEvent(new Event('pagehide'));assert.equal(f.closed,0);assert.equal(f.cleanup,0);assert.equal(f.anchor.getAttribute('href'),null);
});
