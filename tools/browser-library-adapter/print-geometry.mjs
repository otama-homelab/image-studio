import {PAPER_PIXELS} from './paper-contract.mjs';
export class GeometryError extends Error {
 constructor(code){super(code);this.name='GeometryError';this.code=code;}
}
const positiveInt=n=>Number.isSafeInteger(n)&&n>0;
const inRange=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
export function roundEven(n){
 if(!Number.isFinite(n)||n<0)throw new GeometryError('invalid-dimension');
 const floor=Math.floor(n),fraction=n-floor;
 return fraction<.5?floor:fraction>.5?floor+1:floor%2===0?floor:floor+1;
}
export function photoPixels(widthMm,heightMm){
 if(!inRange(widthMm,9,152)||!inRange(heightMm,9,152))throw new GeometryError('invalid-dimension');
 return Object.freeze([roundEven(widthMm/25.4*300),roundEven(heightMm/25.4*300)]);
}
/** Geometry only: no image resampling and no DOM/CSS/device-pixel inputs. */
export function cropBox({width,height,outputWidth,outputHeight,range=100,horizontal=50,vertical=50}){
 if(![width,height,outputWidth,outputHeight].every(positiveInt)
  ||!inRange(range,10,100)||!inRange(horizontal,0,100)||!inRange(vertical,0,100))throw new GeometryError('invalid-crop');
 const aspect=outputWidth/outputHeight,ch=Math.min(height,width/aspect)*range/100,cw=ch*aspect;
 const left=Math.max(0,width-cw)*horizontal/100,top=Math.max(0,height-ch)*vertical/100;
 return Object.freeze([left,top,left+cw,top+ch]);
}
/** Fixed 300dpi paper geometry; caller supplies decoded metadata, never canvas defaults. */
export function paperLayout({paper,photoWidth,photoHeight,dpi}){
 if(!Object.hasOwn(PAPER_PIXELS,paper)||![photoWidth,photoHeight].every(positiveInt))throw new GeometryError('invalid-layout');
 const assumedDpi=dpi==null;
 if(!assumedDpi&&(!Array.isArray(dpi)||dpi.length!==2||!dpi.every(n=>Number.isFinite(n)&&Math.abs(n-300)<=.1)))throw new GeometryError('unsupported-dpi');
 const [width,height]=PAPER_PIXELS[paper],margin=59,gap=35;
 const columns=Math.floor((width-2*margin+gap)/(photoWidth+gap)),rows=Math.floor((height-2*margin+gap)/(photoHeight+gap));
 if(columns<1||rows<1)throw new GeometryError('photo-does-not-fit');
 const startX=Math.floor((width-(columns*photoWidth+(columns-1)*gap))/2);
 const startY=Math.floor((height-(rows*photoHeight+(rows-1)*gap))/2);
 const positions=[];
 for(let row=0;row<rows;row++)for(let col=0;col<columns;col++)positions.push(Object.freeze([startX+col*(photoWidth+gap),startY+row*(photoHeight+gap)]));
 return Object.freeze({paper,width,height,photoWidth,photoHeight,columns,rows,count:positions.length,margin,gap,assumedDpi,positions:Object.freeze(positions)});
}
