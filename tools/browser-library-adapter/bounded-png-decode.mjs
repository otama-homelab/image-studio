import {createBoundedZlib} from './bounded-zlib.mjs';
import {PNG_MAX_AXIS,PNG_MAX_PIXELS} from './png-input.mjs';
/** Pinned fast-png 8 internals only. Pixel filtering remains upstream code. */
export function createBoundedPngDecode({PngDecoder,readKeyword,unzlibSync,adler32,maxProfileBytes=1024*1024}){
 const inflate=createBoundedZlib({unzlibSync,adler32,maxOutputBytes:32*1024*1024,maxCompressedBytes:20*1024*1024});
 const profileInflate=createBoundedZlib({unzlibSync,adler32,maxOutputBytes:maxProfileBytes,maxCompressedBytes:20*1024*1024});
 class Decoder extends PngDecoder{
  constructor(bytes,options){
   super(bytes,options);let chunks=[],compressedBytes=0,finished=false;
   this._inflator={push:(chunk,final)=>{
    if(finished||!(chunk instanceof Uint8Array))throw Error('invalid-png-stream');
    compressedBytes+=chunk.length;if(compressedBytes>20*1024*1024)throw Error('png-compressed-limit');
    if(chunk.length)chunks.push(chunk);
    if(!final)return;finished=true;
    const {width,height,channels,depth}=this._png;let expected;
    if(this._interlaceMethod===0)expected=height*(Math.ceil(width*channels*depth/8)+1);
    else if(this._interlaceMethod===1){
     // Same Adam7 pass extents as fast-png; this counts bytes, it does not unfilter pixels.
     expected=0;
     for(const [x,y,xStep,yStep] of [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]){
      const w=Math.max(0,Math.ceil((width-x)/xStep)),h=Math.max(0,Math.ceil((height-y)/yStep));if(w&&h)expected+=h*(Math.ceil(w*channels*depth/8)+1);
     }
    }else throw Error('invalid-png-interlace');
    const compressed=new Uint8Array(compressedBytes);let offset=0;for(const bytes of chunks){compressed.set(bytes,offset);offset+=bytes.length;}chunks=[];
    const decoded=inflate(compressed,{outputBytes:expected});if(decoded.length!==expected)throw Error('invalid-png-inflated-length');this._inflatorResult=decoded;
   }};
   this._boundedProfileSeen=false;
   this._boundedResolutionSeen=false;this._boundedDataSeen=false;
  }
  decodeIHDR(){
   super.decodeIHDR();const {width,height,depth,channels}=this._png;
   const indexed=channels===1&&this._colorType===3&&[1,2,4,8].includes(depth);
   const packedGray=this._colorType===0&&[1,2,4].includes(depth);
   // Pinned upstream Adam7 treats sub-byte samples as byte pixels; do not admit it.
   const sixteenBit=depth===16&&[0,2,4,6].includes(this._colorType);
   if((!indexed&&!packedGray&&!sixteenBit&&!(depth===8&&[1,2,3,4].includes(channels)))||(depth<8&&this._interlaceMethod!==0)||![width,height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=PNG_MAX_AXIS)||width>Math.floor(PNG_MAX_PIXELS/height))throw Error('unsupported-png-input');
  }
  decodePLTE(length){if([0,4].includes(this._colorType))throw Error('invalid-grayscale-palette');if(length>768)throw Error('png-palette-limit');return super.decodePLTE(length);}
  decodeIDAT(length){this._boundedDataSeen=true;return super.decodeIDAT(length);}
  decodepHYs(){
   if(this._boundedResolutionSeen||this._boundedDataSeen)throw Error('invalid-png-resolution-placement');
   this._boundedResolutionSeen=true;return super.decodepHYs();
  }
  decodeiCCP(length){
   // Adapted from fast-png 8 (MIT), retaining its keyword and IO helpers.
   if(this._boundedProfileSeen)throw Error('duplicate-png-profile');this._boundedProfileSeen=true;
   const name=readKeyword(this);if(this.readUint8()!==0)throw Error('invalid-png-profile-compression');
   const compressed=this.readBytes(length-name.length-2);
   this._png.iccEmbeddedProfile={name,profile:profileInflate(compressed)};
  }
 }
 return (bytes,options={})=>{
  if(!(bytes instanceof Uint8Array)||bytes.length>20*1024*1024)throw Error('invalid-png-input');
  // CRC cannot be disabled by the caller.
  return new Decoder(bytes,{...options,checkCrc:true}).decode();
 };
}
