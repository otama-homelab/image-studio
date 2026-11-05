import {Blob as NativeBlob} from 'node:buffer';
import {afterEach,expect,test,vi} from 'vitest';
import {encode} from 'fast-png';
vi.mock('pdf-lib',()=>{throw Error('synthetic module load failure with private details');});
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
async function run(format:'png'|'pdf'){
 let receive:any;const post=vi.fn(),canvas=vi.fn(()=>{throw Error('No Canvas for direct PNG');});const file=new NativeBlob([encode({width:2,height:3,channels:3,depth:8,data:new Uint8Array(18)})]);const fullRead=vi.spyOn(file,'arrayBuffer');
 vi.stubGlobal('Blob',NativeBlob);vi.stubGlobal('OffscreenCanvas',canvas);vi.stubGlobal('self',{addEventListener:(type:string,listener:any)=>{if(type==='message')receive=listener;},postMessage:post});await import('../src/export/crop.worker');
 await receive({data:{type:'crop-png',jobId:'module-failure-fixture',mode:'original',file,sourceWidth:2,sourceHeight:3,output:{kind:'paper',paper:'l',format}}});expect(post).toHaveBeenCalledOnce();expect(canvas).not.toHaveBeenCalled();return {event:post.mock.calls[0][0],fullRead};
}
test('PDF import failure returns a fixed error before full pixel input is read',async()=>{
 const result=await run('pdf');expect(result.event).toEqual({type:'error',jobId:'module-failure-fixture',code:'pdf-module-unavailable'});expect(result.fullRead).not.toHaveBeenCalled();
});
test('PNG creation succeeds without importing an unavailable PDF module',async()=>{
 const result=await run('png');expect(result.event).toMatchObject({type:'crop-png-ready',file:{mime:'image/png',filename:'image-studio-paper-l-300dpi.png'}});expect(result.fullRead).toHaveBeenCalledOnce();
});
