/** Actual published PNG codec, tiny artificial RGB/RGBA; no model or browser. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDownloadLinks} from './browser-library-adapter/download-links.mjs';
import {createImageRegistry} from './browser-library-adapter/image-registry.mjs';
import {createExportJobs} from './browser-library-adapter/export-job.mjs';
import {createPngExporter} from './browser-library-adapter/png-export.mjs';
const [root,output]=process.argv.slice(2);
if(!output||fs.existsSync(output))throw Error('Need private dependency root and new output directory');
fs.mkdirSync(output,{mode:0o700});
const {encode,decode}=await import(pathToFileURL(path.join(root,'node_modules/fast-png/lib/index.js')).href);
const {default:crc}=await import(pathToFileURL(path.join(root,'node_modules/crc-32/crc32.js')).href);
let raw;
const exporter=createPngExporter({encode:image=>{raw=encode(image);return raw;},crc32:crc.buf});
const rgba=Uint8Array.of(255,0,127,0, 20,80,160,128, 80,100,120,255, 250,240,230,1);
const rgb=Uint8Array.of(245,243,239,20,80,160,80,100,120,250,240,230);
const hash=b=>createHash('sha256').update(b).digest('hex');
function chunks(bytes){
 const result=[],v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let at=8;
 while(at<bytes.length){const length=v.getUint32(at),end=at+12+length;result.push({type:String.fromCharCode(...bytes.subarray(at+4,at+8)),frame:bytes.subarray(at,end),data:bytes.subarray(at+8,end-4)});at=end;}
 return result;
}
const cases=[];
for(const kind of ['transparent','background','crop']){
 const source=kind==='transparent'?rgba:rgb,before=source.slice();
 const image={width:2,height:2,format:kind==='transparent'?'rgba-u8':'rgb-u8',data:source.buffer,photoName:'private-name',text:{GPS:'private-location'}};
 const result=exporter(image,{kind,paper:'a4'}),decoded=decode(result.bytes,{checkCrc:true}),parts=chunks(result.bytes),density=parts.filter(c=>c.type==='pHYs');
 assert.deepEqual([...decoded.data],[...source]);assert.deepEqual(source,before);assert.equal(decoded.width,2);assert.equal(decoded.height,2);
 assert.equal(density.length,kind==='crop'?1:0);
 if(density.length){const view=new DataView(density[0].data.buffer,density[0].data.byteOffset,9);assert.equal(view.getUint32(0),11811);assert.equal(view.getUint32(4),11811);assert.equal(view.getUint8(8),1);assert.ok(parts.findIndex(c=>c.type==='pHYs')<parts.findIndex(c=>c.type==='IDAT'));}
 const compressed=parts.filter(c=>c.type==='IDAT').map(c=>c.data),originalCompressed=chunks(raw).filter(c=>c.type==='IDAT').map(c=>c.data);
 assert.equal(hash(Buffer.concat(compressed)),hash(Buffer.concat(originalCompressed)));
 assert.ok(parts.every(c=>['IHDR','pHYs','IDAT','IEND'].includes(c.type)));
 assert.equal(Buffer.from(result.bytes).includes(Buffer.from('private')),false);
 fs.writeFileSync(path.join(output,kind+'.png'),result.bytes,{flag:'wx',mode:0o600});
 cases.push({kind,filename:result.filename,bytes:result.bytes.length,sha256:hash(result.bytes),width:2,height:2,channels:decoded.channels,pixelsExact:true,crcChecked:true,idatUnchanged:true,density:decoded.resolution??null});
}
const good=encode({width:2,height:2,channels:3,depth:8,data:rgb}),crop=exporter({width:2,height:2,format:'rgb-u8',data:rgb.buffer},{kind:'crop'}).bytes;
const phys=chunks(crop).find(c=>c.type==='pHYs').frame,originalChunks=chunks(good);
const duplicate=Uint8Array.from(Buffer.concat([good.subarray(0,8),originalChunks[0].frame,phys,phys,...originalChunks.slice(1).map(c=>c.frame)]));
for(const kind of ['background','crop']){
 const fixed=createPngExporter({encode:()=>duplicate,crc32:crc.buf})({width:2,height:2,format:'rgb-u8',data:rgb.buffer},{kind});
 assert.equal(chunks(fixed.bytes).filter(c=>c.type==='pHYs').length,kind==='crop'?1:0);decode(fixed.bytes,{checkCrc:true});
}
assert.throws(()=>exporter({width:2,height:2,format:'rgb-u8',data:rgb.buffer},{kind:'paper',paper:'a4'}),e=>e.code==='invalid-export-input');
const badCrc=good.slice();badCrc[badCrc.length-1]^=1;
const oversized=good.slice();new DataView(oversized.buffer).setUint32(8,0x7fffffff);
const trailing=Uint8Array.from([...good,0]);
for(const bytes of [badCrc,oversized,trailing,good.subarray(0,-1),new Uint8Array(8)]){
 const bad=createPngExporter({encode:()=>bytes,crc32:crc.buf});
 assert.throws(()=>bad({width:2,height:2,format:'rgb-u8',data:rgb.buffer},{kind:'background'}),e=>e.code==='png-output-invalid');
}
assert.throws(()=>createPngExporter({encode:()=>{throw Error('private encoder cause');},crc32:crc.buf})({width:2,height:2,format:'rgb-u8',data:rgb.buffer},{kind:'background'}),e=>e.message==='png-encode-failed');
const registry=createImageRegistry();
const asset=registry.register({width:2,height:2,format:'rgb-u8',data:rgb.slice().buffer},'session');
let current={assetId:asset.id,dependencyKey:'composite-1'};
const jobs=createExportJobs({registry,getCurrent:()=>current,encode:async(image,options)=>exporter(image,options)});
const prepared=await jobs.start({kind:'background'});assert.equal(prepared.status,'ready');
assert.deepEqual([...decode(prepared.file.bytes,{checkCrc:true}).data],[...rgb]);
assert.deepEqual([...new Uint8Array(registry.copy(asset.id).data)],[...rgb]);
assert.ok(jobs.getReady({kind:'background'}));
const links=createDownloadLinks({getReady:options=>jobs.getReady(options)});
try{
 const link=links.acquire({kind:'background'},'save-panel'),download=links.beginDownload(link.id,'save-panel');
 const localBytes=new Uint8Array(await(await fetch(download.url)).arrayBuffer());assert.equal(hash(localBytes),hash(prepared.file.bytes));
 current={...current,dependencyKey:'composite-2'};
 assert.throws(()=>links.beginDownload(link.id,'save-panel'),e=>e.code==='export-not-ready');
 assert.equal(jobs.getReady({kind:'background'}),null);
}finally{links.close();}
assert.equal(links.getState().urls,0);registry.release(asset.id,'session');
const report={status:'passed',cases,checks:{duplicateDensityReplaced:true,densityRemovedForBackground:true,iendCrcCorruptionRejected:true,oversizedChunkRejectedBeforeAllocation:true,truncationAndTrailingBytesRejected:true,encoderExceptionRedacted:true,wrongPaperDimensionsRejected:true,registryAndJobWithActualCodec:true,jobReadyInvalidatedOnSourceChange:true,nativeBlobUrlMatchesEncodedPng:true,sourceChangePreventsDownload:true,allBlobUrlsClosed:true},currentRssBytes:process.memoryUsage().rss,limitations:['Only 2x2 synthetic images. Full-size paper encoding not executed; mismatched paper dimensions are rejected.','Native Node Blob URL read/revocation checked; browser save dialog, disk write and real PDF remain untested.','Independent Pillow decoding is a separate check.']};
fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
