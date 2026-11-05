// @vitest-environment node
import {Blob as NativeBlob} from 'node:buffer';
import {createHash,webcrypto} from 'node:crypto';
import {afterEach,expect,test,vi} from 'vitest';
import {encode,decode} from 'fast-png';
const hooks=vi.hoisted(()=>({resize:vi.fn(),close:vi.fn(),create:vi.fn()}));
vi.mock('../../tools/browser-library-adapter/pillow-resize-runtime.mjs',()=>({createPillowResizeRuntime:hooks.create}));
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();vi.clearAllMocks();});
async function run(corrupt=false,cancelDuringResize=false){
 const bytes=new Uint8Array([1,2,3]),url='https://assets.example/crop.wasm';
 vi.stubGlobal('__CROP_RESIZE__',{url,bytes:3,sha256:createHash('sha256').update(bytes).digest('hex')});
 vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('Blob',NativeBlob);vi.stubGlobal('OffscreenCanvas',undefined);vi.stubGlobal('ImageData',undefined);
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(corrupt?new Uint8Array([1,2,4]):bytes)));
 hooks.create.mockResolvedValue({resize:hooks.resize,close:hooks.close});hooks.resize.mockImplementation((image:any,options:any)=>{if(cancelDuringResize)void receive({data:{type:'cancel-crop',jobId:'crop'}});return {width:options.width,height:options.height,format:'rgb-u8',data:Uint8Array.from([11,22,33]).buffer};});
 let receive:any;const post=vi.fn();vi.stubGlobal('self',{addEventListener:(_:string,fn:any)=>receive=fn,postMessage:post});await import('../src/export/crop.worker');
 const png=encode({width:2,height:1,channels:4,depth:8,data:new Uint8Array([11,22,33,0,44,55,66,255])});
 await receive({data:{type:'crop-png',jobId:'crop',mode:'crop',file:new NativeBlob([png]),sourceWidth:2,sourceHeight:1,width:1,height:1,crop:{x:.25,y:0,width:1.5,height:1},output:{kind:'crop',format:'png'}}});
 return post.mock.calls[0][0];
}
test('configured crop verifies asset and sends hidden RGB/fractional box through existing worker without Canvas',async()=>{
 const result=await run();expect(result.type).toBe('crop-png-ready');expect(Array.from(decode(result.file.bytes).data)).toEqual([11,22,33]);
 const [image,options]=hooks.resize.mock.calls[0];expect(Array.from(new Uint8Array(image.data))).toEqual([11,22,33,44,55,66]);expect(options).toEqual({width:1,height:1,box:[.25,0,1.75,1]});expect(hooks.close).toHaveBeenCalledOnce();
});
test('corrupt asset cannot instantiate runtime or emit a PNG',async()=>{expect(await run(true)).toMatchObject({type:'error',code:'crop-resize-unavailable'});expect(hooks.create).not.toHaveBeenCalled();expect(hooks.resize).not.toHaveBeenCalled();});

test('cancel acknowledgement is sent only after resize ownership is released, with no PNG',async()=>{const result=await run(false,true);expect(result).toEqual({type:'crop-cancelled',jobId:'crop'});expect(hooks.resize).toHaveBeenCalledOnce();expect(hooks.close).toHaveBeenCalledOnce();});
