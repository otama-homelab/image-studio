export function foregroundInput({width,height,rgb,alpha}={}){
 if(![width,height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=2000)||width*height===1||!(rgb instanceof Float32Array)||!(alpha instanceof Float32Array)||!(rgb.buffer instanceof ArrayBuffer)||!(alpha.buffer instanceof ArrayBuffer)||rgb.length!==width*height*3||alpha.length!==width*height||[rgb,alpha].some(plane=>plane.some(value=>!Number.isFinite(value)||value<0||value>1)))throw Error('invalid-foreground-input');
 return {width,height,rgb,alpha};
}
/** Diagnostic ABI boundary only; does not instantiate or bound the module's allocator. */
export function createForegroundMemory(exports){
 if(!(exports?.memory instanceof WebAssembly.Memory)||!['malloc','free','pymatting_ml_rgb'].every(name=>typeof exports[name]==='function'))throw Error('invalid-foreground-module');
 let runtime=exports,closed=false,busy=false;
 return Object.freeze({
  estimate({width,height,rgb,alpha}={}){
   if(closed)throw Error('foreground-module-unavailable');
   if(busy)throw Error('foreground-busy');
   foregroundInput({width,height,rgb,alpha});
   if(rgb.buffer===runtime.memory.buffer||alpha.buffer===runtime.memory.buffer)throw Error('invalid-foreground-input');
   const owned=[];let poisoned=false;
   const call=(name,...args)=>{try{return runtime[name](...args);}catch{poisoned=true;throw Error('foreground-runtime-failed');}};
   const failMemory=()=>{poisoned=true;throw Error('foreground-memory-failed');};
   busy=true;
   try{
    const allocate=size=>{
     const raw=call('malloc',size);
     if(!Number.isInteger(raw)||raw===0||raw< -2147483648||raw>4294967295)failMemory();
     const pointer=raw>>>0;owned.push(pointer);
     if(pointer%4||pointer+size>runtime.memory.buffer.byteLength)failMemory();
     return pointer;
    };
    const ip=allocate(rgb.byteLength),ap=allocate(alpha.byteLength),fp=allocate(rgb.byteLength),bp=allocate(rgb.byteLength);
    // Allocations may grow memory: all views are constructed afterwards.
    new Float32Array(runtime.memory.buffer,ip,rgb.length).set(rgb);
    new Float32Array(runtime.memory.buffer,ap,alpha.length).set(alpha);
    const code=call('pymatting_ml_rgb',ip,ap,width,height,fp,bp);
    if(code!==0)throw Error(code===-3?'foreground-memory-failed':'foreground-estimation-failed');
    const foreground=new Float32Array(runtime.memory.buffer,fp,rgb.length).slice(),background=new Float32Array(runtime.memory.buffer,bp,rgb.length).slice();
    if([foreground,background].some(plane=>plane.some(value=>!Number.isFinite(value)||value<0||value>1))){poisoned=true;throw Error('foreground-invalid-output');}
    return Object.freeze({width,height,foreground,background});
   }finally{
    let releaseFailed=false;
    if(!poisoned)for(const pointer of owned.reverse()){try{runtime.free(pointer);}catch{poisoned=true;releaseFailed=true;break;}}
    busy=false;if(poisoned){closed=true;runtime=null;}
    if(releaseFailed)throw Error('foreground-release-failed');
   }
  },
  close(){closed=true;runtime=null;},
  getState(){return Object.freeze({busy,closed});},
 });
}
