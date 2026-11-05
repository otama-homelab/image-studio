export const PNG_MAX_AXIS=4096,PNG_MAX_PIXELS=4_000_000;
export class PngInputError extends Error{
 constructor(code){super(code);this.name='PngInputError';this.code=code;}
}
/** Existing PNG decoder admission. No color-profile conversion claim.
 * @param {{inspect: Function, decode: Function, expandIndexed?: Function | null}} options
 */
export function createPngInput({inspect,decode,expandIndexed=null}){
 const check=signal=>{if(signal?.aborted)throw new PngInputError('aborted');};
 return async function read(file,{signal}={}){
  check(signal);
  const header=await inspect(file,{signal});
  if(header.type!=='png')throw new PngInputError('png-input-required');
  let bytes;
  try{bytes=new Uint8Array(await file.arrayBuffer());}catch{check(signal);throw new PngInputError('image-read-failed');}
  check(signal);
  if(bytes.byteLength!==header.fileBytes)throw new PngInputError('image-file-changed');
  let image;try{image=await decode(bytes,{checkCrc:true});}catch(cause){check(signal);throw new PngInputError(cause?.message==='unsupported-png-input'?'png-pixels-unsupported':'png-decode-failed');}
  check(signal);
  if(image?.width!==header.width||image?.height!==header.height)throw new PngInputError('image-dimensions-changed');
  if(image.depth===16){
   if(![1,2,3,4].includes(image.channels)||!(image.data instanceof Uint16Array)||image.data.length!==header.width*header.height*image.channels||(image.channels===1&&image.palette!==undefined))throw new PngInputError('png-pixels-unsupported');
   // Use the same upper-byte policy for equivalent gray and truecolor samples.
   // Compare a gray transparency key at full precision before discarding low bits.
   if(image.channels===1&&image.transparency!==undefined){
    const key=image.transparency;
    if(!(key instanceof Uint16Array)||key.length!==1)throw new PngInputError('png-pixels-unsupported');
    const data=new Uint8Array(image.data.length*2);
    for(let i=0;i<image.data.length;i++){data[i*2]=image.data[i]>>>8;data[i*2+1]=image.data[i]===key[0]?0:255;}
    image={...image,depth:8,channels:2,data,transparency:undefined};
   }else image={...image,depth:8,data:Uint8Array.from(image.data,value=>value>>>8)};
  }
  if([1,2,4].includes(image.depth)&&image.channels===1&&image.palette===undefined){
   const maximum=2**image.depth-1,key=image.transparency;
   if(key!==undefined&&(!(key instanceof Uint16Array)||key.length!==1||key[0]>maximum))throw new PngInputError('png-pixels-unsupported');
   // Reuse the public packed-sample expander with the grayscale ramp as its table.
   const palette=Array.from({length:maximum+1},(_,sample)=>{const gray=sample*255/maximum;return key===undefined?[gray,gray,gray]:[gray,gray,gray,sample===key[0]?0:255];});
   image={...image,palette};
  }
  if([1,2,4,8].includes(image.depth)&&image.channels===1&&Array.isArray(image.palette)){
   const palette=image.palette,channels=palette[0]?.length;
   if(typeof expandIndexed!=='function'||!palette.length||palette.length>2**image.depth||![3,4].includes(channels)||palette.some(color=>!Array.isArray(color)||color.length!==channels||color.some(value=>!Number.isInteger(value)||value<0||value>255)))throw new PngInputError('png-pixels-unsupported');
   try{image={...image,depth:8,channels,data:expandIndexed(image)};}catch{throw new PngInputError('png-pixels-unsupported');}
  }
  if(image.depth===8&&[1,2].includes(image.channels)&&!image.palette){
   const gray=image.data,stride=image.channels,key=image.transparency;
   if(!(gray instanceof Uint8Array)||gray.length!==header.width*header.height*stride
    ||(key!==undefined&&(!(key instanceof Uint16Array)||stride!==1||key.length!==1||key[0]>255)))throw new PngInputError('png-pixels-unsupported');
   const channels=stride===2||key!==undefined?4:3,data=new Uint8Array(header.width*header.height*channels);
   // Sample layout only: repeat gray, retain unassociated alpha and hidden gray values.
   for(let i=0,j=0;i<gray.length;i+=stride,j+=channels){
    data[j]=data[j+1]=data[j+2]=gray[i];
    if(channels===4)data[j+3]=stride===2?gray[i+1]:gray[i]===key[0]?0:255;
   }
   image={...image,channels,data};
  }
  if(image.depth!==8||![3,4].includes(image.channels)||!(image.data instanceof Uint8Array)||image.data.length!==header.width*header.height*image.channels)throw new PngInputError('png-pixels-unsupported');
  // Detach decoder output ownership: registry may consume the new exact-sized buffer.
  const data=Uint8Array.from(image.data).buffer;
  return {width:image.width,height:image.height,format:image.channels===3?'rgb-u8':'rgba-u8',data};
 };
}
