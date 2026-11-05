import {paperLayout,GeometryError} from './print-geometry.mjs';

/** Copy already-sized RGB rows onto a white sheet; no resampling or alpha blending. Run in a Worker. */
export function renderPaperRgb(photo,{paper,dpi}={}){
 if(photo?.format!=='rgb-u8'||!(photo.data instanceof ArrayBuffer)
  ||!Number.isSafeInteger(photo.width)||photo.width<1||!Number.isSafeInteger(photo.height)||photo.height<1
  ||photo.data.byteLength!==photo.width*photo.height*3)throw new GeometryError('invalid-photo-rgb');
 const layout=paperLayout({paper,photoWidth:photo.width,photoHeight:photo.height,dpi});
 const source=new Uint8Array(photo.data),pixels=new Uint8Array(layout.width*layout.height*3);pixels.fill(255);
 const rowBytes=photo.width*3;
 for(const [x,y] of layout.positions)for(let row=0;row<photo.height;row++){
  pixels.set(source.subarray(row*rowBytes,(row+1)*rowBytes),((y+row)*layout.width+x)*3);
 }
 return Object.freeze({image:Object.freeze({width:layout.width,height:layout.height,format:'rgb-u8',data:pixels.buffer}),layout});
}
