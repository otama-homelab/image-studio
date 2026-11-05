/** Tiny saved-JIT comparison only: no browser, ML runtime or inference. */
import fs from 'node:fs';
import {createForegroundMemory} from './browser-library-adapter/foreground-memory.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const [wasmPath,referencePath,output]=process.argv.slice(2);
if(!wasmPath||!referencePath||!output||fs.existsSync(output))throw Error('Need WASM REFERENCE_JSON NEW_OUTPUT_JSON');
const reference=JSON.parse(fs.readFileSync(referencePath,'utf8'));
assert.equal(reference.status,'captured');assert.equal(reference.sourceSha256,'fd78cfb439940debc54c89a00638f025c0daef0bacc07fba393572787e9431ca');
assert.deepEqual(reference.versions,{numpy:'2.3.5',numba:'0.68.0',llvmlite:'0.50.0'});
const bytes=fs.readFileSync(wasmPath),module=await WebAssembly.compile(bytes);
const math={pow:Math.pow,ceil:Math.ceil,floor:Math.floor,fmin:Math.min,log2:Math.log2,fmax:Math.max,fabsf:Math.abs};
for(const item of WebAssembly.Module.imports(module))assert.ok(item.module==='env'&&item.kind==='function'&&Object.hasOwn(math,item.name));
const instance=await WebAssembly.instantiate(module,{env:math}),{memory,malloc,free,pymatting_ml_rgb:run}=instance.exports;
const startBytes=memory.buffer.byteLength,cases=[],adapter=createForegroundMemory(instance.exports);
for(const row of reference.cases){
 assert.ok(row.width*row.height<=64,'Tiny fixtures only');
 const count=row.width*row.height,rgb=Float32Array.from(row.inputRgb),alpha=Float32Array.from(row.inputAlpha),pointers=[];
 const allocate=data=>{const pointer=malloc(data.byteLength);assert.ok(pointer);pointers.push(pointer);new Uint8Array(memory.buffer,pointer,data.byteLength).set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength));return pointer;};
 const ip=allocate(rgb),ap=allocate(alpha),fp=allocate(new Float32Array(count*3)),bp=allocate(new Float32Array(count*3));
 try{
  const code=run(ip,ap,row.width,row.height,fp,bp),result={name:row.name,code};
  assert.deepEqual(new Float32Array(memory.buffer,ip,rgb.length),rgb);assert.deepEqual(new Float32Array(memory.buffer,ap,alpha.length),alpha);
  if(row.status==='reference-exception'){assert.equal(row.exceptionType,'ZeroDivisionError');assert.equal(code,-2);result.referenceExceptionMatched=true;}
  else{
   assert.equal(code,0);
   const adapted=adapter.estimate({width:row.width,height:row.height,rgb,alpha});
   assert.deepEqual(adapted.foreground,Float32Array.from(row.foreground));assert.deepEqual(adapted.background,Float32Array.from(row.background));result.abiAdapterByteExact=true;
   for(const [name,pointer] of [['foreground',fp],['background',bp]]){
    const actual=new Float32Array(memory.buffer,pointer,count*3),expected=Float32Array.from(row[name]);
    result[name+'MaxDifference']=Math.max(...actual.map((value,index)=>Math.abs(value-expected[index])));
    result[name+'ByteExact']=Buffer.from(actual.buffer,actual.byteOffset,actual.byteLength).equals(Buffer.from(expected.buffer));
   }
  }
  cases.push(result);
 }finally{for(const pointer of pointers)free(pointer);}
}
adapter.close();
const exact=cases.every(row=>row.foregroundByteExact!==false&&row.backgroundByteExact!==false);
const report={status:exact?'passed':'mismatch',wasm:{bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),imports:WebAssembly.Module.imports(module),memoryStartBytes:startBytes,memoryAfterBytes:memory.buffer.byteLength},cases,allReturnedCasesByteExact:exact,limits:['Tiny saved actual-JIT synthetic reference only; not full-size numerical or visual acceptance','Node WebAssembly only; browser/Worker/CSP, memory growth failures and release unverified','Host Math transcendental functions and diagnostic allocator are not production acceptance','No browser/GPU/model initialized; no public app integration']};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!exact)process.exitCode=1;
