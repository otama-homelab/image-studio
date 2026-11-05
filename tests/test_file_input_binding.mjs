import test from 'node:test';
import assert from 'node:assert/strict';
import {bindFileInput} from '../tools/browser-library-adapter/file-input-binding.mjs';
import {createInputLoad} from '../tools/browser-library-adapter/input-load.mjs';
import {createImageRegistry} from '../tools/browser-library-adapter/image-registry.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Picker extends EventTarget{files=[];value='';multiple=true;select(file){this.files=[file];this.value='private path';this.dispatchEvent(new Event('change'));}}
const pixel=n=>({width:1,height:1,format:'rgb-u8',data:Uint8Array.of(n,2,3).buffer});
function setup(onChange){const input=new Picker(),pageTarget=new EventTarget(),registry=createImageRegistry(),reads=[];const owner=createInputLoad({registry,read:(file,hooks)=>{const work=deferred();reads.push({file,hooks,work});return work.promise;}});const binding=bindFileInput({input,owner,pageTarget,onChange});return {input,pageTarget,registry,owner,reads,binding};}
test('same file can be selected again; published state has only metadata',async()=>{
 const seen=[],f=setup(state=>seen.push(state)),file=new Blob(['private image']);assert.equal(f.input.multiple,false);f.input.select(file);await tick();assert.equal(f.input.value,'');f.reads[0].work.resolve(pixel(1));await tick();const first=f.binding.getState().input;assert.equal(f.binding.getState().phase,'ready');
 f.input.select(file);await tick();assert.equal(f.reads.length,2);f.reads[1].work.resolve(pixel(2));await tick();assert.notEqual(f.binding.getState().input.inputId,first.inputId);assert.equal(JSON.stringify(seen).includes('private'),false);assert.equal('data' in f.binding.getState().input.image,false);await f.binding.close();
});
test('rapid selection discards old result and only latest completion reaches UI',async()=>{
 const f=setup();f.input.select(new Blob(['one']));await tick();f.input.select(new Blob(['two']));assert.equal(f.reads[0].hooks.signal.aborted,true);f.reads[0].work.resolve(pixel(1));await tick();assert.equal(f.binding.getState().phase,'loading');f.reads[1].work.resolve(pixel(2));await tick();assert.equal(new Uint8Array(f.registry.copy(f.binding.getState().input.image.id).data)[0],2);await f.binding.close();
});
test('pagehide removes listener and close callers await the pending decoder',async()=>{
 const f=setup();f.input.select(new Blob(['one']));await tick();f.pageTarget.dispatchEvent(new Event('pagehide'));const closed=f.binding.close();assert.equal(closed,f.binding.close());let done=false;closed.then(()=>{done=true;});await tick();assert.equal(done,false);assert.equal(f.binding.getState().phase,'closed');f.input.select(new Blob(['two']));assert.equal(f.reads.length,1);f.reads[0].work.resolve(pixel(1));await closed;assert.equal(f.owner.get(),null);
});
test('load failure keeps current input and publishes a fixed code',async()=>{
 const f=setup();f.input.select(new Blob(['one']));await tick();f.reads[0].work.resolve(pixel(1));await tick();const old=f.binding.getState().input;f.input.select(new Blob(['broken']));await tick();f.reads[1].work.reject(Error('private filename'));await tick();assert.equal(f.binding.getState().input,old);assert.equal(f.binding.getState().errorCode,'input-load-failed');await f.binding.close();
});
test('observer exceptions do not prevent decode or terminal cleanup',async()=>{
 const f=setup(()=>{throw Error('observer');});f.input.select(new Blob(['one']));await tick();f.reads[0].work.resolve(pixel(1));await tick();assert.equal(f.binding.getState().phase,'ready');await f.binding.close();
});
test('synchronous close from loading observer prevents decoder start',async()=>{
 let f;f=setup(state=>{if(state.phase==='loading')void f.binding.close();});f.input.select(new Blob(['one']));await f.binding.close();assert.equal(f.reads.length,0);assert.equal(f.binding.getState().phase,'closed');
});
test('pagehide stop failure remains observable through close Promise',async()=>{
 const f=setup();f.input.select(new Blob(['one']));await tick();f.pageTarget.dispatchEvent(new Event('pagehide'));const rejected=assert.rejects(f.binding.close(),e=>e.message==='input-stop-failed');await tick();f.reads[0].work.reject(Object.assign(Error('private driver'),{code:'png-input-worker-stop-failed'}));await rejected;assert.equal(f.owner.getState().blocked,true);assert.equal(f.binding.getState().phase,'closed');
});
