/** Tiny proof of the pinned decoder's output-allocation boundary; never inflate large payloads. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createImagePreflight} from './browser-library-adapter/image-preflight.mjs';
import {createPngInput} from './browser-library-adapter/png-input.mjs';
import assert from 'node:assert/strict';
const [dependencies,dimensions,output]=process.argv.slice(2);
if(!output||fs.existsSync(output))throw Error('Need private dependencies, dimensions package and new report');
const {encode,decode}=await import(pathToFileURL(path.resolve(dependencies,'node_modules/fast-png/lib/index.js')));
const {unzlibSync}=await import(pathToFileURL(path.resolve(dependencies,'node_modules/fflate/esm/browser.js')));
const require=createRequire(import.meta.url),crc32=require(path.resolve(dependencies,'node_modules/crc-32/crc32.js'));
const {imageDimensionsFromData}=await import(pathToFileURL(path.resolve(dimensions,'index.js')));
const png=encode({width:128,height:128,channels:3,depth:8,data:new Uint8Array(128*128*3)});
const forged=Uint8Array.from(png),view=new DataView(forged.buffer);view.setUint32(16,1);view.setUint32(20,1);view.setUint32(29,crc32.buf(forged.subarray(12,29))>>>0);
const chunks=[];let length=0;
for(let at=8;at<forged.length;){const count=view.getUint32(at),type=String.fromCharCode(...forged.subarray(at+4,at+8));if(type==='IDAT'){chunks.push(forged.subarray(at+8,at+8+count));length+=count;}at+=count+12;}
const compressed=new Uint8Array(length);let at=0;for(const chunk of chunks){compressed.set(chunk,at);at+=chunk.length;}
const inflated=unzlibSync(compressed);assert.equal(inflated.length,128*(128*3+1));assert.ok(inflated.length<65536);
const inspect=createImagePreflight({probe:imageDimensionsFromData,maxAxis:4096,maxPixels:4_000_000}),header=await inspect(new Blob([forged]));assert.deepEqual([header.width,header.height],[1,1]);
const image=await createPngInput({inspect,decode})(new Blob([forged]));assert.deepEqual([image.width,image.height,image.data.byteLength],[1,1,3]);
const report={status:'allocation-boundary-gap-confirmed',library:'fast-png 8.0.0 / pinned fflate',encodedBytes:forged.length,declaredSize:[1,1],expectedNoninterlacedRgb8InflatedBytes:4,actualTinyInflatedBytes:inflated.length,crcVerifiedByDecoder:true,currentInputAdapterAccepted:true,requiredNextAction:'Bound decompression/output and metadata inflation before adopting decoder for production input; header dimensions and Worker termination alone are not a memory cap',limits:['Tiny synthetic valid-CRC malformed PNG only; inflated bytes below64KiB','No large allocation, host OOM, GPU/model/browser initialized','This confirms a candidate decoder boundary gap, not a production deployment vulnerability']};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
