/** Match Pillow convert('RGB'): discard input alpha, preserve its hidden RGB. */
export function createInputRgb({RawImage}){
 return image=>{
  const channels=image?.format==='rgb-u8'?3:image?.format==='rgba-u8'?4:0;
  if(!channels||![image.width,image.height].every(n=>Number.isSafeInteger(n)&&n>0)||!Number.isSafeInteger(image.width*image.height*channels)||!(image.data instanceof ArrayBuffer)||image.data.byteLength!==image.width*image.height*channels)throw new Error('invalid-input-rgb');
  let converted;
  try{converted=new RawImage(new Uint8Array(image.data),image.width,image.height,channels).rgb();}
  catch{throw new Error('input-rgb-failed');}
  if(converted?.width!==image.width||converted?.height!==image.height||converted?.channels!==3||!(converted.data instanceof Uint8Array||converted.data instanceof Uint8ClampedArray)||converted.data.length!==image.width*image.height*3)throw new Error('invalid-input-rgb-result');
  return {width:image.width,height:image.height,format:'rgb-u8',data:Uint8Array.from(converted.data).buffer};
 };
}
