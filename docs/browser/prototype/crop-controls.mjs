export {createOperationTracker} from '../../../tools/browser-library-adapter/operation-tracker.mjs';
// Shared candidate geometry; bundled locally so the prototype still works via file://.
export {bindCropPointer} from '../../../tools/browser-library-adapter/crop-pointer.mjs';
import {photoPixels,cropBox,paperLayout} from '../../../tools/browser-library-adapter/print-geometry.mjs';
export function geometry(settings){
 const [outputWidth,outputHeight]=photoPixels(settings.width,settings.height);
 return {width:280,height:360,outputWidth,outputHeight,range:settings.range,horizontal:settings.x,vertical:settings.y};
}
export function viewBox(settings){
 const [left,top,right,bottom]=cropBox(geometry(settings));return [left,top,right-left,bottom-top].join(' ');
}
export function applyDrag(session,next){
 session.change('crop',{x:next.horizontal,y:next.vertical});
}

const papers=Object.freeze({A4:'a4',L:'l','2L':'2l','はがき':'postcard'});
export function printLayout(label){
 return paperLayout({paper:papers[label],photoWidth:354,photoHeight:472,dpi:[300,300]});
}
export function paperDrawing(label){
 const layout=printLayout(label);
 return `<svg viewBox="0 0 ${layout.width} ${layout.height}" role="img" aria-label="用紙配置の疑似図"><rect width="${layout.width}" height="${layout.height}" fill="white"/>${layout.positions.map(([x,y])=>`<rect x="${x}" y="${y}" width="354" height="472" fill="#737b80"/>`).join('')}</svg>`;
}
