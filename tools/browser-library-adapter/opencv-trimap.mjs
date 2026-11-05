export class TrimapError extends Error {
 constructor(code){super(code);this.name='TrimapError';this.code=code;}
}
export function trimapRadius(width,height){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>2000||height>2000)throw new TrimapError('invalid-alpha-dimensions');
 const value=Math.max(width,height)*0.006,lower=Math.floor(value);
 return Math.max(3,value-lower===0.5?lower+(lower%2):Math.round(value));
}

/** Ready OpenCV.js API required; this module does not load or initialize the WASM bundle. */
export function createOpenCvTrimap(cv){
 return function makeTrimap(alpha){
  const radius=trimapRadius(alpha?.width,alpha?.height);
  if(alpha.layout!=='alpha-u8'||!(alpha.data instanceof ArrayBuffer)||alpha.data.byteLength!==alpha.width*alpha.height)throw new TrimapError('invalid-alpha-plane');
  const owned=[];const own=mat=>{owned.push(mat);return mat;};
  try{
   const source=own(cv.matFromArray(alpha.height,alpha.width,cv.CV_8UC1,new Uint8Array(alpha.data)));
   const foreground=own(new cv.Mat()),background=own(new cv.Mat());
   const kernel=own(cv.getStructuringElement(cv.MORPH_ELLIPSE,new cv.Size(2*radius+1,2*radius+1)));
   cv.threshold(source,foreground,249,255,cv.THRESH_BINARY);
   cv.threshold(source,background,5,255,cv.THRESH_BINARY_INV);
   // Three-argument overload uses OpenCV's default center, one iteration and morphology border value.
   cv.erode(foreground,foreground,kernel);cv.erode(background,background,kernel);
   const fg=foreground.data,bg=background.data,trimap=new Uint8Array(alpha.width*alpha.height).fill(128);
   if(fg.length!==trimap.length||bg.length!==trimap.length)throw new TrimapError('invalid-morphology-result');
   for(let i=0;i<trimap.length;i++){if(fg[i])trimap[i]=255;if(bg[i])trimap[i]=0;}
   return {width:alpha.width,height:alpha.height,layout:'trimap-u8',data:trimap.buffer};
  }finally{
   let failed=false;
   for(const mat of owned.reverse())try{mat.delete();}catch{failed=true;}
   if(failed)throw new TrimapError('trimap-release-failed');
  }
 };
}
