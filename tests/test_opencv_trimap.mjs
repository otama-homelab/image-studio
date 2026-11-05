import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenCvTrimap,trimapRadius} from '../tools/browser-library-adapter/opencv-trimap.mjs';
function fakeCv({erodeFailure=false,deleteFailure=false}={}){
 const allocated=[],calls=[];
 class Mat {constructor(){this.data=new Uint8Array();this.deleted=false;allocated.push(this);}delete(){this.deleted=true;if(deleteFailure&&allocated[0]===this)throw Error('Synthetic delete failure');}}
 const cv={Mat,CV_8UC1:0,MORPH_ELLIPSE:2,THRESH_BINARY:0,THRESH_BINARY_INV:1,Size:class{constructor(width,height){this.width=width;this.height=height;}},
  matFromArray(h,w,type,data){calls.push({name:'matFromArray',h,w,type});const mat=new Mat();mat.data=data.slice();return mat;},
  getStructuringElement(shape,size){calls.push({name:'kernel',shape,size});return new Mat();},
  threshold(src,dst,threshold,max,type){calls.push({name:'threshold',threshold,max,type});dst.data=Uint8Array.from(src.data,x=>type===0?(x>threshold?max:0):(x>threshold?0:max));},
  erode(...args){calls.push({name:'erode',args});if(erodeFailure)throw Error('Synthetic erosion failure');/* Identity test double: no morphology kernel here. */},
 };
 return {cv,allocated,calls};
}
test('adapter delegates ellipse and erosion, with exact threshold boundaries and independent output',()=>{
 const f=fakeCv(),data=Uint8Array.of(0,5,6,249,250,255),before=data.slice();
 const result=createOpenCvTrimap(f.cv)({width:6,height:1,layout:'alpha-u8',data:data.buffer});
 assert.deepEqual([...new Uint8Array(result.data)],[0,0,128,128,255,255]);assert.deepEqual(data,before);
 const kernel=f.calls.find(c=>c.name==='kernel');assert.equal(kernel.shape,2);assert.deepEqual({...kernel.size},{width:7,height:7});
 const erosions=f.calls.filter(c=>c.name==='erode');assert.equal(erosions.length,2);
 for(const call of erosions){assert.equal(call.args.length,3);assert.equal(call.args[0],call.args[1]);}
 assert.equal(f.allocated.length,4);assert.ok(f.allocated.every(m=>m.deleted));
});
test('radius follows Python ties-to-even at relevant long-edge values',()=>{
 for(const [edge,expected] of [[1,3],[500,3],[750,4],[1250,8],[1750,10],[2000,12]])assert.equal(trimapRadius(edge,1),expected);
 for(const edge of [0,2001,1.5,Infinity])assert.throws(()=>trimapRadius(edge,1));
});
test('all allocated Mats are deleted when morphology or cleanup fails',()=>{
 for(const options of [{erodeFailure:true},{deleteFailure:true}]){
  const f=fakeCv(options);assert.throws(()=>createOpenCvTrimap(f.cv)({width:1,height:1,layout:'alpha-u8',data:new ArrayBuffer(1)}));
  assert.equal(f.allocated.length,4);assert.ok(f.allocated.every(m=>m.deleted));
 }
});
test('invalid planes fail before allocating any OpenCV Mat',()=>{
 const f=fakeCv();assert.throws(()=>createOpenCvTrimap(f.cv)({width:1,height:1,layout:'rgb-u8-interleaved',data:new ArrayBuffer(3)}));assert.equal(f.allocated.length,0);
});
