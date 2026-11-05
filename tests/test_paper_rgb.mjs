import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPaperRgb} from '../tools/browser-library-adapter/paper-rgb.mjs';
test('L sheet copies three photos unchanged, all other pixels white, original untouched',()=>{
 const width=354,height=472,input=new Uint8Array(width*height*3);
 for(let i=0;i<input.length;i++)input[i]=(i*13+7)%251;
 const before=input.slice(),{image,layout}=renderPaperRgb({width,height,format:'rgb-u8',data:input.buffer},{paper:'l',dpi:[300,300]});
 assert.equal(layout.count,3);assert.deepEqual([image.width,image.height],[1500,1051]);
 const actual=new Uint8Array(image.data);
 // Expected regions come directly from the independent Python fixture, not the returned layout.
 const origins=[[184,289],[573,289],[962,289]];
 for(let y=0;y<1051;y++)for(let x=0;x<1500;x++){
  const origin=origins.find(([ox,oy])=>x>=ox&&x<ox+width&&y>=oy&&y<oy+height);
  const offset=(y*1500+x)*3;
  for(let c=0;c<3;c++){
   const expected=origin?before[((y-origin[1])*width+x-origin[0])*3+c]:255;
   if(actual[offset+c]!==expected)assert.fail(`pixel mismatch at ${x},${y},${c}`);
  }
 }
 assert.deepEqual(input,before);
});
test('wrong plane type and mismatched lengths are rejected before sheet allocation',()=>{
 for(const photo of [{width:1,height:1,format:'rgba-u8',data:new ArrayBuffer(4)},{width:2,height:1,format:'rgb-u8',data:new ArrayBuffer(3)}])assert.throws(()=>renderPaperRgb(photo,{paper:'a4'}),e=>e.code==='invalid-photo-rgb');
});
