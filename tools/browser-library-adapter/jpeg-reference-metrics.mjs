/** Diagnostic measurement only; caller must decide acceptance thresholds separately. */
export function measureJpegRgb(image,reference){
 if(image?.format!=='rgb-u8'||!(image.data instanceof ArrayBuffer))throw Error('invalid-jpeg-measurement');
 const width=image.width,height=image.height;
 if(![width,height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=64)||image.data.byteLength!==width*height*3)throw Error('invalid-jpeg-measurement');
 if(width!==reference.width||height!==reference.height)return {dimensionsMatch:false,actualSize:[width,height],expectedSize:[reference.width,reference.height]};
 const actual=new Uint8Array(image.data),expected=reference.data;
 if(!(expected instanceof Uint8Array)||expected.length!==actual.length)throw Error('invalid-jpeg-reference');
 let max=0,total=0,changed=0;
 for(let i=0;i<actual.length;i++){const difference=Math.abs(actual[i]-expected[i]);max=Math.max(max,difference);total+=difference;if(difference)changed++;}
 return {dimensionsMatch:true,actualSize:[width,height],maxChannelDifference:max,meanAbsoluteChannelDifference:total/actual.length,changedChannels:changed,totalChannels:actual.length};
}
