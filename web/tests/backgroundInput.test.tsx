import {Blob as NativeBlob} from 'node:buffer';
import {afterEach,expect,test,vi} from 'vitest';
import {encode} from 'fast-png';
import {createBackgroundInput} from '../src/background/input';
import {imageWorkGate} from '../src/imageWorkGate';
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
const png=(width=3)=>encode({width,height:1,depth:8,channels:4,data:Uint8Array.from({length:width*4},(_,i)=>i%256)});

test('real background input handler shares bounded PNG decoding and preserves hidden RGB',async()=>{
 let receive:any;const post=vi.fn(),canvas=vi.fn(()=>{throw Error('PNG must not use Canvas');});
 vi.stubGlobal('Blob',NativeBlob);vi.stubGlobal('OffscreenCanvas',canvas);
 vi.stubGlobal('self',{addEventListener:(_type:string,fn:any)=>{receive=fn;},postMessage:post});
 await import('../src/background/input.worker');
 await receive({data:{jobId:'input',type:'decode-background-photo',file:new NativeBlob([png()])}});
 const event=post.mock.calls[0][0];expect(event.type).toBe('background-photo-decoded');
 expect(event.image).toMatchObject({width:3,height:1,format:'rgb-u8'});
 expect([...new Uint8Array(event.image.data)]).toEqual([0,1,2,4,5,6,8,9,10]);expect(canvas).not.toHaveBeenCalled();
 await receive({data:{jobId:'second',type:'decode-background-photo',file:new NativeBlob([png()])}});
 expect(post.mock.calls[1][0]).toMatchObject({type:'error',code:'invalid-background-photo'});
});

test('decoder termination and shared gate release precede original-size thumbnail step',async()=>{
 vi.stubGlobal('Blob',NativeBlob);let stop!:()=>void;
 const terminate=vi.fn(()=>new Promise<void>(resolve=>{stop=resolve;}));
 class WorkerFixture{
  listeners=new Map<string,any>();
  addEventListener(type:string,fn:any){this.listeners.set(type,fn);}
  removeEventListener(type:string){this.listeners.delete(type);}
  postMessage(command:any){queueMicrotask(()=>this.listeners.get('message')?.({data:{jobId:command.jobId,type:'background-photo-decoded',image:{width:2001,height:1,format:'rgb-u8',data:new ArrayBuffer(2001*3)}}}));}
  terminate=terminate;
 }
 vi.stubGlobal('Worker',WorkerFixture);
 const resizeOriginal=vi.fn(async()=>{expect(imageWorkGate.getState().busy).toBe(false);return {width:2000,height:1,format:'rgb-u8' as const,data:new ArrayBuffer(6000)};});
 const input=createBackgroundInput({resizeOriginal});
 const pending=input.read(new NativeBlob([png(2001)]) as unknown as File,new AbortController().signal);
 await vi.waitFor(()=>expect(terminate).toHaveBeenCalledOnce());expect(resizeOriginal).not.toHaveBeenCalled();expect(imageWorkGate.getState().busy).toBe(true);
 stop();expect((await pending).width).toBe(2000);expect(resizeOriginal).toHaveBeenCalledOnce();await input.close();
});

test('aborted decoder waits for termination and never starts thumbnail work',async()=>{
 vi.stubGlobal('Blob',NativeBlob);let stop!:()=>void;
 const terminate=vi.fn(()=>new Promise<void>(resolve=>{stop=resolve;}));
 class WorkerFixture{addEventListener(){}removeEventListener(){}postMessage(){}terminate=terminate;}
 vi.stubGlobal('Worker',WorkerFixture);
 const resizeOriginal=vi.fn(),input=createBackgroundInput({resizeOriginal}),controller=new AbortController();
 const pending=input.read(new NativeBlob([png(2001)]) as unknown as File,controller.signal);
 const failed=expect(pending).rejects.toMatchObject({code:'aborted'});
 await vi.waitFor(()=>expect(imageWorkGate.getState().busy).toBe(true));controller.abort();
 expect(imageWorkGate.getState().busy).toBe(true);stop();await failed;
 expect(imageWorkGate.getState().busy).toBe(false);expect(resizeOriginal).not.toHaveBeenCalled();await input.close();
});

