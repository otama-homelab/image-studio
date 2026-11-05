import {thumbnailSize} from './thumbnail-size.mjs';
export class ResizeWorkerError extends Error {
 constructor(code){super(code);this.name='ResizeWorkerError';this.code=code;}
}
const dimension=n=>Number.isInteger(n)&&n>=1&&n<=2048;
function rgb(image,original=false){
 const sourceDimension=original?n=>Number.isInteger(n)&&n>=1&&n<=16384:dimension;
 if(!image||image.format!=='rgb-u8'||!sourceDimension(image.width)||!sourceDimension(image.height)||image.width*image.height>24_000_000
  ||!(image.data instanceof ArrayBuffer)||image.data.byteLength!==image.width*image.height*3)throw new ResizeWorkerError('invalid-resize-input');
 return {width:image.width,height:image.height,format:'rgb-u8',data:image.data};
}
export function resizeTransport(image,options={}){
 const thumbnail=options.thumbnail===true,plane=rgb(image,thumbnail),{width,height}=options,box=options.box??[0,0,plane.width,plane.height];
 if(!dimension(width)||!dimension(height)||!Array.isArray(box)||box.length!==4||!box.every(Number.isFinite)
  ||box[0]<0||box[1]<0||box[2]>plane.width||box[3]>plane.height||box[2]<=box[0]||box[3]<=box[1])throw new ResizeWorkerError('invalid-resize-input');
 if(thumbnail){const expected=thumbnailSize(plane.width,plane.height);if(width!==expected.width||height!==expected.height||box[0]!==0||box[1]!==0||box[2]!==plane.width||box[3]!==plane.height)throw new ResizeWorkerError('invalid-resize-input');}
 return {image:plane,options:{width,height,box:[...box],...(thumbnail?{thumbnail:true}:{})}};
}
export function resizeResult(image,options){
 const plane=rgb(image);if(plane.width!==options.width||plane.height!==options.height)throw new ResizeWorkerError('invalid-resize-result');
 return Object.freeze(plane);
}
