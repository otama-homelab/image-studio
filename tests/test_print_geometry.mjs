import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {roundEven,photoPixels,cropBox,paperLayout} from '../tools/browser-library-adapter/print-geometry.mjs';
const reference=JSON.parse(readFileSync(new URL('../docs/browser/validation/2026-10-31-geometry-reference.json',import.meta.url)));
const paperKeys=['a4','l','2l','postcard'];
test('all four existing Python crop fixtures agree within 1e-9 px',()=>{
 for(const c of reference.crops){
  const box=cropBox({width:c.source_px[0],height:c.source_px[1],outputWidth:c.output_px[0],outputHeight:c.output_px[1],range:c.range_percent,horizontal:c.horizontal_percent,vertical:c.vertical_percent});
  box.forEach((n,i)=>assert.ok(Math.abs(n-c.box[i])<=1e-9));
 }
});
test('all four existing Python paper fixtures match every position exactly',()=>{
 reference.layouts.forEach((c,i)=>{
  const result=paperLayout({paper:paperKeys[i],photoWidth:c.photo_px[0],photoHeight:c.photo_px[1]});
  assert.deepEqual([result.width,result.height],c.sheet_px);assert.deepEqual(result.positions,c.positions_px);assert.equal(result.assumedDpi,true);
  assert.ok(Object.isFrozen(result.positions[0]));
 });
});
test('millimetres preserve Python operation order and ties-to-even',()=>{
 assert.equal(roundEven(2.5),2);assert.equal(roundEven(3.5),4);
 assert.deepEqual(photoPixels(30,40),[354,472]);assert.deepEqual(photoPixels(35,45),[413,531]);
 assert.deepEqual(photoPixels(24,30),[283,354]);assert.deepEqual(photoPixels(50.8,50.8),[600,600]);
 assert.deepEqual(photoPixels(152,9),[1795,106]);
 for(const n of [NaN,Infinity,8,153])assert.throws(()=>photoPixels(n,30),e=>e.code==='invalid-dimension');
});
test('fit rejects oversize without rotating, and accepts only finite 300dpi metadata',()=>{
 assert.throws(()=>paperLayout({paper:'l',photoWidth:1500,photoHeight:1051}),e=>e.code==='photo-does-not-fit');
 for(const dpi of [[72,300],[300,NaN],[300,Infinity],[300],300,[300,300.2]])assert.throws(()=>paperLayout({paper:'l',photoWidth:354,photoHeight:472,dpi}),e=>e.code==='unsupported-dpi');
 assert.equal(paperLayout({paper:'l',photoWidth:354,photoHeight:472,dpi:[299.9994,300]}).assumedDpi,false);
 assert.throws(()=>paperLayout({paper:'unknown',photoWidth:1,photoHeight:1}),e=>e.code==='invalid-layout');
});
test('full-width square and range extremes remain finite; invalid crop settings are rejected',()=>{
 assert.deepEqual(cropBox({width:100,height:100,outputWidth:600,outputHeight:600,horizontal:100,vertical:0}),[0,0,100,100]);
 assert.deepEqual(cropBox({width:100,height:100,outputWidth:600,outputHeight:600,range:10,horizontal:100,vertical:100}),[90,90,100,100]);
 for(const patch of [{width:0},{height:NaN},{range:9},{horizontal:101},{vertical:-1},{outputWidth:Infinity}])assert.throws(()=>cropBox({width:100,height:100,outputWidth:600,outputHeight:600,...patch}),e=>e.code==='invalid-crop');
});
