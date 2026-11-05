/** Pillow 12.3.0 Image.thumbnail aspect rule, fixed product bound and loaded RGB input.
 * Ties choose floor; portrait rounding minimizes aspect error rather than pixel distance.
 */
export function thumbnailSize(width,height){
 if(![width,height].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=16384)||width*height>24_000_000)throw Error('invalid-thumbnail-size');
 if(width<=2000&&height<=2000)return {width,height};
 const aspect=width/height;
 const round=(n,key)=>Math.max(key(Math.floor(n))<=key(Math.ceil(n))?Math.floor(n):Math.ceil(n),1);
 if(aspect<=1)return {width:round(2000*aspect,n=>Math.abs(aspect-n/2000)),height:2000};
 return {width:2000,height:round(2000/aspect,n=>n===0?0:Math.abs(aspect-2000/n))};
}
