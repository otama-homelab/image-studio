import {normalizeExportOptions,exportFilename,ExportJobError} from './export-job.mjs';
import {PAPER_PIXELS} from './paper-contract.mjs';
export function exportTransport(image,input){
 const options=normalizeExportOptions(input),channels=options.kind==='transparent'||options.backgroundColor?4:3;
 if(!image||image.format!==(channels===4?'rgba-u8':'rgb-u8')||!Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)
  ||image.width<1||image.height<1||!Number.isSafeInteger(image.width*image.height*channels)
  ||!(image.data instanceof ArrayBuffer)||image.data.byteLength!==image.width*image.height*channels
  ||(options.kind==='paper'&&(image.width!==PAPER_PIXELS[options.paper][0]||image.height!==PAPER_PIXELS[options.paper][1])))throw new ExportJobError('invalid-export-source');
 return {image:{width:image.width,height:image.height,format:image.format,data:image.data},options,transfer:[image.data]};
}
export function exportResult(file,image,options){
 if(!(file?.bytes instanceof Uint8Array)||!(file.bytes.buffer instanceof ArrayBuffer)||!file.bytes.length
  ||file.mime!==(options.format==='pdf'?'application/pdf':'image/png')||file.filename!==exportFilename(options)
  ||file.width!==image.width||file.height!==image.height)throw new ExportJobError('invalid-export-result');
 const bytes=file.bytes.byteOffset===0&&file.bytes.byteLength===file.bytes.buffer.byteLength?file.bytes:new Uint8Array(file.bytes);
 return {bytes,mime:file.mime,filename:file.filename,width:file.width,height:file.height};
}
