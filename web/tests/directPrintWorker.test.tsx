import {Blob as NativeBlob} from 'node:buffer';
import {afterEach,expect,test,vi} from 'vitest';
import {encode,decode} from 'fast-png';
import crc32 from 'crc-32';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {PDFDocument,PDFDict,PDFName,PDFNumber,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {paperLayout} from '../../tools/browser-library-adapter/print-geometry.mjs';

function png(dpi?:number,duplicate=false){
 const original=encode({width:2,height:3,channels:4,depth:8,data:Uint8Array.from([11,22,33,0,44,55,66,255,77,88,99,128,111,122,133,255,144,155,166,0,177,188,199,255])});
 if(dpi===undefined)return original;
 const chunk=new Uint8Array(21),view=new DataView(chunk.buffer);view.setUint32(0,9);chunk.set([112,72,89,115],4);view.setUint32(8,Math.round(dpi/.0254));view.setUint32(12,Math.round(dpi/.0254));chunk[16]=1;view.setUint32(17,crc32.buf(chunk.subarray(4,17))>>>0);
 const copies=duplicate?2:1,result=new Uint8Array(original.length+copies*chunk.length);result.set(original.subarray(0,33));for(let i=0;i<copies;i++)result.set(chunk,33+i*chunk.length);result.set(original.subarray(33),33+copies*chunk.length);return result;
}
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
async function run(bytes:Uint8Array,format:'png'|'pdf'='png'){
 let receive:any;const post=vi.fn(),canvas=vi.fn(()=>{throw Error('Direct PNG must not use Canvas');});
 vi.stubGlobal('Blob',NativeBlob);vi.stubGlobal('OffscreenCanvas',canvas);vi.stubGlobal('self',{addEventListener:(type:string,listener:any)=>{if(type==='message')receive=listener;},postMessage:post});
 await import('../src/export/crop.worker');
 await receive({data:{type:'crop-png',jobId:'synthetic-print',mode:'original',file:new NativeBlob([bytes],{type:'image/png'}),sourceWidth:2,sourceHeight:3,output:{kind:'paper',paper:'l',format}}});
 expect(post).toHaveBeenCalledOnce();expect(canvas).not.toHaveBeenCalled();return post.mock.calls[0][0];
}
test.each([undefined,300])('actual worker handler copies original RGB to PNG paper without Canvas, dpi=%s',async dpi=>{
 const result=await run(png(dpi));expect(result.type).toBe('crop-png-ready');
 const image=decode(result.file.bytes,{checkCrc:true}),layout=paperLayout({paper:'l',photoWidth:2,photoHeight:3,dpi:null});expect([image.width,image.height]).toEqual([1500,1051]);expect(image.resolution).toEqual({x:11811,y:11811,unit:1});
 const expected=[11,22,33,44,55,66,77,88,99,111,122,133,144,155,166,177,188,199];
 for(const [x,y] of layout.positions)for(let row=0;row<3;row++){const at=((y+row)*image.width+x)*3;expect(Array.from(image.data.subarray(at,at+6))).toEqual(expected.slice(row*6,row*6+6));}
 expect(Array.from(image.data.subarray(0,3))).toEqual([255,255,255]);expect(result.file.filename).toBe('image-studio-paper-l-300dpi.png');
});
test('actual worker rejects non-300 DPI and duplicate PNG density without a result file',async()=>{
 expect(await run(png(72))).toMatchObject({type:'error',code:'unsupported-print-dpi'});
 vi.resetModules();expect(await run(png(300,true))).toMatchObject({type:'error',code:'crop-encode-failed'});
});


test('actual direct-print PDF embeds the same RGB paper pixels once at the correct physical page size',async()=>{
 const source=png(300),pngResult=await run(source);expect(pngResult.type).toBe('crop-png-ready');
 const reference=decode(pngResult.file.bytes,{checkCrc:true});vi.resetModules();
 const result=await run(source,'pdf');expect(result).toMatchObject({type:'crop-png-ready',file:{mime:'application/pdf',filename:'image-studio-paper-l.pdf',width:1500,height:1051}});
 const document=await PDFDocument.load(result.file.bytes,{updateMetadata:false});expect(document.getPageCount()).toBe(1);
 const page=document.getPage(0),width=1500*72/300,height=1051*72/300;expect(page.getSize()).toEqual({width,height});
 const images=page.node.Resources()!.lookup(PDFName.of('XObject'),PDFDict).entries();expect(images).toHaveLength(1);
 const image=document.context.lookup(images[0][1],PDFRawStream);
 expect(image.dict.lookup(PDFName.of('Subtype'),PDFName).asString()).toBe('/Image');expect(image.dict.lookup(PDFName.of('Width'),PDFNumber).asNumber()).toBe(1500);expect(image.dict.lookup(PDFName.of('Height'),PDFNumber).asNumber()).toBe(1051);
 expect(image.dict.lookup(PDFName.of('ColorSpace'),PDFName).asString()).toBe('/DeviceRGB');expect(image.dict.lookup(PDFName.of('BitsPerComponent'),PDFNumber).asNumber()).toBe(8);expect(image.dict.has(PDFName.of('SMask'))).toBe(false);
 const rgb=decodePDFRawStream(image).getBytes();expect(rgb.byteLength).toBe(1500*1051*3);
 const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');expect(sha(rgb)).toBe(sha(new Uint8Array(reference.data.buffer,reference.data.byteOffset,reference.data.byteLength)));
 const contents=page.node.Contents()!;const operations=decodePDFRawStream(contents.lookup(0,PDFRawStream)).getBytes();expect(new TextDecoder().decode(operations)).toContain(`${width} 0 0 ${height} 0 0 cm`);
 const evidenceDirectory=process.env.IMAGE_STUDIO_PDF_EVIDENCE_DIR;
 if(evidenceDirectory){
  await mkdir(evidenceDirectory,{recursive:true,mode:0o700});
  await writeFile(join(evidenceDirectory,'source-fixture.png'),source,{mode:0o600});
  await writeFile(join(evidenceDirectory,'paper-l.png'),pngResult.file.bytes,{mode:0o600});
  await writeFile(join(evidenceDirectory,'paper-l.pdf'),result.file.bytes,{mode:0o600});
  const evidence={fixture:'synthetic 2x3 RGBA, includes hidden RGB under alpha zero',paper:'l',pixelSize:[1500,1051],pagePoints:[width,height],pageMm:[width/72*25.4,height/72*25.4],pages:1,embeddedImages:1,colorSpace:'DeviceRGB',bitsPerComponent:8,embeddedRgbBytes:rgb.byteLength,pngRgbSha256:sha(new Uint8Array(reference.data.buffer,reference.data.byteOffset,reference.data.byteLength)),pdfRgbSha256:sha(rgb),pdfSha256:sha(result.file.bytes),pngSha256:sha(pngResult.file.bytes),sourceSha256:sha(source),pngBytes:pngResult.file.bytes.length,pdfBytes:result.file.bytes.length,scope:'actual handler in self/Node Blob test environment; not native browser Worker or physical print'};
  await writeFile(join(evidenceDirectory,'verification.json'),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
 }

});
