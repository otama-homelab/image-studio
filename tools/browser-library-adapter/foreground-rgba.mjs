/** Finalize estimated foreground using pinned rembg conversion and app opaque restoration. */
export function foregroundToRgba(rgb,alpha,foreground){
 if(!(rgb instanceof Uint8Array)||!(alpha instanceof Uint8Array)||!(foreground instanceof Float32Array)
  ||alpha.length===0||rgb.length!==alpha.length*3||foreground.length!==rgb.length)throw TypeError('Invalid foreground planes');
 for(const value of foreground)if(!Number.isFinite(value))throw RangeError('Non-finite foreground');
 const rgba=new Uint8Array(alpha.length*4);
 for(let i=0;i<alpha.length;i++){
  for(let c=0;c<3;c++){
   // stack_images promotes float32 F with float64 alpha before rembg's *255 cast.
   rgba[4*i+c]=alpha[i]===255?rgb[3*i+c]:Math.trunc(Math.max(0,Math.min(255,foreground[3*i+c]*255)));
  }
  rgba[4*i+3]=alpha[i];
 }
 return rgba;
}
