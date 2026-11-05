import {parse} from 'exifr';
// exifr 7.1.3 implements silentErrors but omits it from its published Options type.
const densityOptions={jfif:true,tiff:true,ifd0:{pick:['XResolution','YResolution','ResolutionUnit']},ifd1:false,exif:false,gps:false,interop:false,xmp:false,icc:false,iptc:false,mergeOutput:false,translateValues:false,sanitize:false,silentErrors:false};
export class PrintMetadataError extends Error{code:string;constructor(code:string){super(code);this.code=code;}}
const invalid=()=>{throw new PrintMetadataError('invalid-print-metadata');};
function accepted(x:number,y:number):[number,number]{
 if(![x,y].every(value=>Number.isFinite(value)&&value>0))return invalid();
 if([x,y].some(value=>Math.abs(value-300)>.1))throw new PrintMetadataError('unsupported-print-dpi');
 return [x,y];
}
export function pngPrintDensity(resolution?:{x:number;y:number;unit:number}):[number,number]|null{
 if(!resolution||resolution.unit===0)return null;
 if(resolution.unit!==1)return invalid();
 return accepted(resolution.x*.0254,resolution.y*.0254);
}
/** Existing exifr reads only density/IFD0 tags. Never pass it a URL or copy arbitrary metadata out. */
export async function jpegPrintDensity(bytes:Uint8Array):Promise<[number,number]|null>{
 let metadata;
 try{metadata=await parse(bytes,densityOptions);}
 catch{return invalid();}
 const jfif=metadata?.jfif,exif=metadata?.ifd0;
 // Match Pillow's preference for physical JFIF density over EXIF.
 if(jfif&&jfif.ResolutionUnit!==0){
  if(![1,2].includes(jfif.ResolutionUnit))return invalid();
  const scale=jfif.ResolutionUnit===2?2.54:1;
  return accepted(jfif.XResolution*scale,jfif.YResolution*scale);
 }
 if(exif&&['XResolution','YResolution','ResolutionUnit'].some(key=>Object.hasOwn(exif,key))){
  if(![2,3].includes(exif.ResolutionUnit))return invalid();
  const scale=exif.ResolutionUnit===3?2.54:1;
  return accepted(exif.XResolution*scale,exif.YResolution*scale);
 }
 return null;
}
