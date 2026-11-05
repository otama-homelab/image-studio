/** Node-only codec/transport fixture. Never bundled as the browser production Worker. */
import {parentPort,workerData} from 'node:worker_threads';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createExportWorkerHandler} from '../../tools/browser-library-adapter/export-worker-handler.mjs';
import {exportFilename} from '../../tools/browser-library-adapter/export-job.mjs';
let encodePng,encodePdf;
if(workerData?.dependencyRoot){
 const root=workerData.dependencyRoot,require=createRequire(import.meta.url);
 const {encode}=await import(pathToFileURL(path.join(root,'node_modules/fast-png/lib/index.js')).href);
 const crc=require(path.join(root,'node_modules/crc-32/crc32.js')),{PDFDocument}=require(path.join(root,'node_modules/pdf-lib/cjs/index.js'));
 const {createPngExporter}=await import('../../tools/browser-library-adapter/png-export.mjs');
 const {createPaperPdfExporter}=await import('../../tools/browser-library-adapter/pdf-export.mjs');
 encodePng=createPngExporter({encode,crc32:crc.buf});encodePdf=createPaperPdfExporter({PDFDocument,exportPng:encodePng});
}else{
 const encode=async(image,options)=>{
  if(workerData?.crash){setImmediate(()=>{throw Error('private codec thread payload');});return new Promise(()=>{});}
  const pixels=new Uint8Array(image.data);
  return {bytes:Buffer.from([99,pixels[0],pixels.at(-1),88]).subarray(1,3),mime:options.format==='pdf'?'application/pdf':'image/png',filename:exportFilename(options),width:image.width,height:image.height};
 };
 encodePng=encodePdf=encode;
}
const handle=createExportWorkerHandler({encodePng,encodePdf,postMessage:(event,transfer)=>parentPort.postMessage(event,transfer)});
parentPort.on('message',command=>{void handle(command);});
