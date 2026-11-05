import {Blob as NativeBlob} from 'node:buffer';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {afterEach,expect,test,vi} from 'vitest';
import {encode,convertIndexedToRgb} from 'fast-png';
import PngDecoder from 'fast-png-decoder';
import {readKeyword} from 'fast-png-keyword';
import {unzlibSync} from 'fflate';
import adler32 from 'pako-adler32';
import {createBoundedPngDecode} from '../../tools/browser-library-adapter/bounded-png-decode.mjs';
import {createPngInput} from '../../tools/browser-library-adapter/png-input.mjs';
import {inspectImage} from '../src/imageInput';
import fixtures from './fixtures/png-gray16/manifest.json';
const decode=createBoundedPngDecode({PngDecoder,readKeyword,unzlibSync,adler32});
const read=createPngInput({inspect:inspectImage,decode,expandIndexed:convertIndexedToRgb});
const bytes=(name:string)=>new Uint8Array(readFileSync(new URL('./fixtures/png-gray16/'+name,import.meta.url)));
const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
const rgb=(rgba:Uint8Array)=>rgba.filter((_,index)=>index%4!==3);
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
test.each(fixtures.fixtures)('gray16 $mode $width x $height interlace=$interlace matches equivalent truecolor16',async item=>{
 const input=bytes(item.file);expect(sha(input)).toBe(item.sha256);const raw=decode(input);expect(Array.from(raw.data)).toEqual(item.samples);
 const image=await read(new NativeBlob([input])),expected=new Uint8Array(Buffer.from(item.rgbaBase64,'base64'));expect(image.format).toBe(item.mode==='L'?'rgb-u8':'rgba-u8');const output=new Uint8Array(image.data);expect(output).toEqual(item.mode==='L'?rgb(expected):expected);expect(sha(image.format==='rgb-u8'?output:rgb(output))).toBe(item.rgbSha256);
});
test('gray16 deliberately avoids Pillow I;16 white clipping while gray-alpha retains its existing conversion',()=>{
 for(const item of fixtures.fixtures)if(item.mode==='LA')expect(item.originalPillowRgbSha256).toBe(item.rgbSha256);else expect(item.originalPillowRgbSha256).not.toBe(item.rgbSha256);
});
test('full-precision transparency distinguishes256 from257 although their8bit gray values are equal',async()=>{
 const item=fixtures.fixtures.find(item=>item.mode==='L-tRNS'&&item.width===3)!;const image=await read(new NativeBlob([bytes(item.file)])),output=new Uint8Array(image.data);
 expect(Array.from(output.subarray(3*4,4*4))).toEqual([1,1,1,255]);expect(Array.from(output.subarray(4*4,5*4))).toEqual([1,1,1,0]);
});
test('gray16 rejects malformed transparency/forged types instead of truncating a key',async()=>{
 const file=new NativeBlob(['fixture']),inspect=async()=>({width:1,height:1,type:'png',fileBytes:file.size});
 for(const transparency of [new Uint16Array([]),new Uint16Array([1,257]),new Uint8Array([1])])await expect(createPngInput({inspect,decode:()=>({width:1,height:1,depth:16,channels:1,data:new Uint16Array([257]),transparency})})(file)).rejects.toMatchObject({code:'png-pixels-unsupported'});
 await expect(createPngInput({inspect,decode:()=>({width:1,height:1,depth:16,channels:1,data:new Uint8Array([1])})})(file)).rejects.toMatchObject({code:'png-pixels-unsupported'});
});
test.each(['L','L-tRNS'])('actual direct-print %s gray16 equals the tone-preserving RGB reference without Canvas',async mode=>{
 const item=fixtures.fixtures.find(item=>item.mode===mode&&item.width===3)!;
 async function print(input:Uint8Array){
  let receive:any;const post=vi.fn(),canvas=vi.fn(()=>{throw Error('No Canvas for direct PNG');});vi.stubGlobal('Blob',NativeBlob);vi.stubGlobal('OffscreenCanvas',canvas);vi.stubGlobal('self',{addEventListener:(_type:string,listener:any)=>{receive=listener;},postMessage:post});await import('../src/export/crop.worker');
  await receive({data:{type:'crop-png',jobId:'gray16',mode:'original',file:new NativeBlob([input]),sourceWidth:item.width,sourceHeight:item.height,output:{kind:'paper',paper:'l',format:'png'}}});expect(post).toHaveBeenCalledOnce();expect(post.mock.calls[0][0].type).toBe('crop-png-ready');expect(canvas).not.toHaveBeenCalled();return post.mock.calls[0][0].file.bytes;
 }
 const actual=await print(bytes(item.file));vi.resetModules();const reference=rgb(new Uint8Array(Buffer.from(item.rgbaBase64,'base64')));expect(sha(reference)).toBe(item.rgbSha256);expect(sha(actual)).toBe(sha(await print(encode({width:item.width,height:item.height,channels:3,depth:8,data:reference}))));
});
