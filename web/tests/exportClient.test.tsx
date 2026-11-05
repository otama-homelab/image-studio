import {expect,test,vi} from 'vitest';
import {createCropExportClient} from '../src/export/client';

test('different editor clients share one export Worker slot until termination finishes',async()=>{
 const workers:FakeWorker[]=[];let finishStop!:()=>void;
 class FakeWorker extends EventTarget{
  request:any;terminate=vi.fn(()=>new Promise<void>(resolve=>{finishStop=resolve;}));
  constructor(){super();workers.push(this);}
  postMessage(value:any){this.request=value;}
 }
 vi.stubGlobal('Worker',FakeWorker);
 const crop=createCropExportClient(),print=createCropExportClient(),controller=new AbortController();
 const input={mode:'crop' as const,file:new Blob(['fixture']),sourceWidth:4,sourceHeight:4,crop:{x:0,y:0,width:4,height:4},width:4,height:4,output:{kind:'crop' as const,format:'png' as const}};
 try{
  const pending=crop.generate(input,controller.signal);const aborted=expect(pending).rejects.toMatchObject({code:'aborted'});
  await expect(print.generate(input,new AbortController().signal)).rejects.toMatchObject({code:'crop-save-busy'});expect(workers).toHaveLength(1);
  controller.abort();await expect(print.generate(input,new AbortController().signal)).rejects.toMatchObject({code:'crop-save-busy'});expect(workers).toHaveLength(1);expect(workers[0].terminate).not.toHaveBeenCalled();
  workers[0].dispatchEvent(new MessageEvent('message',{data:{type:'crop-cancelled',jobId:workers[0].request.jobId}}));await Promise.resolve();expect(workers[0].terminate).toHaveBeenCalledOnce();
  finishStop();await aborted;
  const result=print.generate(input,new AbortController().signal),worker=workers[1];expect(workers).toHaveLength(2);
  worker.dispatchEvent(new MessageEvent('message',{data:{type:'crop-png-ready',jobId:worker.request.jobId,file:{width:4,height:4,mime:'image/png',filename:'image-studio-crop-300dpi.png',bytes:new Uint8Array([1])}}}));
  finishStop();expect((await result).filename).toBe('image-studio-crop-300dpi.png');
 }finally{await crop.close();await print.close();vi.unstubAllGlobals();}
});

test('missing Worker API is rejected before copying the input Blob',async()=>{
 vi.stubGlobal('Worker',undefined);const blob=vi.fn();vi.stubGlobal('Blob',blob);const client=createCropExportClient();
 try{await expect(client.generate({mode:'crop',file:{} as Blob,sourceWidth:4,sourceHeight:4,crop:{x:0,y:0,width:4,height:4},width:4,height:4,output:{kind:'crop',format:'png'}},new AbortController().signal)).rejects.toMatchObject({code:'unsupported-browser'});expect(blob).not.toHaveBeenCalled();}
 finally{await client.close();vi.unstubAllGlobals();}
});


test('asynchronous Worker load failure releases the slot after termination and allows retry',async()=>{
 const workers:FakeWorker[]=[];let finishStop!:()=>void;
 class FakeWorker extends EventTarget{
  request:any;terminate=vi.fn(()=>new Promise<void>(resolve=>{finishStop=resolve;}));
  constructor(){super();workers.push(this);}
  postMessage(value:any){this.request=value;}
 }
 vi.stubGlobal('Worker',FakeWorker);const client=createCropExportClient(),other=createCropExportClient();
 const input={mode:'crop' as const,file:new Blob(['fixture']),sourceWidth:4,sourceHeight:4,crop:{x:0,y:0,width:4,height:4},width:4,height:4,output:{kind:'crop' as const,format:'png' as const}};
 try{
  const pending=client.generate(input,new AbortController().signal);const failure=expect(pending).rejects.toMatchObject({code:'crop-save-failed'});
  workers[0].dispatchEvent(new Event('error'));expect(workers[0].terminate).toHaveBeenCalledOnce();
  await expect(other.generate(input,new AbortController().signal)).rejects.toMatchObject({code:'crop-save-busy'});expect(workers).toHaveLength(1);
  finishStop();await failure;expect(client.getState()).toMatchObject({busy:false,blocked:false});
  const retry=client.generate(input,new AbortController().signal),worker=workers[1];
  worker.dispatchEvent(new MessageEvent('message',{data:{type:'crop-png-ready',jobId:worker.request.jobId,file:{width:4,height:4,mime:'image/png',filename:'image-studio-crop-300dpi.png',bytes:new Uint8Array([1])}}}));
  finishStop();expect((await retry).mime).toBe('image/png');expect(workers).toHaveLength(2);expect(worker.terminate).toHaveBeenCalledOnce();
 }finally{await client.close();await other.close();vi.unstubAllGlobals();}
});
