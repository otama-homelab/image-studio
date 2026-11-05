import {createResourcePolicy} from '../../../tools/browser-library-adapter/resource-policy.mjs';
import {createPillowResizeRuntime} from '../../../tools/browser-library-adapter/pillow-resize-runtime.mjs';
import type {SourcePixels} from '../sourceImage';
declare const __CROP_RESIZE__:null|{url:string;bytes:number;sha256:string};
export const cropResizeConfigured=()=>typeof __CROP_RESIZE__!=='undefined'&&__CROP_RESIZE__!==null;
/** Trusted build asset; ordinary builds retain Canvas until release acceptance. */
export async function prepareCropResize(signal?:AbortSignal){
 if(!cropResizeConfigured())return null;
 try{
 const file=__CROP_RESIZE__!;if(!Number.isSafeInteger(file.bytes)||file.bytes<1||file.bytes>65536)throw Error('invalid-crop-resize');
 const policy=createResourcePolicy({files:[file],signal,fetchImpl:fetch.bind(globalThis),cache:{async match(){return undefined;},async put(){throw Error('unused-asset-cache');}},makeHasher:()=>{
  const chunks:Uint8Array[]=[];return {update(chunk:Uint8Array){chunks.push(chunk.slice());},async digestHex(){const bytes=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}chunks.length=0;return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}};
 }});
 const response=await policy.fetch(file.url);const bytes=await response.arrayBuffer();
 const runtime=await createPillowResizeRuntime(bytes,{filter:'crop',growthImport:'foreground_memory_grow',maxMemoryBytes:512*1024**2});
 return {resize:(image:SourcePixels,width:number,height:number,box:number[])=>runtime.resize(image,{width,height,box}),close:()=>runtime.close()};
 }catch{throw Object.assign(new Error('crop-resize-unavailable'),{code:'crop-resize-unavailable'});}
}
