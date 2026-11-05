import {Blob as NativeBlob} from 'node:buffer';
import {createHash} from 'node:crypto';
import {afterEach,expect,test,vi} from 'vitest';
import {encode,decode as upstreamDecode,convertIndexedToRgb} from 'fast-png';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import lowBitFixtures from './fixtures/png-indexed/manifest.json';
import {imageDimensionsFromData} from 'image-dimensions';
import crc32 from 'crc-32';
import PngDecoder from 'fast-png-decoder';
import {readKeyword} from 'fast-png-keyword';
import {unzlibSync} from 'fflate';
import adler32 from 'pako-adler32';
import {createBoundedPngDecode} from '../../tools/browser-library-adapter/bounded-png-decode.mjs';
import {createPngInput} from '../../tools/browser-library-adapter/png-input.mjs';
import {createImagePreflight} from '../../tools/browser-library-adapter/image-preflight.mjs';
const palette=[[17,33,49],[61,77,93],[111,127,143]],indices=Uint8Array.from([0,1,2,2,1,0]),alpha=[255,0,128];
const rgba=Uint8Array.from(Array.from(indices).flatMap(index=>[...palette[index],alpha[index]]));
function fixture(transparent=true){
 const bytes=encode({width:3,height:2,channels:1,depth:8,palette,data:indices});if(!transparent)return bytes;
 // Fixture-only tRNS chunk: explicit alpha order, including opaque before transparent.
 const chunk=new Uint8Array(15),view=new DataView(chunk.buffer);view.setUint32(0,3);chunk.set([116,82,78,83],4);chunk.set(alpha,8);view.setUint32(11,crc32.buf(chunk.subarray(4,11))>>>0);
 const at=33+12+palette.length*3,result=new Uint8Array(bytes.length+chunk.length);result.set(bytes.subarray(0,at));result.set(chunk,at);result.set(bytes.subarray(at),at+chunk.length);return result;
}
const inspect=createImagePreflight({probe:imageDimensionsFromData,maxAxis:4096,maxPixels:4_000_000});
const decode=createBoundedPngDecode({PngDecoder,readKeyword,unzlibSync,adler32});
const read=createPngInput({inspect,decode,expandIndexed:convertIndexedToRgb});
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});

test('existing bounded decoder and public palette expansion preserve every RGB/alpha including hidden colors',async()=>{
 const image=await read(new NativeBlob([fixture()]));expect(image.format).toBe('rgba-u8');expect(new Uint8Array(image.data)).toEqual(rgba);expect([image.width,image.height]).toEqual([3,2]);
 const opaque=await read(new NativeBlob([fixture(false)]));expect(opaque.format).toBe('rgb-u8');expect(new Uint8Array(opaque.data)).toEqual(Uint8Array.from(Array.from(indices).flatMap(index=>palette[index])));
});

test('truecolor with an optional suggested palette stays truecolor',async()=>{
 const rgb=Uint8Array.from([7,8,9]);const image=await read(new NativeBlob([encode({width:1,height:1,channels:3,depth:8,palette,data:rgb})]));expect(image.format).toBe('rgb-u8');expect(new Uint8Array(image.data)).toEqual(rgb);
});

test('invalid palette indexes fail with a fixed input error and indexed CRC cannot be bypassed',async()=>{
 const invalid=encode({width:1,height:1,channels:1,depth:8,palette,data:new Uint8Array([99])});await expect(read(new NativeBlob([invalid]))).rejects.toMatchObject({code:'png-pixels-unsupported'});
 const broken=fixture();broken[33+8]^=1;expect(()=>decode(broken,{checkCrc:false})).toThrow();
});

async function run(bytes:Uint8Array){
 let receive:any;const post=vi.fn(),canvas=vi.fn(()=>{throw Error('No Canvas for direct PNG');});vi.stubGlobal('Blob',NativeBlob);vi.stubGlobal('OffscreenCanvas',canvas);vi.stubGlobal('self',{addEventListener:(type:string,listener:any)=>{if(type==='message')receive=listener;},postMessage:post});await import('../src/export/crop.worker');
 const dimensions=imageDimensionsFromData(bytes)!;await receive({data:{type:'crop-png',jobId:'palette-fixture',mode:'original',file:new NativeBlob([bytes]),sourceWidth:dimensions.width,sourceHeight:dimensions.height,output:{kind:'paper',paper:'l',format:'png'}}});expect(post).toHaveBeenCalledOnce();expect(canvas).not.toHaveBeenCalled();return post.mock.calls[0][0];
}
test('actual direct-print handler produces the same paper PNG for indexed and equivalent RGBA input without Canvas',async()=>{
 const indexed=await run(fixture());expect(indexed.type).toBe('crop-png-ready');vi.resetModules();const reference=await run(encode({width:3,height:2,channels:4,depth:8,data:rgba}));expect(reference.type).toBe('crop-png-ready');
 const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');expect(sha(indexed.file.bytes)).toBe(sha(reference.file.bytes));
});

