import {createPillowResizeMemory,PillowResizeError} from './pillow-resize-memory.mjs';
/** Pinned, trusted standalone module only. Application must verify artifact SHA before calling.
 * @param {BufferSource} bytes
 * @param {{maxMemoryBytes?:number,filter?:string,growthImport?:string}} [options]
 */
export async function createPillowResizeRuntime(bytes,{maxMemoryBytes,filter='lanczos',growthImport='resize_memory_grow'}={}){
 if(!Number.isSafeInteger(maxMemoryBytes)||maxMemoryBytes<65536||maxMemoryBytes%65536!==0||maxMemoryBytes>2147483648)throw new PillowResizeError('invalid-resize-memory-limit');
 if(!['lanczos','bilinear','thumbnail','crop'].includes(filter)||!['resize_memory_grow','foreground_memory_grow'].includes(growthImport))throw new PillowResizeError('invalid-resize-module');
 let instance=null,adapter=null,growthAttempts=0,rejectedGrowths=0,closed=false;
 try{
  const module=await WebAssembly.compile(bytes);
  const actual=WebAssembly.Module.imports(module).map(x=>`${x.module}:${x.name}:${x.kind}`).sort();
  const expected=['env:__assert_fail:function','env:cos:function',`env:${growthImport}:function`,'env:sin:function'].sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw new PillowResizeError('invalid-resize-module');
  instance=await WebAssembly.instantiate(module,{env:{sin:Math.sin,cos:Math.cos,__assert_fail(){throw new PillowResizeError('resize-failed');},[growthImport](pages){
   growthAttempts++;
   if(!instance||!Number.isSafeInteger(pages)||pages<=0||instance.exports.memory.buffer.byteLength+pages*65536>maxMemoryBytes){rejectedGrowths++;return -1;}
   try{return instance.exports.memory.grow(pages);}catch{rejectedGrowths++;return -1;}
  }}});
  if(instance.exports.memory.buffer.byteLength>maxMemoryBytes)throw new PillowResizeError('resize-module-memory-limit');
  adapter=createPillowResizeMemory(instance.exports,{filter});
 }catch(error){instance=null;throw new PillowResizeError(error instanceof PillowResizeError?error.code:'resize-module-create-failed');}
 return Object.freeze({
  resize(...args){
   try{return adapter.resize(...args);}catch(error){if(adapter.getState().closed){closed=true;instance=null;}throw error;}
  },
  close(){if(closed)return;closed=true;adapter.close();instance=null;},
  getState(){return Object.freeze({closed,memoryBytes:instance?.exports.memory.buffer.byteLength??0,maxMemoryBytes,growthAttempts,rejectedGrowths});},
 });
}
