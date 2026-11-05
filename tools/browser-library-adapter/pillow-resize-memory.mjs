export class PillowResizeError extends Error {
 constructor(code){super(code);this.name='PillowResizeError';this.code=code;}
}
/** Candidate ABI adapter for an already-created standalone module. Never initializes a runtime.
 * Ordinary resize keeps its 2048-axis contract. Explicit thumbnail uses the separate
 * upstream Reduce/Resample entry for originals within the application's input bounds.
 */
export function createPillowResizeMemory(exports,{filter='lanczos'}={}){
 if(!['lanczos','bilinear','thumbnail','crop'].includes(filter))throw new PillowResizeError('invalid-resize-filter');
 const method=filter==='crop'?'pillow_crop_rgb':filter==='thumbnail'?'pillow_thumbnail_rgb':filter==='bilinear'?'pillow_resize_bilinear_rgb':'pillow_resize_rgb';
 if(!exports?.memory||!['malloc','free',method].every(k=>typeof exports[k]==='function'))throw new PillowResizeError('invalid-resize-module');
 let busy=false,closed=false,runtime=exports;
 const dimension=n=>Number.isInteger(n)&&n>=1&&n<=(filter==='crop'?4096:2048);
 return Object.freeze({
  resize(image,{width,height,box}={}){
   if(closed)throw new PillowResizeError('resize-module-unavailable');
   if(busy)throw new PillowResizeError('resize-busy');
   const sourceDimension=n=>Number.isInteger(n)&&n>=1&&n<=(['thumbnail','crop'].includes(filter)?16384:2048);
   if(image?.format!=='rgb-u8'||!sourceDimension(image.width)||!sourceDimension(image.height)||image.width*image.height>24_000_000||!(image.data instanceof ArrayBuffer)
    ||image.data===runtime.memory.buffer||image.data.byteLength!==image.width*image.height*3||!dimension(width)||!dimension(height))throw new PillowResizeError('invalid-resize-input');
   const edges=box??[0,0,image.width,image.height];
   if(filter==='thumbnail'&&(width>2000||height>2000||edges[0]!==0||edges[1]!==0||edges[2]!==image.width||edges[3]!==image.height))throw new PillowResizeError('invalid-resize-input');
   if(!Array.isArray(edges)||edges.length!==4||!edges.every(Number.isFinite)
    ||edges[0]<0||edges[1]<0||edges[2]>image.width||edges[3]>image.height||edges[2]<=edges[0]||edges[3]<=edges[1])throw new PillowResizeError('invalid-resize-input');
   const floats=new Float32Array(edges),sourceSize=image.data.byteLength,destSize=width*height*3,owned=[];
   let poisoned=false;
   const call=(method,...args)=>{
    try{return runtime[method](...args);}catch{poisoned=true;throw new PillowResizeError('resize-failed');}
   };
   const memoryFailure=()=>{poisoned=true;throw new PillowResizeError('resize-memory-failed');};
   busy=true;
   try{
    const allocate=size=>{
     const raw=call('malloc',size);
     if(!Number.isInteger(raw)||raw===0||raw< -2147483648||raw>4294967295)memoryFailure();
     const pointer=raw>>>0;owned.push(pointer);
     if(pointer+size>runtime.memory.buffer.byteLength)memoryFailure();
     return pointer;
    };
    const src=allocate(sourceSize),dst=allocate(destSize),bounds=allocate(16);
    // All allocations may grow memory and detach old views. Create fresh views after them.
    new Uint8Array(runtime.memory.buffer,src,sourceSize).set(new Uint8Array(image.data));
    const view=new DataView(runtime.memory.buffer);for(let i=0;i<4;i++)view.setFloat32(bounds+i*4,floats[i],true);
    if(call(method,src,image.width,image.height,width,height,bounds,dst)!==0)throw new PillowResizeError('resize-failed');
    // The native filter/allocator may also grow memory. Copy output before freeing any pointer.
    const data=new Uint8Array(runtime.memory.buffer,dst,destSize).slice().buffer;
    return Object.freeze({width,height,format:'rgb-u8',data});
   }catch(error){throw new PillowResizeError(error instanceof PillowResizeError?error.code:'resize-failed');}
   finally{
    // A trap may corrupt allocator state. Never re-enter any module export after it.
    let failed=false;
    if(!poisoned)for(const pointer of owned.reverse()){
     try{runtime.free(pointer);}catch{poisoned=true;failed=true;break;}
    }
    busy=false;if(poisoned){closed=true;runtime=null;}
    if(failed)throw new PillowResizeError('resize-memory-release-failed');
   }
  },
  close(){closed=true;runtime=null;},
  getState(){return Object.freeze({busy,closed});},
 });
}
