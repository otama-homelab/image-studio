import {imageWorkGate} from './imageWorkGate';
type Header={type:'jpeg'|'png';width:number;height:number};
type Options={gate?:typeof imageWorkGate;signal:AbortSignal;imageFactory?:()=>HTMLImageElement;urlApi?:Pick<typeof URL,'createObjectURL'|'revokeObjectURL'>};
/** Validate the next local preview before replacing the current photo. No pixel conversion. */
async function decodeOne(blob:Blob,header:Header,{signal,gate=imageWorkGate,imageFactory=()=>new Image(),urlApi=URL}:Options){
 if(signal.aborted)throw Error('preview-aborted');
 const lease=gate.tryAcquire();if(!lease)throw Error(gate.getState().blocked?'preview-unavailable':'preview-busy');
 let image:HTMLImageElement|undefined,url:string|undefined,accepted=false,cleanupFailed=false;
 const stop=()=>{try{image?.removeAttribute('src');}catch{cleanupFailed=true;}};
 try{
  image=imageFactory();url=urlApi.createObjectURL(blob);signal.addEventListener('abort',stop,{once:true});image.src=url;
  await image.decode();
  if(signal.aborted)throw Error();
  const width=image.naturalWidth,height=image.naturalHeight;
  if(![width,height].every(value=>Number.isSafeInteger(value)&&value>0)||!((width===header.width&&height===header.height)||(header.type==='jpeg'&&width===header.height&&height===header.width)))throw Error();
  accepted=true;return {url,width,height};
 }catch{throw Error(signal.aborted?'preview-aborted':'preview-decode-failed');}
 finally{
  signal.removeEventListener('abort',stop);
  stop();
  if(url&&(!accepted||cleanupFailed)){try{urlApi.revokeObjectURL(url);}catch{cleanupFailed=true;}}
  lease.release({failed:cleanupFailed});
  if(cleanupFailed)throw Error('preview-cleanup-failed');
 }
}

// All mounted editor sessions share the native preview checker. Waiting callers
// allocate no Image/URL; aborted candidates are rejected before allocation.
let terminal:Promise<void>|null=null;
export function decodePreview(blob:Blob,header:Header,options:Options){
 const result=terminal?terminal.then(()=>decodeOne(blob,header,options)):decodeOne(blob,header,options);
 const ownTerminal=result.then(()=>{},()=>{});terminal=ownTerminal;
 void ownTerminal.then(()=>{if(terminal===ownTerminal)terminal=null;});
 return result;
}
