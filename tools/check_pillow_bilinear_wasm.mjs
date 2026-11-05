/** Small actual-WASM filter selection check; no browser/model/GPU. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createPillowResizeRuntime} from './browser-library-adapter/pillow-resize-runtime.mjs';
const [wasmPath,bilinearReference,output]=process.argv.slice(2);if(!output||fs.existsSync(output))throw Error('Need WASM BILINEAR_REFERENCE NEW_OUTPUT');
const bytes=fs.readFileSync(wasmPath),reference=JSON.parse(fs.readFileSync(new URL('../docs/browser/validation/2026-11-01-pillow-resize-reference-v2.json',import.meta.url))),bilinear=JSON.parse(fs.readFileSync(bilinearReference));assert.equal(bilinear.status,'passed');assert.equal(bilinear.pillow,'12.3.0');
const source=Uint8Array.from(Buffer.from(reference.sourceRgbHex,'hex')),sha=bytes=>createHash('sha256').update(bytes).digest('hex'),cases=[];
for(const filter of ['bilinear','lanczos']){
 const runtime=await createPillowResizeRuntime(bytes,{maxMemoryBytes:262144,growthImport:'foreground_memory_grow',filter});
 try{for(const item of filter==='bilinear'?bilinear.cases:reference.cases){
  const width=item.width??item.outputSize[0],height=item.height??item.outputSize[1],result=runtime.resize({width:7,height:5,format:'rgb-u8',data:source.slice().buffer},{width,height,box:item.box??undefined});assert.equal(sha(new Uint8Array(result.data)),item.sha256);cases.push({filter,width,height,allBytesExact:true});
 }}finally{runtime.close();}
}
const report={status:'passed',wasmBytes:bytes.length,wasmSha256:sha(bytes),cases,filters:['bilinear','lanczos'],growthImport:'foreground_memory_grow',maxMemoryBytes:262144,limits:['Tiny RGB only, no2048 memory/performance acceptance','Node WebAssembly, not native browser/Worker/CSP acceptance','Managed runtime fork and unmodified upstream Pillow, not a published release']};fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:'passed',cases:cases.length,wasmBytes:bytes.length}));
