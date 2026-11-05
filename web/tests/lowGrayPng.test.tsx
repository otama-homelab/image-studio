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
import fixtures from './fixtures/png-gray-low/manifest.json';
const decode=createBoundedPngDecode({PngDecoder,readKeyword,unzlibSync,adler32});
const read=createPngInput({inspect:inspectImage,decode,expandIndexed:convertIndexedToRgb});
const bytes=(name:string)=>new Uint8Array(readFileSync(new URL('./fixtures/png-gray-low/'+name,import.meta.url)));
const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
const rgb=(rgba:Uint8Array)=>rgba.filter((_,index)=>index%4!==3);
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
test.each(fixtures.fixtures)('packed gray$depth $width x $height key=$keyed interlace=$interlace',async item=>{
 const input=bytes(item.file);expect(sha(input)).toBe(item.sha256);
 if(item.interlace){const inflate=vi.fn(unzlibSync),bounded=createBoundedPngDecode({PngDecoder,readKeyword,unzlibSync:inflate,adler32});expect(()=>bounded(input)).toThrow('unsupported-png-input');expect(inflate).not.toHaveBeenCalled();await expect(read(new NativeBlob([input]))).rejects.toMatchObject({code:'png-pixels-unsupported'});return;}
 const expected=new Uint8Array(Buffer.from(item.rgbaBase64,'base64')),image=await read(new NativeBlob([input])),output=new Uint8Array(image.data);expect(image.format).toBe(item.keyed?'rgba-u8':'rgb-u8');expect(output).toEqual(item.keyed?expected:rgb(expected));expect(sha(item.keyed?rgb(output):output)).toBe(item.rgbSha256);
});
test('low-bit gray rejects malformed/out-of-range raw transparency keys',async()=>{
 const file=new NativeBlob(['fixture']),inspect=async()=>({width:1,height:1,type:'png',fileBytes:file.size});
 for(const transparency of [new Uint16Array([]),new Uint16Array([1,2]),new Uint16Array([4]),new Uint8Array([1])])await expect(createPngInput({inspect,expandIndexed:convertIndexedToRgb,decode:()=>({width:1,height:1,depth:2,channels:1,data:new Uint8Array([0]),transparency})})(file)).rejects.toMatchObject({code:'png-pixels-unsupported'});
});
test.each([1,2,4])('actual direct-print gray%d with transparency matches independent RGB without Canvas',async depth=>{
 const item=fixtures.fixtures.find(item=>item.depth===depth&&item.keyed&&item.width===3&&!item.interlace)!;
 async function print(input:Uint8Array){
  let receive:any;const post=vi.fn(),canvas=vi.fn(()=>{throw Error('No Canvas for direct PNG');});vi.stubGlobal('Blob',NativeBlob);vi.stubGlobal('OffscreenCanvas',canvas);vi.stubGlobal('self',{addEventListener:(_type:string,listener:any)=>{receive=listener;},postMessage:post});await import('../src/export/crop.worker');
  await receive({data:{type:'crop-png',jobId:'gray-low',mode:'original',file:new NativeBlob([input]),sourceWidth:item.width,sourceHeight:item.height,output:{kind:'paper',paper:'l',format:'png'}}});expect(post).toHaveBeenCalledOnce();expect(post.mock.calls[0][0].type).toBe('crop-png-ready');expect(canvas).not.toHaveBeenCalled();return post.mock.calls[0][0].file.bytes;
 }
 const actual=await print(bytes(item.file));vi.resetModules();const reference=rgb(new Uint8Array(Buffer.from(item.rgbaBase64,'base64')));expect(sha(reference)).toBe(item.rgbSha256);expect(sha(actual)).toBe(sha(await print(encode({width:item.width,height:item.height,channels:3,depth:8,data:reference}))));
});
