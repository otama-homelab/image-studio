import {createForegroundMemory} from './foreground-memory.mjs';
/** Trusted pinned fork artifact only; hash verification belongs to the caller. */
export async function createForegroundRuntime(bytes,{maxMemoryBytes}={}){
 if(!Number.isSafeInteger(maxMemoryBytes)||maxMemoryBytes<65536||maxMemoryBytes%65536||maxMemoryBytes>2147483648)throw Error('invalid-foreground-memory-limit');
 const module=await WebAssembly.compile(bytes);
 const math={pow:Math.pow,ceil:Math.ceil,floor:Math.floor,fmin:Math.min,log2:Math.log2,fmax:Math.max,fabsf:Math.abs};
 const actual=WebAssembly.Module.imports(module).map(item=>`${item.module}:${item.name}:${item.kind}`).sort();
 const expected=[...Object.keys(math),'foreground_memory_grow'].map(name=>`env:${name}:function`).sort();
 if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('invalid-foreground-module');
 let instance=null,adapter=null,closed=false,growthAttempts=0,rejectedGrowths=0;
 instance=await WebAssembly.instantiate(module,{env:{...math,foreground_memory_grow(pages){
  growthAttempts++;
  if(!instance||!Number.isSafeInteger(pages)||pages<=0||instance.exports.memory.buffer.byteLength+pages*65536>maxMemoryBytes){rejectedGrowths++;return -1;}
  try{return instance.exports.memory.grow(pages);}catch{rejectedGrowths++;return -1;}
 }}});
 if(instance.exports.memory.buffer.byteLength>maxMemoryBytes){instance=null;throw Error('foreground-initial-memory-limit');}
 adapter=createForegroundMemory(instance.exports);
 return Object.freeze({
  estimate(...args){try{return adapter.estimate(...args);}catch(error){if(adapter.getState().closed){closed=true;instance=null;}throw error;}},
  close(){closed=true;adapter.close();instance=null;},
  getState(){return Object.freeze({closed,memoryBytes:instance?.exports.memory.buffer.byteLength??0,maxMemoryBytes,growthAttempts,rejectedGrowths});},
 });
}
