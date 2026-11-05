import {Blob as NativeBlob} from 'node:buffer';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {afterEach,expect,test,vi} from 'vitest';
import {encode,convertIndexedToRgb} from 'fast-png';
import crc32 from 'crc-32';
import PngDecoder from 'fast-png-decoder';
import {readKeyword} from 'fast-png-keyword';
import {unzlibSync} from 'fflate';
import adler32 from 'pako-adler32';
import {createBoundedPngDecode} from '../../tools/browser-library-adapter/bounded-png-decode.mjs';
import {createPngInput} from '../../tools/browser-library-adapter/png-input.mjs';
import {inspectImage} from '../src/imageInput';
import fixtures from './fixtures/png-rgb16/manifest.json';
const decode=createBoundedPngDecode({PngDecoder,readKeyword,unzlibSync,adler32});
const read=createPngInput({inspect:inspectImage,decode,expandIndexed:convertIndexedToRgb});
const bytes=(name:string)=>new Uint8Array(readFileSync(new URL('./fixtures/png-rgb16/'+name,import.meta.url)));
const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
const rgb=(rgba:Uint8Array)=>rgba.filter((_,index)=>index%4!==3);
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
test.each(fixtures.fixtures)('independent $channels-channel 16-bit $width x $height interlace=$interlace matches Pillow',async item=>{
 const input=bytes(item.file);expect(sha(input)).toBe(item.sha256);const raw=decode(input);expect(raw.data).toBeInstanceOf(Uint16Array);expect(Array.from(raw.data)).toEqual(item.samples);
 const expected=new Uint8Array(Buffer.from(item.rgbaBase64,'base64')),image=await read(new NativeBlob([input]));expect(image.format).toBe(item.channels===4?'rgba-u8':'rgb-u8');const output=new Uint8Array(image.data);expect(output).toEqual(item.channels===4?expected:rgb(expected));expect(sha(item.channels===4?rgb(output):output)).toBe(item.rgbSha256);
});
test('16-bit conversion rejects forged data types/length and owns its result independently',async()=>{
 const file=new NativeBlob(['fixture']),header={type:'png',width:1,height:1,fileBytes:file.size};
 for(const data of [new Uint8Array(3),new Uint16Array(2)]){
  const forged=createPngInput({inspect:async()=>header,decode:()=>({width:1,height:1,depth:16,channels:3,data})});await expect(forged(file)).rejects.toMatchObject({code:'png-pixels-unsupported'});
 }
 const samples=new Uint16Array([255,32767,65535]),reader=createPngInput({inspect:async()=>header,decode:()=>({width:1,height:1,depth:16,channels:3,data:samples})});const image=await reader(file);expect(new Uint8Array(image.data)).toEqual(new Uint8Array([0,127,255]));samples.fill(0);expect(new Uint8Array(image.data)).toEqual(new Uint8Array([0,127,255]));
});
test('16-bit RGB keeps CRC, dimensions and inflated-byte bounds without admitting invalid indexed16',()=>{
 const corrupt=bytes('rgba16-3x5.png');corrupt[corrupt.length-1]^=1;expect(()=>decode(corrupt,{checkCrc:false})).toThrow();
 const forged=bytes('rgba16-9x5.png'),view=new DataView(forged.buffer);view.setUint32(16,1);view.setUint32(20,1);view.setUint32(29,crc32.buf(forged.subarray(12,29))>>>0);expect(()=>decode(forged)).toThrow();
 const invalid=encode({width:1,height:1,channels:1,depth:16,data:new Uint16Array([123])});invalid[25]=3;new DataView(invalid.buffer).setUint32(29,crc32.buf(invalid.subarray(12,29))>>>0);const inflate=vi.fn(unzlibSync),bounded=createBoundedPngDecode({PngDecoder,readKeyword,unzlibSync:inflate,adler32});expect(()=>bounded(invalid)).toThrow();expect(inflate).not.toHaveBeenCalled();
});
test('actual direct-print handler from RGBA16 equals independent Pillow RGB without native Canvas',async()=>{
 const item=fixtures.fixtures.find(item=>item.channels===4&&item.width===3)!;
 async function print(input:Uint8Array){
  let receive:any;const post=vi.fn(),canvas=vi.fn(()=>{throw Error('No Canvas for direct PNG');});vi.stubGlobal('Blob',NativeBlob);vi.stubGlobal('OffscreenCanvas',canvas);vi.stubGlobal('self',{addEventListener:(_type:string,listener:any)=>{receive=listener;},postMessage:post});await import('../src/export/crop.worker');
  await receive({data:{type:'crop-png',jobId:'rgb16',mode:'original',file:new NativeBlob([input]),sourceWidth:item.width,sourceHeight:item.height,output:{kind:'paper',paper:'l',format:'png'}}});expect(post).toHaveBeenCalledOnce();expect(post.mock.calls[0][0].type).toBe('crop-png-ready');expect(canvas).not.toHaveBeenCalled();return post.mock.calls[0][0].file.bytes;
 }
 const actual=await print(bytes(item.file));vi.resetModules();const reference=rgb(new Uint8Array(Buffer.from(item.rgbaBase64,'base64')));expect(sha(reference)).toBe(item.rgbSha256);expect(sha(actual)).toBe(sha(await print(encode({width:item.width,height:item.height,channels:3,depth:8,data:reference}))));
});
