import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import sessionModule from '../docs/browser/prototype/session.js';
const {PrototypeSession}=sessionModule;
function bridge(){
 const context=vm.createContext({ResizeObserver:undefined},{codeGeneration:{strings:false,wasm:false}});
 vm.runInContext(fs.readFileSync(new URL('../docs/browser/prototype/crop-controls.js',import.meta.url),'utf8'),context);
 return context.PrototypeCropControls;
}
test('actual local bundle shares numeric settings, drag invalidation and preview geometry',()=>{
 const api=bridge(),s=new PrototypeSession();s.choose('crop');s.change('crop',{range:50});s.finish(s.start('crop'));assert.equal(s.canSave('crop'),true);
 const handlers=new Map(),captured=[],released=[];let ended=0;
 const element={getBoundingClientRect:()=>({width:225,height:300}),addEventListener:(t,f)=>handlers.set(t,f),removeEventListener:t=>handlers.delete(t),setPointerCapture:id=>captured.push(id),releasePointerCapture:id=>released.push(id)};
 const binding=api.bindCropPointer({element,getCrop:()=>api.geometry(s.stages.crop.settings),applyCrop:next=>api.applyDrag(s,next),onEnd:()=>ended++});
 const original=api.viewBox(s.stages.crop.settings);
 handlers.get('pointerdown')({pointerId:1,isPrimary:true,button:0,clientX:0,clientY:0});
 handlers.get('pointermove')({pointerId:1,clientX:15,clientY:15});
 assert.equal(s.canSave('crop'),false);assert.notEqual(api.viewBox(s.stages.crop.settings),original);
 const dragged=s.stages.crop.settings,position={x:dragged.x,y:dragged.y},dragBox=api.viewBox(dragged);
 s.change('crop',position);assert.equal(api.viewBox(s.stages.crop.settings),dragBox);
 handlers.get('pointercancel')({pointerId:1});assert.equal(ended,1);assert.deepEqual(captured,[1]);assert.deepEqual(released,[1]);
 binding.close();binding.close();assert.equal(ended,1);assert.equal(handlers.size,0);
});
test('prototype loads local bridge before UI and shares viewBox rather than duplicate crop formulas',()=>{
 const html=fs.readFileSync(new URL('../docs/browser/prototype/index.html',import.meta.url),'utf8');
 assert.ok(html.indexOf('crop-controls.js')<html.indexOf('prototype.js'));
 const js=fs.readFileSync(new URL('../docs/browser/prototype/prototype.js',import.meta.url),'utf8');
 assert.ok(js.includes('PrototypeCropControls.viewBox(crop)'));assert.ok(js.includes('cropPointer?.close()'));
});

test('actual bundle paper SVG and displayed counts match every independent Python position',()=>{
 const api=bridge(),reference=JSON.parse(fs.readFileSync(new URL('../docs/browser/validation/2026-10-31-geometry-reference.json',import.meta.url),'utf8'));
 for(const [index,label] of ['A4','L','2L','はがき'].entries()){
  const expected=reference.layouts[index],layout=api.printLayout(label),svg=api.paperDrawing(label);
  assert.deepEqual([layout.width,layout.height],expected.sheet_px);assert.equal(layout.count,expected.positions_px.length);
  assert.ok(svg.includes(`viewBox="0 0 ${expected.sheet_px.join(' ')}"`));
  const positions=[...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="354" height="472"/g)].map(m=>[Number(m[1]),Number(m[2])]);
  assert.deepEqual(positions,expected.positions_px);
 }
});

test('actual tracker bundle connects prototype intent state and rejects a retained late completion',()=>{
 const api=bridge();let sequence=0;const tracker=api.createOperationTracker({createId:()=>`prototype-intent-${++sequence}`});
 const s=new PrototypeSession({operationTracker:tracker}),phases=[];tracker.subscribe(state=>phases.push(state?.phase??'idle'));
 s.choose('crop');const first=s.start('crop');assert.equal(s.activeJob.kind,'resize');assert.equal(s.activeJob.operationId,first.operationId);
 s.cancel();assert.equal(s.activeJob,null);assert.deepEqual(phases,['running','cancelling','idle']);
 const next=s.start('crop');assert.notEqual(first.operationId,next.operationId);assert.equal(s.finish(first),false);assert.equal(s.finish({...next,operationId:first.operationId}),false);assert.equal(s.tick(next.id,first.operationId),false);assert.equal(s.activeJob.operationId,next.operationId);
 assert.equal(s.finish(next),true);assert.equal(s.activeJob,null);assert.equal(s.canSave('crop'),true);
});
test('prototype faults and photo replacement finish only their current operation',()=>{
 const api=bridge();let sequence=0;const tracker=api.createOperationTracker({createId:()=>`prototype-intent-${++sequence}`}),s=new PrototypeSession({operationTracker:tracker});
 s.choose('background');s.fault='memory';const failed=s.start('background');assert.equal(s.activeJob.kind,'inference');assert.equal(s.finish(failed),false);assert.equal(s.activeJob,null);
 s.choose('print');const old=s.start('print');assert.equal(s.activeJob.kind,'paper');s.choose('print','replacement');const next=s.start('print');
 assert.equal(s.finish(old),false);assert.equal(s.activeJob.operationId,next.operationId);s.cancel();assert.equal(s.activeJob,null);
});
