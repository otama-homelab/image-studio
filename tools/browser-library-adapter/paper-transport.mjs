import {paperLayout} from './print-geometry.mjs';
export class PaperWorkerError extends Error {
 constructor(code){super(code);this.name='PaperWorkerError';this.code=code;}
}
const rgb=image=>image?.format==='rgb-u8'&&Number.isSafeInteger(image.width)&&image.width>0&&Number.isSafeInteger(image.height)&&image.height>0
 &&Number.isSafeInteger(image.width*image.height*3)&&image.data instanceof ArrayBuffer&&image.data.byteLength===image.width*image.height*3;
const plane=image=>({width:image.width,height:image.height,format:'rgb-u8',data:image.data});
export function paperTransport(image,options={}){
 if(!rgb(image))throw new PaperWorkerError('invalid-paper-input');
 let layout;try{layout=paperLayout({paper:options.paper,photoWidth:image.width,photoHeight:image.height,dpi:options.dpi});}catch{throw new PaperWorkerError('invalid-paper-input');}
 return {image:plane(image),options:{paper:layout.paper,...(layout.assumedDpi?{}:{dpi:[...options.dpi]})},layout};
}
export function paperResult(image,layout){
 if(!rgb(image)||image.width!==layout.width||image.height!==layout.height)throw new PaperWorkerError('invalid-paper-result');
 return Object.freeze({image:Object.freeze(plane(image)),layout});
}
