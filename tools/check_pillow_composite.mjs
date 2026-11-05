/** Compare plain integer composition against a pinned Pillow artifact, no ML runtime. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {compositeOpaqueBackground} from './browser-library-adapter/composite-rgb.mjs';
const [fixturePath,output]=process.argv.slice(2);
if(!output||fs.existsSync(output))throw Error('Need fixture and new report');
const fixture=JSON.parse(fs.readFileSync(fixturePath));
const rgba=Uint8Array.from(Buffer.from(fixture.rgba,'base64')),before=rgba.slice();
const cases=fixture.cases.map(c=>{
 const actual=compositeOpaqueBackground(rgba,c.color),expected=Buffer.from(c.expectedRGB,'base64');
 assert.equal(actual.length,expected.length);
 let mismatches=0,maxDelta=0;
 for(let i=0;i<actual.length;i++){const d=Math.abs(actual[i]-expected[i]);if(d)mismatches++;maxDelta=Math.max(maxDelta,d);}
 assert.equal(mismatches,0);
 return {color:c.color,pixels:actual.length/3,mismatchingChannels:mismatches,maxChannelDifference:maxDelta};
});
assert.deepEqual(rgba,before);
for(const color of [[-1,0,0],[0,256,0],[NaN,0,0],[1.1,0,0],[]])assert.throws(()=>compositeOpaqueBackground(rgba,color),TypeError);
assert.throws(()=>compositeOpaqueBackground(new Uint8Array(3),[0,0,0]),TypeError);
const report={status:'passed',referencePillow:fixture.pillow,sourceShape:[fixture.height,fixture.width],coverage:'All 256 foreground channel values × all 256 alpha values, four RGB backgrounds',cases,sourceUnchanged:true,invalidInputsRejected:true,currentRssBytes:process.memoryUsage().rss,limitations:['Opaque background only. Arbitrary background alpha and image color profiles untested.','Synthetic straight RGBA; foreground estimation, PNG encoding and browser pipeline not tested.','This small CPU-only check loads no model, GPU, browser or ML library.']};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