test('missing Worker rejects input before header reads, resize and shared admission',async()=>{
 vi.stubGlobal('Worker',undefined);const slice=vi.fn(),resizeOriginal=vi.fn(),input=createBackgroundInput({resizeOriginal});
 await expect(input.read({size:3,slice} as unknown as File,new AbortController().signal)).rejects.toMatchObject({code:'unsupported-browser'});
 expect(slice).not.toHaveBeenCalled();expect(resizeOriginal).not.toHaveBeenCalled();expect(imageWorkGate.getState().busy).toBe(false);
 await input.close();
});

test.each(['bitmap','canvas'])('background JPEG reports missing %s API before decoding',async missing=>{
 let receive:any;const post=vi.fn(),canvas=vi.fn(),bitmap=vi.fn();
 vi.stubGlobal('Blob',NativeBlob);vi.stubGlobal('OffscreenCanvas',missing==='canvas'?undefined:canvas);vi.stubGlobal('createImageBitmap',missing==='bitmap'?undefined:bitmap);
 vi.stubGlobal('self',{addEventListener:(_:string,fn:any)=>{receive=fn;},postMessage:post});await import('../src/background/input.worker');
 const header=Uint8Array.from([255,216,255,192,0,17,8,0,3,0,2,3,1,17,0,2,17,0,3,17,0,255,217]);
 await receive({data:{type:'decode-background-photo',jobId:'missing-api',file:new NativeBlob([header])}});
 expect(post).toHaveBeenCalledWith({type:'error',jobId:'missing-api',code:'unsupported-browser'});expect(canvas).not.toHaveBeenCalled();expect(bitmap).not.toHaveBeenCalled();
});

test('decoder API error reaches caller only after Worker termination and releases admission',async()=>{
 vi.stubGlobal('Blob',NativeBlob);let stop!:()=>void;const terminate=vi.fn(()=>new Promise<void>(done=>{stop=done;}));
 class WorkerFixture{
  listeners=new Map<string,any>();addEventListener(type:string,listener:any){this.listeners.set(type,listener);}removeEventListener(type:string){this.listeners.delete(type);}
  postMessage(command:any){queueMicrotask(()=>this.listeners.get('message')?.({data:{type:'error',jobId:command.jobId,code:'unsupported-browser'}}));}terminate=terminate;
 }
 vi.stubGlobal('Worker',WorkerFixture);const resizeOriginal=vi.fn(),input=createBackgroundInput({resizeOriginal});
 const header=Uint8Array.from([255,216,255,192,0,17,8,0,3,0,2,3,1,17,0,2,17,0,3,17,0,255,217]);
 const pending=input.read(new NativeBlob([header]) as unknown as File,new AbortController().signal),failed=expect(pending).rejects.toMatchObject({code:'unsupported-browser'});
 await vi.waitFor(()=>expect(terminate).toHaveBeenCalledOnce());expect(imageWorkGate.getState().busy).toBe(true);expect(resizeOriginal).not.toHaveBeenCalled();
 stop();await failed;expect(imageWorkGate.getState().busy).toBe(false);expect(imageWorkGate.getState().blocked).toBe(false);await input.close();
});

test('real unsupported interlaced low-bit PNG returns a fixed pixel-format code without a decoded image',async()=>{
 const {readFileSync}=await import('node:fs');let receive:any;const post=vi.fn();
 vi.stubGlobal('Blob',NativeBlob);vi.stubGlobal('OffscreenCanvas',undefined);vi.stubGlobal('createImageBitmap',undefined);
 vi.stubGlobal('self',{addEventListener:(_:string,fn:any)=>{receive=fn;},postMessage:post});await import('../src/background/input.worker');
 const fixtureBytes=(name:string)=>readFileSync(new URL('./fixtures/png-gray-low/'+name,import.meta.url));
 const bytes=fixtureBytes('l1-key1-9x11-adam7.png');
 await receive({data:{type:'decode-background-photo',jobId:'unsupported-pixels',file:new NativeBlob([bytes])}});
 expect(post).toHaveBeenCalledOnce();expect(post).toHaveBeenCalledWith({type:'error',jobId:'unsupported-pixels',code:'unsupported-png-format'});
});
