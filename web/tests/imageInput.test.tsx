import {Blob as NativeBlob} from 'node:buffer';
import {afterEach,expect,test,vi} from 'vitest';
import {encode} from 'fast-png';
import crc32 from 'crc-32';
import {inspectImage} from '../src/imageInput';

// Only a dimension declaration: IDAT still describes 2x3, so never decode this as pixels.
function pngHeader(width:number,height:number){
 const bytes=encode({width:2,height:3,channels:3,depth:8,data:new Uint8Array(18)});
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 view.setUint32(16,width);view.setUint32(20,height);view.setUint32(29,crc32.buf(bytes.subarray(12,29))>>>0);
 return bytes;
}
afterEach(()=>{vi.unstubAllGlobals();vi.doUnmock('pdf-lib');vi.resetModules();});

test('PNG header admission agrees with the decoder axis and pixel limits in both directions',async()=>{
 for(const [width,height] of [[2000,2000],[4096,1],[1,4096]])expect(await inspectImage(new NativeBlob([pngHeader(width,height)]) as unknown as Blob)).toMatchObject({type:'png',width,height});
 for(const [width,height] of [[2001,2000],[2000,2001],[4097,1],[1,4097]])await expect(inspectImage(new NativeBlob([pngHeader(width,height)]) as unknown as Blob)).rejects.toThrow('png-dimensions-too-large');
});

test('declared MIME does not bypass PNG limits and larger JPEG dimensions retain their separate admission',async()=>{
 await expect(inspectImage(new NativeBlob([pngHeader(3000,2000)],{type:'image/jpeg'}) as unknown as Blob)).rejects.toThrow('png-dimensions-too-large');
 const jpeg=Uint8Array.from([255,216,255,192,0,17,8,0,2,19,136,3,1,17,0,2,17,0,3,17,0,255,217]);
 expect(await inspectImage(new NativeBlob([jpeg],{type:'image/png'}) as unknown as Blob)).toMatchObject({type:'jpeg',width:5000,height:2});
});

test('oversized PNG reads only the bounded prefix and rejects before a full-file read',async()=>{
 const bytes=pngHeader(3000,2000),prefix=vi.fn(()=>new NativeBlob([bytes]));
 const full=vi.fn(()=>{throw Error('full pixel source must not be read');});
 const file={size:1024*1024,slice:prefix,arrayBuffer:full} as unknown as Blob;
 await expect(inspectImage(file)).rejects.toThrow('png-dimensions-too-large');
 expect(prefix).toHaveBeenCalledExactlyOnceWith(0,256*1024);expect(full).not.toHaveBeenCalled();
});

test('Worker rechecks PNG limits before PDF dependency, full pixel read and Canvas allocation',async()=>{
 const loadPdf=vi.fn(()=>{throw Error('optional PDF module must not load');});vi.doMock('pdf-lib',loadPdf);
 const canvas=vi.fn();vi.stubGlobal('OffscreenCanvas',canvas);vi.stubGlobal('Blob',NativeBlob);
 class HeaderOnlyBlob extends NativeBlob{override arrayBuffer():Promise<ArrayBuffer>{throw Error('full pixel source must not be read');}}
 const file=new HeaderOnlyBlob([pngHeader(3000,2000)]),full=vi.spyOn(file,'arrayBuffer');
 let receive:any;const post=vi.fn();vi.stubGlobal('self',{addEventListener:(_type:string,listener:any)=>{receive=listener;},postMessage:post});await import('../src/export/crop.worker');
 await receive({data:{type:'crop-png',jobId:'large-png',mode:'original',file,sourceWidth:3000,sourceHeight:2000,output:{kind:'paper',paper:'l',format:'pdf'}}});
 expect(post).toHaveBeenCalledExactlyOnceWith({type:'error',jobId:'large-png',code:'png-dimensions-too-large'});
 expect(full).not.toHaveBeenCalled();expect(canvas).not.toHaveBeenCalled();expect(loadPdf).not.toHaveBeenCalled();
});
