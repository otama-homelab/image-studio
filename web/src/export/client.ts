import {stopCropWorker} from './cropStop';
import {imageWorkGate} from '../imageWorkGate';
import {createSingleWorkerTask} from '../../../tools/browser-library-adapter/single-worker-task.mjs';
import {PAPER_PIXELS} from '../../../tools/browser-library-adapter/paper-contract.mjs';
import type {ExportRequest,PreparedFile} from './types';
class ExportError extends Error{code:string;constructor(code:string){super(code);this.code=code;}}
// Decode and export share admission across all mounted editor sessions.
export function createCropExportClient(){
 const task=createSingleWorkerTask({stopWorker:stopCropWorker,gate:imageWorkGate,createWorker:()=>new Worker(new URL('./crop.worker.ts',import.meta.url),{type:'module'}),ErrorClass:ExportError,prefix:'crop-save',requestType:'crop-png',responseType:'crop-png-ready',errorCodes:['crop-resize-unavailable','png-dimensions-too-large','pdf-module-unavailable','unsupported-png-format','unsupported-browser','invalid-crop-input','crop-encode-failed','unsupported-print-dpi','invalid-print-metadata','photo-does-not-fit'],
  prepare(input:ExportRequest){if(typeof Worker!=='function')throw new ExportError('unsupported-browser');return {request:{...input,file:new Blob([input.file],{type:input.file.type})},transfer:[],context:{width:input.output.kind==='paper'?PAPER_PIXELS[input.output.paper][0]:input.mode==='crop'?input.width:0,height:input.output.kind==='paper'?PAPER_PIXELS[input.output.paper][1]:input.mode==='crop'?input.height:0,mime:input.output.format==='pdf'?'application/pdf':'image/png',filename:input.output.kind==='crop'?'image-studio-crop-300dpi.png':`image-studio-paper-${input.output.paper}${input.output.format==='pdf'?'.pdf':'-300dpi.png'}`}};},
  validate(event:{file:PreparedFile},expected:{width:number;height:number;mime:string;filename:string}){const f=event.file;if(f?.mime!==expected.mime||f.filename!==expected.filename||f.width!==expected.width||f.height!==expected.height||!(f.bytes instanceof Uint8Array)||!f.bytes.length)throw new ExportError('invalid-crop-output');return f;},
 });
 return {generate:(input:ExportRequest,signal:AbortSignal)=>task.run(input,{signal}) as Promise<PreparedFile>,close:task.close,getState:task.getState};
}
