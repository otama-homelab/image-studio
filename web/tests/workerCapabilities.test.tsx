import {Blob as NativeBlob} from 'node:buffer';
import {afterEach,expect,test,vi} from 'vitest';
import {encode,decode} from 'fast-png';
const png=()=>encode({width:2,height:3,channels:3,depth:8,data:new Uint8Array(18).fill(120)});
// Header-only JPEG fixture: enough for dimension preflight, never a decoded photo.
const jpeg=()=>Uint8Array.from([255,216,255,192,0,17,8,0,3,0,2,3,1,17,0,2,17,0,3,17,0,255,217]);
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
async function run(bytes:Uint8Array,mode:'crop'|'original'){
 let receive:any;const post=vi.fn();vi.stubGlobal('Blob',NativeBlob);vi.stubGlobal('self',{addEventListener:(type:string,listener:any)=>{if(type==='message')receive=listener;},postMessage:post});await import('../src/export/crop.worker');
 await receive({data:{type:'crop-png',jobId:'capability-fixture',mode,file:new NativeBlob([bytes]),sourceWidth:2,sourceHeight:3,crop:{x:0,y:0,width:2,height:3},width:2,height:3,output:mode==='crop'?{kind:'crop',format:'png'}:{kind:'paper',paper:'l',format:'png'}}});expect(post).toHaveBeenCalledOnce();return post.mock.calls[0][0];
}

test('direct PNG remains usable with no Canvas, ImageData or bitmap APIs',async()=>{
 vi.stubGlobal('OffscreenCanvas',undefined);vi.stubGlobal('ImageData',undefined);vi.stubGlobal('createImageBitmap',undefined);const result=await run(png(),'original');expect(result.type).toBe('crop-png-ready');expect(decode(result.file.bytes).width).toBe(1500);
});

test('crop refuses missing Canvas before attempting image processing',async()=>{
 vi.stubGlobal('OffscreenCanvas',undefined);vi.stubGlobal('ImageData',vi.fn());const result=await run(png(),'crop');expect(result).toMatchObject({type:'error',code:'unsupported-browser'});expect(result.file).toBeUndefined();
});

test('crop refuses missing ImageData without constructing a Canvas',async()=>{
 const canvas=vi.fn();vi.stubGlobal('OffscreenCanvas',canvas);vi.stubGlobal('ImageData',undefined);expect(await run(png(),'crop')).toMatchObject({type:'error',code:'unsupported-browser'});expect(canvas).not.toHaveBeenCalled();
});

test('JPEG refuses missing bitmap API before native decode or Canvas construction',async()=>{
 const canvas=vi.fn();vi.stubGlobal('OffscreenCanvas',canvas);vi.stubGlobal('createImageBitmap',undefined);expect(await run(jpeg(),'original')).toMatchObject({type:'error',code:'unsupported-browser'});expect(canvas).not.toHaveBeenCalled();
});
