/** Compile-only examples: accepted wire shapes and rejected integration mistakes. */
import type {JobId,InputSelectionId,ExportTaskId,ExportJobLifecycle,AssetId,InputId,OperationId,RgbImagePlane,RgbaImagePlane,PixelWorkerRequest,PixelWorkerEvent,ActiveSessionJob} from '../docs/browser/worker-contract';
const jobId='worker-job' as JobId,sourceAssetId='source' as AssetId,operationId='intent' as OperationId;
const rgb:RgbImagePlane={width:1,height:1,format:'rgb-u8',data:new ArrayBuffer(3)};
const rgba:RgbaImagePlane={width:1,height:1,format:'rgba-u8',data:new ArrayBuffer(4)};
const resize:PixelWorkerRequest={jobId,type:'resize',image:rgb,options:{width:354,height:472,box:[0,0,1,1]}};
const paper:PixelWorkerRequest={jobId,type:'render-paper',image:rgb,options:{paper:'l',dpi:[300,300]}};
const transparent:PixelWorkerRequest={jobId,type:'encode',image:rgba,options:{kind:'transparent',format:'png'}};
const pdf:PixelWorkerRequest={jobId,type:'encode',image:rgb,options:{kind:'paper',paper:'a4',format:'pdf'}};
const result:PixelWorkerEvent={jobId,type:'encoded',file:{bytes:new Uint8Array(1),width:1,height:1,mime:'application/pdf',filename:'image-studio-paper-a4.pdf'}};
const state:ActiveSessionJob={operationId,kind:'resize',sourceAssetId,dependencyKey:'crop-1',phase:'running'};
const betweenModels:ActiveSessionJob={operationId,kind:'inference',workerId:null,key:{inputId:'input' as InputId,inferenceRevision:1,modelVersion:'set-1'},phase:'running'};
// @ts-expect-error Session intent holds metadata, not image bytes.
const bytesInSession:ActiveSessionJob={operationId,kind:'resize',sourceAssetId,dependencyKey:'crop-1',phase:'running',data:new ArrayBuffer(3)};
// @ts-expect-error Transparent PNG requires RGBA, never an opaque RGB plane.
const badTransparent:PixelWorkerRequest={jobId,type:'encode',image:rgb,options:{kind:'transparent',format:'png'}};
// @ts-expect-error PDF supports a laid-out paper, not a crop photo.
const badPdf:PixelWorkerRequest={jobId,type:'encode',image:rgb,options:{kind:'crop',format:'pdf'}};
// @ts-expect-error Raw resize accepts RGB only.
const badResize:PixelWorkerRequest={jobId,type:'resize',image:rgba,options:{width:1,height:1,box:[0,0,1,1]}};
// @ts-expect-error Module-specific local errors are not wire Worker errors.
const badEvent:PixelWorkerEvent={jobId,type:'error',code:'resize-worker-stop-failed'};
// @ts-expect-error Encoded PDF has a fixed PDF filename.
const badFile:PixelWorkerEvent={jobId,type:'encoded',file:{bytes:new Uint8Array(1),width:1,height:1,mime:'application/pdf',filename:'private-photo.png'}};
// @ts-expect-error Shared memory is not a transferable image input.
const shared:RgbImagePlane={width:1,height:1,format:'rgb-u8',data:new SharedArrayBuffer(3)};
// @ts-expect-error An operation spans Worker jobs; a Worker JobId is not its identity.
const wrongIntent:ActiveSessionJob={operationId:jobId,kind:'paper',sourceAssetId,dependencyKey:'paper-1',phase:'running'};
void [betweenModels,bytesInSession,resize,paper,transparent,pdf,result,state,badTransparent,badPdf,badResize,badEvent,badFile,shared,wrongIntent];

declare const exportJobs: ExportJobLifecycle;
const waitForExport:Promise<boolean>=exportJobs.cancelAndWait('export-task' as ExportTaskId);
// @ts-expect-error The encoded Worker job ID cannot cancel a domain export task.
exportJobs.cancelAndWait(jobId);
void waitForExport;

const decoding:ActiveSessionJob={operationId:'decode-op' as OperationId,phase:'running',kind:'decode',selectionId:'selection' as InputSelectionId};
// @ts-expect-error selection before decode is not an adopted asset identity
const invalidDecode:ActiveSessionJob={operationId:'decode-op' as OperationId,phase:'running',kind:'decode',selectionId:'asset' as AssetId};
void decoding;void invalidDecode;
