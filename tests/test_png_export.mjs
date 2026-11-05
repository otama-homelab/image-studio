import test from 'node:test';
import assert from 'node:assert/strict';
import {crc32} from 'node:zlib';
import {createPngExporter} from '../tools/browser-library-adapter/png-export.mjs';
// Actual fast-png 8.0.0 output for a public 2x2 synthetic RGB pattern, independently decoded with Pillow.
const golden=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAF0lEQVR4XmP4+vm9SMAChoCUil8fngEANigH2FLmW1kAAAAASUVORK5CYII=','base64'));
const image=()=>({width:2,height:2,format:'rgb-u8',data:Uint8Array.of(245,243,239,20,80,160,80,100,120,250,240,230).buffer});
function chunks(bytes){const result=[];let at=8;const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);while(at<bytes.length){const end=at+12+view.getUint32(at);result.push({name:String.fromCharCode(...bytes.subarray(at+4,at+8)),frame:bytes.subarray(at,end),data:bytes.subarray(at+8,end-4)});at=end;}return result;}
test('print exports add one big-endian 300dpi density chunk without changing IDAT',()=>{
 const exportPng=createPngExporter({encode:()=>golden,crc32});
 const crop=exportPng(image(),{kind:'crop'});
 for(const output of [crop]){
  const parts=chunks(output.bytes),density=parts.filter(c=>c.name==='pHYs');assert.equal(density.length,1);
  const v=new DataView(density[0].data.buffer,density[0].data.byteOffset,9);assert.equal(v.getUint32(0),11811);assert.equal(v.getUint32(4),11811);assert.equal(v.getUint8(8),1);
  assert.ok(parts.findIndex(c=>c.name==='pHYs')<parts.findIndex(c=>c.name==='IDAT'));
  assert.deepEqual(parts.find(c=>c.name==='IDAT').frame,chunks(golden).find(c=>c.name==='IDAT').frame);
  const frame=density[0].frame,cv=new DataView(frame.buffer,frame.byteOffset,frame.byteLength);assert.equal(crc32(frame.subarray(4,-4)),cv.getUint32(frame.length-4));
 }
 assert.equal(crop.filename,'image-studio-crop-300dpi.png');assert.throws(()=>exportPng(image(),{kind:'paper',paper:'a4'}),e=>e.code==='invalid-export-input');
});
test('old or duplicate density chunks are replaced or removed by export kind',()=>{
 const simple=createPngExporter({encode:()=>golden,crc32}),crop=simple(image(),{kind:'crop'}).bytes;
 const phys=chunks(crop).find(c=>c.name==='pHYs').frame,parts=chunks(golden);
 const duplicate=Uint8Array.from(Buffer.concat([golden.subarray(0,8),parts[0].frame,phys,phys,...parts.slice(1).map(c=>c.frame)]));
 const exporter=createPngExporter({encode:()=>duplicate,crc32});
 assert.equal(chunks(exporter(image(),{kind:'crop'}).bytes).filter(c=>c.name==='pHYs').length,1);
 assert.equal(chunks(exporter(image(),{kind:'background'}).bytes).filter(c=>c.name==='pHYs').length,0);
});
test('corruption, unchecked allocation lengths and trailing data are refused',()=>{
 const bad=golden.slice();bad[bad.length-1]^=1;
 const huge=golden.slice();new DataView(huge.buffer).setUint32(8,0x7fffffff);
 for(const data of [bad,huge,golden.subarray(0,-1),Uint8Array.from([...golden,0])])assert.throws(()=>createPngExporter({encode:()=>data,crc32})(image(),{kind:'background'}),e=>e.code==='png-output-invalid');
});
test('invalid kind/format is stopped before encoding; dependency exceptions are fixed',()=>{
 let calls=0;const exporter=createPngExporter({encode:()=>{calls++;return golden;},crc32});
 for(const options of [{kind:'transparent'},{kind:'paper',paper:'private-name'},{kind:'unknown'}])assert.throws(()=>exporter(image(),options),e=>e.code==='invalid-export-input');
 assert.equal(calls,0);
 assert.throws(()=>createPngExporter({encode:()=>{throw Error('private encoder payload');},crc32})(image(),{kind:'background'}),e=>e.message==='png-encode-failed');
});
