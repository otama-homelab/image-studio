import {Blob as NativeBlob} from 'node:buffer';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {afterEach,expect,test,vi} from 'vitest';
import {encode,convertIndexedToRgb} from 'fast-png';
import {imageDimensionsFromData} from 'image-dimensions';
import crc32 from 'crc-32';
import PngDecoder from 'fast-png-decoder';
import {readKeyword} from 'fast-png-keyword';
import {unzlibSync} from 'fflate';
import adler32 from 'pako-adler32';
import {createBoundedPngDecode} from '../../tools/browser-library-adapter/bounded-png-decode.mjs';
import {createPngInput} from '../../tools/browser-library-adapter/png-input.mjs';
import {inspectImage} from '../src/imageInput';
import fixtures from './fixtures/png-grayscale/manifest.json';
const decode=createBoundedPngDecode({PngDecoder,readKeyword,unzlibSync,adler32});
const read=createPngInput({inspect:inspectImage,decode,expandIndexed:convertIndexedToRgb});
const bytes=(name:string)=>new Uint8Array(readFileSync(new URL('./fixtures/png-grayscale/'+name,import.meta.url)));
const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
const rgb=(rgba:Uint8Array)=>rgba.filter((_,index)=>index%4!==3);
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
test.each(fixtures.fixtures)('Pillow $mode $width x $height interlace=$interlace retains gray samples and alpha exactly',async item=>{
 const input=bytes(item.file),expected=new Uint8Array(Buffer.from(item.rgbaBase64,'base64'));expect(sha(input)).toBe(item.sha256);
 const image=await read(new NativeBlob([input]));expect([image.width,image.height]).toEqual([item.width,item.height]);
 expect(image.format).toBe(item.mode==='L'?'rgb-u8':'rgba-u8');const output=new Uint8Array(image.data);expect(output).toEqual(image.format==='rgb-u8'?rgb(expected):expected);expect(sha(image.format==='rgb-u8'?output:rgb(output))).toBe(item.rgbSha256);
});
// Test-only chunks; the production parser, CRC and pixel filtering stay upstream.
function addChunk(input:Uint8Array,type:string,data:Uint8Array){
 const chunk=new Uint8Array(data.length+12),view=new DataView(chunk.buffer);view.setUint32(0,data.length);chunk.set(new TextEncoder().encode(type),4);chunk.set(data,8);view.setUint32(data.length+8,crc32.buf(chunk.subarray(4,data.length+8))>>>0);
 const output=new Uint8Array(input.length+chunk.length);output.set(input.subarray(0,33));output.set(chunk,33);output.set(input.subarray(33),33+chunk.length);return output;
}
test('grayscale cannot be reinterpreted as indexed by an illegal palette and malformed transparency is rejected',async()=>{
 for(const name of ['l8-3x5.png','la8-3x5.png'])await expect(read(new NativeBlob([addChunk(bytes(name),'PLTE',new Uint8Array([11,22,33]))]))).rejects.toMatchObject({code:'png-decode-failed'});
 for(const values of [[0,11,0,22],[1,0]])await expect(read(new NativeBlob([addChunk(bytes('l8-3x5.png'),'tRNS',new Uint8Array(values))]))).rejects.toMatchObject({code:'png-pixels-unsupported'});
 const corrupt=bytes('l-trns8-3x5.png');corrupt[corrupt.length-1]^=1;expect(()=>decode(corrupt,{checkCrc:false})).toThrow();
});
test('grayscale keeps inflated-byte bounds and rejects oversized metadata before inflation',()=>{
 for(const name of ['l8-9x5.png','la8-9x5.png']){
  const input=bytes(name),view=new DataView(input.buffer);view.setUint32(16,1);view.setUint32(20,1);view.setUint32(29,crc32.buf(input.subarray(12,29))>>>0);expect(()=>decode(input)).toThrow();
 }
 const oversized=encode({width:1,height:1,channels:1,depth:16,data:new Uint16Array([1234])}),header=new DataView(oversized.buffer);header.setUint32(16,4097);header.setUint32(29,crc32.buf(oversized.subarray(12,29))>>>0);const inflate=vi.fn(unzlibSync),bounded=createBoundedPngDecode({PngDecoder,readKeyword,unzlibSync:inflate,adler32});expect(()=>bounded(oversized)).toThrow('unsupported-png-input');expect(inflate).not.toHaveBeenCalled();
});
async function print(input:Uint8Array){
 let receive:any;const post=vi.fn(),canvas=vi.fn(()=>{throw Error('No native Canvas for direct PNG');});vi.stubGlobal('Blob',NativeBlob);vi.stubGlobal('OffscreenCanvas',canvas);vi.stubGlobal('self',{addEventListener:(_type:string,listener:any)=>{receive=listener;},postMessage:post});await import('../src/export/crop.worker');
 const dimensions=imageDimensionsFromData(input)!;await receive({data:{type:'crop-png',jobId:'grayscale',mode:'original',file:new NativeBlob([input]),sourceWidth:dimensions.width,sourceHeight:dimensions.height,output:{kind:'paper',paper:'l',format:'png'}}});expect(post).toHaveBeenCalledOnce();expect(canvas).not.toHaveBeenCalled();expect(post.mock.calls[0][0].type).toBe('crop-png-ready');return post.mock.calls[0][0].file.bytes;
}
test.each(['LA','L-tRNS'])('actual direct-print handler for %s matches independent Pillow RGB including transparent samples',async mode=>{
 const item=fixtures.fixtures.find(item=>item.mode===mode&&item.width===3)!;
 const gray=await print(bytes(item.file));vi.resetModules();const expected=rgb(new Uint8Array(Buffer.from(item.rgbaBase64,'base64')));expect(sha(expected)).toBe(item.rgbSha256);
 const reference=await print(encode({width:item.width,height:item.height,channels:3,depth:8,data:expected}));expect(sha(gray)).toBe(sha(reference));
});
