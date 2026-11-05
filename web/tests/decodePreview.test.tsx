import {createWorkerGate} from '../../tools/browser-library-adapter/worker-gate.mjs';
import {expect,test,vi} from 'vitest';
import {decodePreview} from '../src/decodePreview';
const header={type:'png' as const,width:400,height:300};
function fixture(decode=async()=>{}){
 const image={src:'',naturalWidth:400,naturalHeight:300,decode,removeAttribute:vi.fn()};
 const urlApi={createObjectURL:vi.fn(()=> 'blob:candidate'),revokeObjectURL:vi.fn()};
 return {image,urlApi,options:{gate:createWorkerGate(),signal:new AbortController().signal,imageFactory:()=>image as unknown as HTMLImageElement,urlApi}};
}
test('successful native decode passes its local URL to the owner and removes the temporary image source',async()=>{
 const f=fixture(),controller=new AbortController();f.options.signal=controller.signal;
 expect(await decodePreview(new Blob(['synthetic']),header,f.options)).toEqual({url:'blob:candidate',width:400,height:300});expect(f.urlApi.revokeObjectURL).not.toHaveBeenCalled();expect(f.image.removeAttribute).toHaveBeenCalledWith('src');const count=f.image.removeAttribute.mock.calls.length;controller.abort();expect(f.image.removeAttribute).toHaveBeenCalledTimes(count);
});
test('native failure and unexpected dimensions release only the candidate URL and redact native errors',async()=>{
 const f=fixture(async()=>{throw Error('private-file-name and native details');});await expect(decodePreview(new Blob(['bad']),header,f.options)).rejects.toThrow(/^preview-decode-failed$/);expect(f.urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:candidate');
 const wrong=fixture();wrong.image.naturalWidth=401;await expect(decodePreview(new Blob(['wrong']),header,wrong.options)).rejects.toThrow('preview-decode-failed');expect(wrong.urlApi.revokeObjectURL).toHaveBeenCalledOnce();
});
test('abort removes the image source but waits for the decoder promise to finish before settling',async()=>{
 let reject!:(error:Error)=>void;const f=fixture(()=>new Promise((_resolve,no)=>{reject=no;})),controller=new AbortController();f.options.signal=controller.signal;
 let settled=false;const pending=decodePreview(new Blob(['synthetic']),header,f.options);void pending.catch(()=>{settled=true;});controller.abort();await Promise.resolve();expect(settled).toBe(false);expect(f.image.removeAttribute).toHaveBeenCalledWith('src');reject(Error('native abort'));
 await expect(pending).rejects.toThrow('preview-aborted');expect(f.urlApi.revokeObjectURL).toHaveBeenCalledOnce();
 const already=fixture();const stopped=new AbortController();stopped.abort();already.options.signal=stopped.signal;await expect(decodePreview(new Blob(['not-read']),header,already.options)).rejects.toThrow('preview-aborted');expect(already.urlApi.createObjectURL).not.toHaveBeenCalled();
});
test('JPEG oriented dimensions may swap axes; PNG does not silently accept a size mismatch',async()=>{
 const jpeg=fixture();expect(await decodePreview(new Blob(['jpeg']),{type:'jpeg',width:300,height:400},jpeg.options)).toMatchObject({width:400,height:300});
 const png=fixture();await expect(decodePreview(new Blob(['png']),{type:'png',width:300,height:400},png.options)).rejects.toThrow('preview-decode-failed');expect(png.urlApi.revokeObjectURL).toHaveBeenCalledOnce();
});
test('cleanup failure cannot return a candidate with a revoked URL',async()=>{
 const f=fixture();f.image.removeAttribute.mockImplementation(()=>{throw Error('native cleanup failed');});await expect(decodePreview(new Blob(['synthetic']),header,f.options)).rejects.toThrow('preview-cleanup-failed');expect(f.urlApi.revokeObjectURL).toHaveBeenCalledOnce();
});

test('separate editor callers wait for the previous native decoder and aborted waiters allocate nothing',async()=>{
 let release!:()=>void;const first=fixture(()=>new Promise(resolve=>{release=resolve;})),second=fixture(),third=fixture(),controller=new AbortController();second.options.signal=controller.signal;
 const one=decodePreview(new Blob(['one']),header,first.options),two=decodePreview(new Blob(['two']),header,second.options),three=decodePreview(new Blob(['three']),header,third.options);const rejected=expect(two).rejects.toThrow('preview-aborted');
 expect(first.urlApi.createObjectURL).toHaveBeenCalledOnce();expect(second.urlApi.createObjectURL).not.toHaveBeenCalled();expect(third.urlApi.createObjectURL).not.toHaveBeenCalled();controller.abort();release();await one;await rejected;await three;expect(second.urlApi.createObjectURL).not.toHaveBeenCalled();expect(third.urlApi.createObjectURL).toHaveBeenCalledOnce();
});
