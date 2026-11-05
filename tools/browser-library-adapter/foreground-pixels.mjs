/** Existing RGB/alpha byte boundary, normalized only inside the worker. */
export function foregroundPixels({width,height,rgb,alpha}={}){
 if(![width,height].every(n=>Number.isSafeInteger(n)&&n>0&&n<=2000)||width*height===1||!(rgb instanceof Uint8Array)||!(alpha instanceof Uint8Array)||!(rgb.buffer instanceof ArrayBuffer)||!(alpha.buffer instanceof ArrayBuffer)||rgb.length!==width*height*3||alpha.length!==width*height)throw Error('invalid-foreground-input');
 return {width,height,rgb,alpha};
}
export function foregroundRgbaResult(result,expected){
 if(result?.width!==expected.width||result?.height!==expected.height||result.format!=='rgba-u8'||!(result.data instanceof ArrayBuffer)||result.data.byteLength!==expected.width*expected.height*4)throw Error('invalid-foreground-result');
 return {width:result.width,height:result.height,format:'rgba-u8',data:result.data};
}
