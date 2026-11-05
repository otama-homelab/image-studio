import {cropBox,GeometryError} from './print-geometry.mjs';
const finite=(...values)=>values.every(Number.isFinite);
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));

/** CSS pixels relative to stage. Device pixel ratio is intentionally absent. */
export function cropView(crop,{width,height}){
 if(!finite(width,height)||width<=0||height<=0)throw new GeometryError('invalid-crop-view');
 const box=cropBox(crop),cw=box[2]-box[0],ch=box[3]-box[1];
 const scale=Math.min(width/cw,height/ch),offsetX=(width-scale*cw)/2,offsetY=(height-scale*ch)/2;
 const point=(x,y)=>{if(!finite(x,y))throw new GeometryError('invalid-pointer');};
 return Object.freeze({box,scale,offsetX,offsetY,
  sourceToView(x,y){point(x,y);return Object.freeze([offsetX+scale*(x-box[0]),offsetY+scale*(y-box[1])]);},
  viewToSource(x,y){point(x,y);return Object.freeze([box[0]+(x-offsetX)/scale,box[1]+(y-offsetY)/scale]);},
 });
}

/** Pointerdown snapshot. Every move is relative to this snapshot, never the previous move. */
export function createCropDrag(crop,stage,{x,y}){
 if(!finite(x,y))throw new GeometryError('invalid-pointer');
 const settings=Object.freeze({width:crop.width,height:crop.height,outputWidth:crop.outputWidth,outputHeight:crop.outputHeight,
  range:crop.range??100,horizontal:crop.horizontal??50,vertical:crop.vertical??50});
 const view=cropView(settings,stage),[left,top,right,bottom]=view.box;
 const availableX=Math.max(0,settings.width-(right-left)),availableY=Math.max(0,settings.height-(bottom-top));
 return Object.freeze({
  move(nextX,nextY){
   if(!finite(nextX,nextY))throw new GeometryError('invalid-pointer');
   const nextLeft=clamp(left-(nextX-x)/view.scale,0,availableX),nextTop=clamp(top-(nextY-y)/view.scale,0,availableY);
   return Object.freeze({...settings,horizontal:availableX===0?settings.horizontal:100*nextLeft/availableX,
    vertical:availableY===0?settings.vertical:100*nextTop/availableY});
  },
 });
}
