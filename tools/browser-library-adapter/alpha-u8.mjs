/** NumPy float32 multiply + ties-to-even rounding, without a resize kernel. */
export function alphaToUint8(alpha,trimap){
 if(!(alpha instanceof Float32Array))throw TypeError('Expected float32 alpha');
 if(trimap!==undefined&&(!(trimap instanceof Uint8Array)||trimap.length!==alpha.length))throw TypeError('Invalid trimap');
 for(let i=0;i<alpha.length;i++){
  if(!Number.isFinite(alpha[i]))throw RangeError('Non-finite alpha');
  if(trimap&&trimap[i]!==0&&trimap[i]!==128&&trimap[i]!==255)throw RangeError('Invalid trimap value');
 }
 const output=new Uint8Array(alpha.length);
 for(let i=0;i<alpha.length;i++){
  const scaled=Math.fround(alpha[i]*255),lower=Math.floor(scaled),fraction=scaled-lower;
  const rounded=fraction===0.5?lower+(lower%2!==0?1:0):Math.round(scaled);
  output[i]=Math.max(0,Math.min(255,rounded));
  if(trimap&&trimap[i]!==128)output[i]=trimap[i];
 }
 return output;
}
