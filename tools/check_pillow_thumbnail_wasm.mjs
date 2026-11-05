import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createPillowResizeRuntime} from './browser-library-adapter/pillow-resize-runtime.mjs';
import {thumbnailSize} from './browser-library-adapter/thumbnail-size.mjs';
const [wasm,referenceFile,output]=process.argv.slice(2),bytes=fs.readFileSync(wasm);
const reference=JSON.parse(fs.readFileSync(referenceFile));assert.equal(reference.pillow,'12.3.0');
const sha=data=>createHash('sha256').update(data).digest('hex'),cases=[];
for(const item of reference.cases){
 const [width,height]=item.source,size=thumbnailSize(width,height);assert.deepEqual([size.width,size.height],item.output);
 const input=new Uint8Array(width*height*3);for(let i=0;i<input.length;i++)input[i]=(i*17+Math.floor(i/3)*31)%256;
 const runtime=await createPillowResizeRuntime(bytes,{maxMemoryBytes:134217728,filter:'thumbnail',growthImport:'foreground_memory_grow'});
 try{
  const result=runtime.resize({width,height,format:'rgb-u8',data:input.buffer},size);
  assert.equal(sha(new Uint8Array(result.data)),item.sha256);
  cases.push({...item,sha256Exact:true,memoryBytes:runtime.getState().memoryBytes});
 }finally{runtime.close();}
}
const report={status:'passed',pillow:reference.pillow,wasmBytes:bytes.length,wasmSha256:sha(bytes),
 reduceSource:{url:'https://raw.githubusercontent.com/python-pillow/Pillow/12.3.0/src/libImaging/Reduce.c',sha256:'fad296682cd71c1c05bc9adb79c800192c41ed4ec4ebe988ed53e35e7cb95fe6'},
 cases,maxMemoryBytes:134217728,limits:['Synthetic RGB/native and Node WASM only; not browser/decoded-photo quality acceptance','Largest tested original is 2049x2048, not the 24-million-pixel input bound','No model/GPU/browser started; publication, licenses and maximum-resource acceptance remain open']};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,cases:cases.length,wasmBytes:bytes.length}));
