import test from 'node:test';
import assert from 'node:assert/strict';
import {cropBox} from '../tools/browser-library-adapter/print-geometry.mjs';
import {cropView,createCropDrag} from '../tools/browser-library-adapter/crop-view.mjs';
const crop={width:1600,height:2000,outputWidth:354,outputHeight:472,range:50,horizontal:50,vertical:50};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('fit maps crop corners and source coordinates in both directions with letterboxing',()=>{
 const view=cropView(crop,{width:600,height:600}),box=cropBox(crop);
 assert.deepEqual(view.sourceToView(box[0],box[1]),[75,0]);
 assert.deepEqual(view.sourceToView(box[2],box[3]),[525,600]);
 const original=[1211.2,763.9],restored=view.viewToSource(...view.sourceToView(...original));restored.forEach((n,i)=>near(n,original[i]));
});
test('right/down drag moves photo right/down, matching independently entered crop settings',()=>{
 const drag=createCropDrag(crop,{width:600,height:600},{x:100,y:120}),result=drag.move(160,150);
 // Original crop 750x1000 at (425,500), scale .6. Move origin left 100/up 50.
 near(result.horizontal,100*325/850);near(result.vertical,45);
 const box=cropBox(result);box.forEach((n,i)=>near(n,[325,450,1075,1450][i]));
});
test('pointer updates use original snapshot and keep it isolated from later settings mutations',()=>{
 const input={...crop},stage={width:600,height:600},drag=createCropDrag(input,stage,{x:10,y:20});
 drag.move(70,50);input.range=100;input.width=999;stage.width=1200;
 const last=drag.move(130,80),direct=createCropDrag(crop,{width:600,height:600},{x:10,y:20}).move(130,80);
 assert.deepEqual(last,direct);assert.equal(last.range,50);assert.ok(Object.isFrozen(last));
});
test('corresponding moves at different stage sizes give identical saved coordinates',()=>{
 const small=createCropDrag(crop,{width:600,height:600},{x:0,y:0}).move(60,30);
 const large=createCropDrag(crop,{width:1200,height:1200},{x:0,y:0}).move(120,60);
 assert.deepEqual(cropBox(small),cropBox(large));
 const box=cropBox(crop);cropView(crop,{width:300,height:1000});assert.deepEqual(cropBox(crop),box);
});
test('drag clamps at all edges; axes without travel preserve their settings',()=>{
 const drag=createCropDrag(crop,{width:600,height:600},{x:0,y:0});
 const first=drag.move(1e6,1e6),last=drag.move(-1e6,-1e6);
 assert.deepEqual([first.horizontal,first.vertical],[0,0]);assert.deepEqual([last.horizontal,last.vertical],[100,100]);
 const fixed={width:100,height:100,outputWidth:600,outputHeight:600,range:100,horizontal:27,vertical:83};
 assert.deepEqual(createCropDrag(fixed,{width:600,height:300},{x:0,y:0}).move(500,500),fixed);
});
test('invalid stage/pointer values fail before altering committed settings',()=>{
 for(const stage of [{width:0,height:10},{width:10,height:Infinity},{width:NaN,height:10}])assert.throws(()=>cropView(crop,stage),e=>e.code==='invalid-crop-view');
 assert.throws(()=>createCropDrag(crop,{width:100,height:100},{x:NaN,y:0}),e=>e.code==='invalid-pointer');
 const drag=createCropDrag(crop,{width:100,height:100},{x:0,y:0});assert.throws(()=>drag.move(0,Infinity),e=>e.code==='invalid-pointer');
 assert.equal(crop.horizontal,50);assert.equal(crop.vertical,50);
});
