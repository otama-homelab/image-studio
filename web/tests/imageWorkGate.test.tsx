import {expect,test,vi} from 'vitest';
import {decodePreview} from '../src/decodePreview';
import {createCropExportClient} from '../src/export/client';
import {imageWorkGate} from '../src/imageWorkGate';
const header={type:'png' as const,width:4,height:4};
const input={mode:'crop' as const,file:new Blob(['fixture']),sourceWidth:4,sourceHeight:4,crop:{x:0,y:0,width:4,height:4},width:4,height:4,output:{kind:'crop' as const,format:'png' as const}};
function fixture(decode=async()=>{}){
 const image={src:'',naturalWidth:4,naturalHeight:4,decode,removeAttribute:vi.fn()};
 const imageFactory=vi.fn(()=>image as unknown as HTMLImageElement),urlApi={createObjectURL:vi.fn(()=> 'blob:fixture'),revokeObjectURL:vi.fn()};
 return {image,imageFactory,urlApi};
}

test('decode and export exclude each other until cancelled native decode or Worker termination settles',async()=>{
 let finishDecode!:()=>void,finishStop!:()=>void;const workers:FakeWorker[]=[];
 class FakeWorker extends EventTarget{request:any;constructor(){super();workers.push(this);}postMessage(value:any){this.request=value;}terminate=vi.fn(()=>new Promise<void>(resolve=>{finishStop=resolve;}));}
 vi.stubGlobal('Worker',FakeWorker);const client=createCropExportClient(),controller=new AbortController();
 try{
  const first=fixture(()=>new Promise(resolve=>{finishDecode=resolve;}));const decoding=decodePreview(input.file,header,{...first,signal:controller.signal});const aborted=expect(decoding).rejects.toThrow('preview-aborted');
  await expect(client.generate(input,new AbortController().signal)).rejects.toMatchObject({code:'crop-save-busy'});expect(workers).toHaveLength(0);controller.abort();expect(first.image.removeAttribute).toHaveBeenCalledWith('src');expect(imageWorkGate.getState().busy).toBe(true);
  await expect(client.generate(input,new AbortController().signal)).rejects.toMatchObject({code:'crop-save-busy'});finishDecode();await aborted;expect(imageWorkGate.getState().busy).toBe(false);
  const next=new AbortController(),exporting=client.generate(input,next.signal),exportAborted=expect(exporting).rejects.toMatchObject({code:'aborted'});expect(workers).toHaveLength(1);
  const waiting=fixture();await expect(decodePreview(input.file,header,{...waiting,signal:new AbortController().signal})).rejects.toThrow('preview-busy');expect(waiting.imageFactory).not.toHaveBeenCalled();expect(waiting.urlApi.createObjectURL).not.toHaveBeenCalled();
  next.abort();expect(imageWorkGate.getState().busy).toBe(true);await expect(decodePreview(input.file,header,{...waiting,signal:new AbortController().signal})).rejects.toThrow('preview-busy');expect(waiting.imageFactory).not.toHaveBeenCalled();
  workers[0].dispatchEvent(new MessageEvent('message',{data:{type:'crop-cancelled',jobId:workers[0].request.jobId}}));await Promise.resolve();finishStop();await exportAborted;expect(imageWorkGate.getState().busy).toBe(false);await expect(decodePreview(input.file,header,{...waiting,signal:new AbortController().signal})).resolves.toMatchObject({width:4,height:4});
 }finally{await client.close();vi.unstubAllGlobals();}
});

test('failed native cleanup blocks subsequent decode and export without allocating another resource',async()=>{
 const f=fixture();f.image.removeAttribute.mockImplementation(()=>{throw Error('native cleanup failed');});await expect(decodePreview(input.file,header,{...f,signal:new AbortController().signal})).rejects.toThrow('preview-cleanup-failed');expect(imageWorkGate.getState()).toMatchObject({busy:false,blocked:true});
 const next=fixture();await expect(decodePreview(input.file,header,{...next,signal:new AbortController().signal})).rejects.toThrow('preview-unavailable');expect(next.imageFactory).not.toHaveBeenCalled();
 const client=createCropExportClient();await expect(client.generate(input,new AbortController().signal)).rejects.toMatchObject({code:'crop-save-unavailable'});await client.close();
});
