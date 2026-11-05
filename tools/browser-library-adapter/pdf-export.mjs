import {PAPER_PIXELS} from './paper-contract.mjs';
export class PdfExportError extends Error {
 constructor(code){super(code);this.name='PdfExportError';this.code=code;}
}

/** Embed the same RGB paper PNG once, without separate photo placement or JPEG conversion. */
export function createPaperPdfExporter({PDFDocument,exportPng}){
 return async function exportPdf(image,{kind,paper}={}){
  if(kind!=='paper'||!Object.hasOwn(PAPER_PIXELS,paper)||image?.format!=='rgb-u8'
   ||image.width!==PAPER_PIXELS[paper][0]||image.height!==PAPER_PIXELS[paper][1]
   ||!(image.data instanceof ArrayBuffer)||image.data.byteLength!==image.width*image.height*3)throw new PdfExportError('invalid-export-input');
  try{
   const png=await exportPng(image,{kind:'paper',paper});
   if(!(png?.bytes instanceof Uint8Array)||png.mime!=='image/png')throw Error('invalid-paper-png');
   const document=await PDFDocument.create({updateMetadata:false});
   const embedded=await document.embedPng(png.bytes);
   if(embedded.width!==image.width||embedded.height!==image.height)throw Error('paper-png-size-mismatch');
   const widthPoints=image.width*72/300,heightPoints=image.height*72/300;
   const page=document.addPage([widthPoints,heightPoints]);
   page.drawImage(embedded,{x:0,y:0,width:widthPoints,height:heightPoints});
   const bytes=await document.save({useObjectStreams:false,addDefaultPage:false});
   if(!(bytes instanceof Uint8Array)||![37,80,68,70,45].every((v,i)=>bytes[i]===v))throw Error('invalid-pdf-result');
   return {bytes,mime:'application/pdf',filename:`image-studio-paper-${paper}.pdf`,width:image.width,height:image.height};
  }catch{throw new PdfExportError('pdf-encode-failed');}
 };
}
