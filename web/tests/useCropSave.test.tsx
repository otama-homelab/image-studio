import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {useCropSave} from '../src/export/useCropSave';
const mocked=vi.hoisted(()=>({generate:vi.fn(),close:vi.fn(async()=>{})}));
vi.mock('../src/export/client',()=>({createCropExportClient:()=>mocked}));
beforeEach(()=>{mocked.generate.mockReset();mocked.close.mockClear();vi.stubGlobal('URL',{createObjectURL:vi.fn(()=> 'blob:prepared'),revokeObjectURL:vi.fn()});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const input={mode:'crop' as const,file:new Blob(['synthetic']),sourceWidth:400,sourceHeight:400,crop:{x:50,y:0,width:300,height:400},width:354,height:472,output:{kind:'crop' as const,format:'png' as const}};
const file={width:354,height:472,bytes:new Uint8Array([1,2,3]),mime:'image/png',filename:'image-studio-crop-300dpi.png'};
test('a key change hides the prepared file during render, before effect cleanup',async()=>{
 mocked.generate.mockResolvedValue(file);const seen:Array<{key:string;url:string|null}>=[];
 const hook=renderHook(({key})=>{const value=useCropSave(key);seen.push({key,url:value.link?.url??null});return value;},{initialProps:{key:'first'}});
 await act(async()=>{await hook.result.current.prepare(input);});expect(hook.result.current.link?.url).toBe('blob:prepared');
 hook.rerender({key:'second'});expect(seen.find(value=>value.key==='second')?.url).toBeNull();expect(hook.result.current.link).toBeNull();expect(hook.result.current.phase).toBe('stale');expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:prepared');
});
test('late generation after a setting change cannot publish a preview or download URL',async()=>{
 let finish!:(value:typeof file)=>void;mocked.generate.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const hook=renderHook(({key})=>useCropSave(key),{initialProps:{key:'first'}});let pending!:Promise<void>;
 act(()=>{pending=hook.result.current.prepare(input);});hook.rerender({key:'second'});
 await act(async()=>{finish(file);await pending;});expect(hook.result.current.link).toBeNull();expect(URL.createObjectURL).not.toHaveBeenCalled();expect(hook.result.current.busy).toBe(false);
});
test('cancellation and DPI failures provide different recovery states',async()=>{
 mocked.generate.mockImplementation((_input,signal:AbortSignal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true})));
 const hook=renderHook(()=>useCropSave('first'));let pending!:Promise<void>;act(()=>{pending=hook.result.current.prepare(input);});await act(async()=>{hook.result.current.cancel();await pending;});expect(hook.result.current.phase).toBe('cancelled');expect(hook.result.current.error).toBe('');expect(hook.result.current.link).toBeNull();
 mocked.generate.mockRejectedValue({code:'unsupported-print-dpi'});await act(async()=>{await hook.result.current.prepare(input);});expect(hook.result.current.phase).toBe('error');expect(hook.result.current.recovery).toBe('crop');expect(hook.result.current.error).toContain('300dpi');
});
test('upstream invalidation blocks download and artifact access immediately, before a rerender',async()=>{
 let valid=true;mocked.generate.mockResolvedValue(file);const hook=renderHook(()=>useCropSave('same-settings',()=>valid));await act(async()=>{await hook.result.current.prepare(input);});expect(hook.result.current.getPreparedFile()).toBe(file);
 valid=false;expect(hook.result.current.beginDownload()).toBe(false);expect(hook.result.current.getPreparedFile()).toBeNull();await act(async()=>{await hook.result.current.prepare(input);});expect(mocked.generate).toHaveBeenCalledTimes(1);expect(hook.result.current.link).toBeNull();expect(hook.result.current.error).toContain('元の画像が変更');expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:prepared');
});
test('an upstream change rejects a late export even if the local settings key has not changed',async()=>{
 let valid=true,finish!:(value:typeof file)=>void;mocked.generate.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const hook=renderHook(()=>useCropSave('same-settings',()=>valid));let pending!:Promise<void>;act(()=>{pending=hook.result.current.prepare(input);});valid=false;await act(async()=>{finish(file);await pending;});expect(hook.result.current.link).toBeNull();expect(hook.result.current.getPreparedFile()).toBeNull();expect(URL.createObjectURL).not.toHaveBeenCalled();
});
test('waitForIdle remains pending after invalidation until the old export has settled',async()=>{
 let finish!:(value:typeof file)=>void;mocked.generate.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const hook=renderHook(()=>useCropSave('same-settings'));let task!:Promise<void>;act(()=>{task=hook.result.current.prepare(input);});let settled=false;let idle!:Promise<void>;act(()=>{hook.result.current.invalidate();idle=hook.result.current.waitForIdle();void idle.then(()=>{settled=true;});});await act(async()=>{await Promise.resolve();});expect(settled).toBe(false);
 await act(async()=>{finish(file);await task;await idle;});expect(settled).toBe(true);expect(hook.result.current.link).toBeNull();expect(URL.createObjectURL).not.toHaveBeenCalled();
});
test.each([['unsupported-browser','このブラウザでは','端末情報を確認'],['crop-resize-unavailable','接続を確認','写真と設定は保持'],['crop-save-failed','接続やブラウザの設定を確認','写真と設定は保持']])('failure %s gives actionable recovery and an explicit retry with the same input',async(code,message,detail)=>{
 mocked.generate.mockRejectedValueOnce({code});const hook=renderHook(()=>useCropSave('unchanged-photo-and-settings'));await act(async()=>{await hook.result.current.prepare(input);});expect(hook.result.current.error).toContain(message);expect(hook.result.current.error).toContain(detail);expect(hook.result.current.recovery).toBe('retry');expect(hook.result.current.link).toBeNull();expect(mocked.generate).toHaveBeenCalledOnce();
 mocked.generate.mockResolvedValueOnce(file);await act(async()=>{await hook.result.current.prepare(input);});expect(mocked.generate).toHaveBeenCalledTimes(2);expect(mocked.generate.mock.calls[1][0]).toBe(input);expect(hook.result.current.error).toBe('');expect(hook.result.current.link?.url).toBe('blob:prepared');
});
test('unconfirmed cancellation is shown immediately and never presented as a successful cancel',async()=>{
 mocked.generate.mockImplementation((_input,signal:AbortSignal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject({code:'crop-save-stop-failed'}),{once:true})));
 const hook=renderHook(()=>useCropSave('same-input'));let pending!:Promise<void>;act(()=>{pending=hook.result.current.prepare(input);});await act(async()=>{hook.result.current.cancel();await pending;});expect(hook.result.current.phase).toBe('error');expect(hook.result.current.error).toContain('処理の終了を確認できませんでした');expect(hook.result.current.link).toBeNull();expect(URL.createObjectURL).not.toHaveBeenCalled();
});
