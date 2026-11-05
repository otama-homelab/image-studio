import test from 'node:test';
import assert from 'node:assert/strict';
import {bindCropPointer} from '../tools/browser-library-adapter/crop-pointer.mjs';
function setup(){
 let crop={width:1600,height:2000,outputWidth:354,outputHeight:472,range:50,horizontal:50,vertical:50},resize,disconnected=false,failCapture=false,stageWidth=600;
 const handlers=new Map(),updates=[],captured=[],released=[];
 const element={getBoundingClientRect:()=>({width:stageWidth,height:600}),addEventListener:(type,fn)=>handlers.set(type,fn),removeEventListener:(type,fn)=>{assert.equal(handlers.get(type),fn);handlers.delete(type);},setPointerCapture:id=>{if(failCapture)throw Error();captured.push(id);},releasePointerCapture:id=>released.push(id)};
 class Observer{constructor(fn){resize=fn;}observe(target){assert.equal(target,element);}disconnect(){disconnected=true;}}
 const binding=bindCropPointer({element,getCrop:()=>crop,applyCrop:next=>{crop=next;updates.push(next);},ResizeObserverClass:Observer});
 const send=(type,patch={})=>handlers.get(type)?.({pointerId:1,isPrimary:true,button:0,clientX:100,clientY:100,...patch});
 return {binding,send,updates,captured,released,handlers,initialObservation:()=>resize(),resize:()=>{stageWidth=601;resize();},get disconnected(){return disconnected;},failCapture:()=>{failCapture=true;}};
}
test('primary drag captures pointer, commits movement, applies final pointerup and releases',()=>{
 const f=setup();f.send('pointerdown');f.send('pointermove',{clientX:160,clientY:130});
 assert.equal(f.updates.length,1);assert.equal(f.updates[0].vertical,45);
 f.send('pointerup',{clientX:220,clientY:160});assert.equal(f.updates.length,2);assert.equal(f.updates[1].vertical,40);
 assert.deepEqual(f.captured,[1]);assert.deepEqual(f.released,[1]);assert.equal(f.binding.getState().dragging,false);f.binding.close();
});
test('secondary pointers and other mouse buttons cannot start or hijack an active drag',()=>{
 const f=setup();f.send('pointerdown',{isPrimary:false});f.send('pointerdown',{button:2});assert.equal(f.binding.getState().dragging,false);
 f.send('pointerdown');f.send('pointerdown',{pointerId:2});f.send('pointermove',{pointerId:2,clientX:999});f.send('pointercancel',{pointerId:2});
 assert.equal(f.updates.length,0);assert.equal(f.binding.getState().dragging,true);assert.deepEqual(f.captured,[1]);f.binding.close();
});
for(const event of ['pointercancel','lostpointercapture','resize','end'])test(event+' ends drag retaining last valid setting',()=>{
 const f=setup();f.send('pointerdown');f.send('pointermove',{clientX:160,clientY:130});const last=f.updates[0];
 if(event==='resize')f.resize();else if(event==='end')f.binding.end();else f.send(event,{clientX:900});
 f.send('pointermove',{clientX:700});assert.equal(f.updates.length,1);assert.equal(f.updates[0],last);assert.equal(f.binding.getState().dragging,false);f.binding.close();
});
test('failed capture and invalid pointer stop without committing an invalid setting',()=>{
 const f=setup();f.failCapture();f.send('pointerdown');f.send('pointermove');assert.equal(f.binding.getState().dragging,false);assert.equal(f.updates.length,0);f.binding.close();
 const g=setup();g.send('pointerdown');g.send('pointermove',{clientX:NaN});assert.equal(g.updates.length,0);assert.equal(g.binding.getState().dragging,false);g.binding.close();
});
test('close releases capture, disconnects resize observer and removes all handlers idempotently',()=>{
 const f=setup();assert.deepEqual([...f.handlers.keys()].sort(),['lostpointercapture','pointercancel','pointerdown','pointermove','pointerup']);
 f.send('pointerdown');f.binding.close();f.binding.close();assert.deepEqual(f.released,[1]);assert.equal(f.disconnected,true);assert.equal(f.handlers.size,0);assert.equal(f.binding.getState().closed,true);
});

test('initial ResizeObserver delivery with unchanged size does not cancel an active drag',()=>{
 const f=setup();f.send('pointerdown');f.initialObservation();assert.equal(f.binding.getState().dragging,true);
 f.send('pointermove',{clientX:160});assert.equal(f.updates.length,1);f.binding.close();
});

test('click without movement and repeated identical moves do not change settings',()=>{
 const f=setup();f.send('pointerdown');f.send('pointerup');assert.equal(f.updates.length,0);
 f.send('pointerdown');f.send('pointermove',{clientX:160});f.send('pointermove',{clientX:160});f.send('pointerup',{clientX:160});assert.equal(f.updates.length,1);f.binding.close();
});