test('indexed inputs retain dimension admission and exact inflated-byte limits',()=>{
 const large=encode({width:128,height:128,channels:1,depth:8,palette,data:new Uint8Array(128*128)}),forged=Uint8Array.from(large),view=new DataView(forged.buffer);view.setUint32(16,1);view.setUint32(20,1);view.setUint32(29,crc32.buf(forged.subarray(12,29))>>>0);expect(()=>decode(forged)).toThrow();
 const oversized=Uint8Array.from(fixture(false)),header=new DataView(oversized.buffer);header.setUint32(16,4097);header.setUint32(29,crc32.buf(oversized.subarray(12,29))>>>0);const inflate=vi.fn(unzlibSync),bounded=createBoundedPngDecode({PngDecoder,readKeyword,unzlibSync:inflate,adler32});expect(()=>bounded(oversized)).toThrow('unsupported-png-input');expect(inflate).not.toHaveBeenCalled();
});

test('8-bit indexed Adam7 input expands to the expected pixels across every pass',async()=>{
 const data=Uint8Array.from({length:9*11},(_,index)=>(index%9+2*Math.floor(index/9))%palette.length);const bytes=encode({width:9,height:11,channels:1,depth:8,palette,data},{interlace:'Adam7'});expect(bytes[28]).toBe(1);
 const image=await read(new NativeBlob([bytes]));expect([image.width,image.height,image.format]).toEqual([9,11,'rgb-u8']);expect(new Uint8Array(image.data)).toEqual(Uint8Array.from(Array.from(data).flatMap(index=>palette[index])));
});


const independentFixtures=lowBitFixtures.fixtures;
const fixtureDirectory=join(dirname(fileURLToPath(import.meta.url)),'fixtures','png-indexed');
const fixtureBytes=(name:string)=>new Uint8Array(readFileSync(join(fixtureDirectory,name)));
test.each(independentFixtures.filter(item=>item.interlace===0))('independent Pillow packed $depth-bit $width x $height matches every pixel and hidden RGB',async item=>{
 const bytes=fixtureBytes(item.file),sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');expect(sha(bytes)).toBe(item.sha256);
 const image=await read(new NativeBlob([bytes]));expect(image.format).toBe('rgba-u8');const data=new Uint8Array(image.data);expect(data).toEqual(Uint8Array.from(Buffer.from(item.rgbaBase64,'base64')));expect(sha(data.filter((_,index)=>index%4!==3))).toBe(item.rgbSha256);
});
test.each(independentFixtures.filter(item=>item.interlace===1))('packed Adam7 $depth-bit is rejected before inflation rather than silently misdecoded',async item=>{
 const bytes=fixtureBytes(item.file),inflate=vi.fn(unzlibSync),bounded=createBoundedPngDecode({PngDecoder,readKeyword,unzlibSync:inflate,adler32});expect(()=>bounded(bytes)).toThrow('unsupported-png-input');expect(inflate).not.toHaveBeenCalled();await expect(read(new NativeBlob([bytes]))).rejects.toMatchObject({code:'png-pixels-unsupported'});
 let upstreamMatches=false;try{const result=convertIndexedToRgb(upstreamDecode(bytes,{checkCrc:true}));upstreamMatches=Buffer.from(result).equals(Buffer.from(item.rgbaBase64,'base64'));}catch{/* Independent tiny counterexample: upstream may reject or yield incorrect data. */}expect(upstreamMatches).toBe(false);
});
test('packed palettes cannot contain more entries than the declared bit depth',async()=>{
 const bytes=encode({width:1,height:1,channels:1,depth:1,palette,data:new Uint8Array([0])});await expect(read(new NativeBlob([bytes]))).rejects.toMatchObject({code:'png-pixels-unsupported'});
});


test.each(independentFixtures.filter(item=>item.interlace===1))('actual handler reports unsupported PNG format for packed Adam7 $depth-bit',async item=>{
 const result=await run(fixtureBytes(item.file));expect(result).toMatchObject({type:'error',code:'unsupported-png-format'});expect(result.file).toBeUndefined();
});
