/** Browser module Worker entry. Bundler resolves all codec dependencies locally. */
import {encode} from 'fast-png';
import crc32 from 'crc-32';
import {PDFDocument} from 'pdf-lib';
import {createPngExporter} from './png-export.mjs';
import {createPaperPdfExporter} from './pdf-export.mjs';
import {createExportWorkerHandler} from './export-worker-handler.mjs';
const encodePng=createPngExporter({encode,crc32:crc32.buf});
const encodePdf=createPaperPdfExporter({PDFDocument,exportPng:encodePng});
const handle=createExportWorkerHandler({encodePng,encodePdf,postMessage:(event,transfer)=>self.postMessage(event,transfer)});
self.addEventListener('message',event=>{void handle(event.data);});
