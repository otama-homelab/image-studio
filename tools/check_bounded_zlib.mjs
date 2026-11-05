import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {createBoundedZlib} from './browser-library-adapter/bounded-zlib.mjs';
const [dependencies,output]=process.argv.slice(2);
if(!output||fs.existsSync(output))throw Error('Need private dependencies and new report');
const libraryFile=path.resolve(dependencies,'node_modules/fflate/esm/browser.js'),{unzlibSync,zlibSync}=await import(pathToFileURL(libraryFile));
const adler32=createRequire(import.meta.url)(path.resolve(dependencies,'node_modules/pako/lib/zlib/adler32.js'));
const inflate=createBoundedZlib({unzlibSync,adler32,maxOutputBytes:4096,maxCompressedBytes:65536}),cases=[];
for(const level of [0,1,6,9]){
 for(const length of [1,31,32,33,255,4095,4096]){
  const raw=Uint8Array.from({length},(_,i)=>(i*37+11)%256),compressed=zlibSync(raw,{level}),decoded=inflate(compressed);assert.deepEqual(decoded,raw);assert.equal(decoded.buffer.byteLength,4097);cases.push({level,length,status:'exact'});
 }
 const over=zlibSync(new Uint8Array(49280),{level});
 assert.throws(()=>inflate(over,{outputBytes:4}),e=>['inflate-failed','inflate-output-limit'].includes(e.code));cases.push({level,outputLimit:4,actualTinyRawBytes:49280,status:'rejected'});
}
const exact=zlibSync(Uint8Array.of(1,2,3,4));assert.deepEqual(inflate(exact,{outputBytes:4}),Uint8Array.of(1,2,3,4));assert.throws(()=>inflate(exact,{outputBytes:3}));
let called=false;const guarded=createBoundedZlib({adler32,unzlibSync(){called=true;},maxOutputBytes:32,maxCompressedBytes:4});assert.throws(()=>guarded(new Uint8Array(5)));assert.equal(called,false);
const corrupt=Uint8Array.from(exact);corrupt[corrupt.length-1]^=1;assert.throws(()=>inflate(corrupt),e=>e.code==='inflate-checksum-failed');
const report={adlerMismatchRejected:true,status:'passed',library:'existing pinned fflate unzlibSync out option',librarySha256:createHash('sha256').update(fs.readFileSync(libraryFile)).digest('hex'),normalCases:28,oversizedCases:4,exactLimitAccepted:true,oneByteOverflowRejected:true,compressedLimitBeforeDecode:true,cases,limits:['Fixed output allocation only; Huffman tables/runtime/input/CPU and process RAM are not capped by this adapter','Malformed larger stored blocks may throw library RangeError, mapped to fixed inflate-failed','Sentinel detects excess output; fflate may finish decoding it before returning, so Worker termination remains required','Adler32 verified with existing pako helper; not all malformed zlib grammar is proven rejected','Not yet connected to fast-png streaming IDAT or iCCP; current PNG candidate gate remains open','All test raw streams <=49,280 bytes, no GPU/model/browser initialized']};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({status:report.status,normalCases:28,oversizedCases:4}));
