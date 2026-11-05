export class BoundedZlibError extends Error{
 constructor(code){super(code);this.name='BoundedZlibError';this.code=code;}
}
/** Existing fflate unzlibSync with a fixed output allocation and one overflow sentinel byte. */
export function createBoundedZlib({unzlibSync,adler32,maxOutputBytes,maxCompressedBytes}){
 if(typeof unzlibSync!=='function'||typeof adler32!=='function'||![maxOutputBytes,maxCompressedBytes].every(n=>Number.isSafeInteger(n)&&n>0&&n<=32*1024*1024))throw new BoundedZlibError('invalid-inflate-budget');
 return (compressed,{outputBytes=maxOutputBytes}={})=>{
  if(!(compressed instanceof Uint8Array)||compressed.length<6||compressed.length>maxCompressedBytes||!Number.isSafeInteger(outputBytes)||outputBytes<1||outputBytes>maxOutputBytes)throw new BoundedZlibError('invalid-inflate-input');
  const out=new Uint8Array(outputBytes+1);let decoded;
  try{decoded=unzlibSync(compressed,{out});}catch{throw new BoundedZlibError('inflate-failed');}
  if(!(decoded instanceof Uint8Array)||decoded.buffer!==out.buffer||decoded.byteOffset!==out.byteOffset||decoded.byteLength>out.byteLength)throw new BoundedZlibError('invalid-inflate-result');
  if(decoded.length>outputBytes)throw new BoundedZlibError('inflate-output-limit');
  const expected=new DataView(compressed.buffer,compressed.byteOffset+compressed.length-4,4).getUint32(0);
  if((adler32(1,decoded,decoded.length,0)>>>0)!==expected)throw new BoundedZlibError('inflate-checksum-failed');
  return decoded;
 };
}
