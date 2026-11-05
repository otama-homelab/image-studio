import {alphaToUint8} from './alpha-u8.mjs';

/** Crop only right/bottom padding from the pinned Base model, then restore trimap anchors. */
export function matteOutputToAlpha({data,dims},width,height,trimap){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>2000||height>2000)throw RangeError('Invalid matte image dimensions');
 const paddedWidth=Math.ceil(width/32)*32,paddedHeight=Math.ceil(height/32)*32;
 if(!Array.isArray(dims)||dims.length!==4||dims[0]!==1||dims[1]!==1||dims[2]!==paddedHeight||dims[3]!==paddedWidth
  ||!(data instanceof Float32Array)||data.length!==paddedWidth*paddedHeight)throw TypeError('Invalid matte output shape or dtype');
 if(!(trimap instanceof Uint8Array)||trimap.length!==width*height)throw TypeError('Invalid trimap dimensions');
 const cropped=new Float32Array(width*height);
 for(let y=0;y<height;y++)cropped.set(data.subarray(y*paddedWidth,y*paddedWidth+width),y*width);
 return alphaToUint8(cropped,trimap);
}
