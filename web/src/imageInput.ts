import {imageDimensionsFromData} from 'image-dimensions';
import {createImagePreflight,ImagePreflightError} from '../../tools/browser-library-adapter/image-preflight.mjs';
import {PNG_MAX_AXIS,PNG_MAX_PIXELS} from '../../tools/browser-library-adapter/png-input.mjs';

const inspect=createImagePreflight({probe:imageDimensionsFromData,maxAxis:16384,maxPixels:24_000_000});
// Match the current PNG decoder's admission before native preview or full-file reads.
// Header admission does not establish CRC, pixel format, orientation or color validity.
export async function inspectImage(file:Blob,options:{signal?:AbortSignal}={}){
 const header=await inspect(file,options);
 if(header.type==='png'&&(header.width>PNG_MAX_AXIS||header.height>PNG_MAX_AXIS||header.width>Math.floor(PNG_MAX_PIXELS/header.height)))throw new ImagePreflightError('png-dimensions-too-large');
 return header;
}
