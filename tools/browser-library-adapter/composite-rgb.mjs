/** Straight RGBA over an opaque RGB background; all arithmetic stays exact integers. */
export function compositeOpaqueBackground(rgba,color){
 if(!(rgba instanceof Uint8Array)||rgba.length===0||rgba.length%4!==0)throw TypeError('Invalid RGBA plane');
 if(!Array.isArray(color)||color.length!==3||color.some(v=>!Number.isInteger(v)||v<0||v>255))throw TypeError('Invalid background RGB');
 const rgb=new Uint8Array(rgba.length/4*3);
 for(let i=0,j=0;i<rgba.length;i+=4,j+=3){
  const alpha=rgba[i+3];
  for(let c=0;c<3;c++)rgb[j+c]=Math.floor((rgba[i+c]*alpha+color[c]*(255-alpha)+127)/255);
 }
 return rgb;
}
