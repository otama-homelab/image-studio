import fs from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
export function checkPillowResizeCases(adapter){
 const sha=b=>createHash('sha256').update(b).digest('hex');
const reference=JSON.parse(fs.readFileSync(new URL('../../docs/browser/validation/2026-11-01-pillow-resize-reference-v2.json',import.meta.url),'utf8')),results=[];
const source=Uint8Array.from(Buffer.from(reference.sourceRgbHex,'hex')),input={width:7,height:5,format:'rgb-u8',data:source.buffer};
for(const c of reference.cases){
 const result=adapter.resize(input,{width:c.outputSize[0],height:c.outputSize[1],box:c.box??undefined});
 assert.equal(sha(new Uint8Array(result.data)),c.sha256,c.name);results.push({name:c.name,allComponentsExact:true,sha256:c.sha256});
}
const matrix=JSON.parse(fs.readFileSync(new URL('../../docs/browser/validation/2026-11-01-pillow-native-matrix.json',import.meta.url),'utf8'));
for(const c of matrix.cases){
 const [w,h]=c.source,data=new Uint8Array(w*h*3);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let channel=0;channel<3;channel++){
  data[(y*w+x)*3+channel]=c.pattern==='constant'?[80,128,200][channel]:c.pattern==='ramp'?(x*37+y*59+channel*83)%256:c.pattern==='checker'?((x+y+channel)%2?255:0):(x===0||y===0||x===w-1||y===h-1?255:channel*61);
 }
 const before=sha(data),result=adapter.resize({width:w,height:h,format:'rgb-u8',data:data.buffer},{width:c.output[0],height:c.output[1],box:c.box});
 assert.equal(sha(new Uint8Array(result.data)),c.rgbSha256,JSON.stringify(c));assert.equal(sha(data),before);
}
assert.equal(sha(source),sha(Buffer.from(reference.sourceRgbHex,'hex')));return {results,matrixCases:matrix.cases.length,input};
}

/** Crop-only extreme aspect regression fixtures captured with Pillow Image.resize. */
export function checkPillowCropAspectCases(adapter){
 const fixture=JSON.parse(fs.readFileSync(new URL('../../tests/fixtures/crop-aspect-cases.json',import.meta.url),'utf8'));
 const sha=data=>createHash('sha256').update(data).digest('hex'),results=[];
 for(const item of fixture.cases){
  const [width,height]=item.source,data=new Uint8Array(width*height*3);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<3;c++)data[(y*width+x)*3+c]=(x*37+y*59+c*83)%256;
  assert.equal(sha(data),item.sourceSha256,item.name+' source');
  const result=adapter.resize({width,height,format:'rgb-u8',data:data.buffer},{width:item.output[0],height:item.output[1],box:item.box});
  assert.equal(sha(new Uint8Array(result.data)),item.rgbSha256,item.name);assert.equal(sha(data),item.sourceSha256,item.name+' unchanged');
  results.push({name:item.name,allComponentsExact:true,sourceUnchanged:true,sha256:item.rgbSha256});
 }
 return results;
}
