import type {JobId,InputDecodeWorkerRequest,InputDecodeWorkerEvent,InputDecodeClientFailureCode,RgbImagePlane,RgbaImagePlane} from '../docs/browser/worker-contract';
declare const jobId:JobId;
declare const rgb:RgbImagePlane;
declare const rgba:RgbaImagePlane;
const png:InputDecodeWorkerRequest={jobId,type:'decode-png',file:new Blob([new Uint8Array(1)],{type:'image/png'})};
const jpeg:InputDecodeWorkerRequest={jobId,type:'decode-jpeg',file:new Blob([new Uint8Array(1)],{type:'image/jpeg'})};
const pngResult:InputDecodeWorkerEvent<'png'>={jobId,type:'png-decoded',image:rgba};
const jpegResult:InputDecodeWorkerEvent<'jpeg'>={jobId,type:'jpeg-decoded',image:rgb};
const wireError:InputDecodeWorkerEvent<'png'>={jobId,type:'error',code:'png-input-worker-failed'};
const localError:InputDecodeClientFailureCode='jpeg-input-worker-stop-failed';
// @ts-expect-error File carries private name/lastModified and must be rewrapped first.
const privateFile:InputDecodeWorkerRequest={jobId,type:'decode-png',file:new File(['data'],'private.png')};
// @ts-expect-error Native Blob payload is not an ArrayBuffer transfer.
const rawBytes:InputDecodeWorkerRequest={jobId,type:'decode-png',file:new ArrayBuffer(1)};
// @ts-expect-error JPEG decoder returns opaque RGB only.
const alphaJpeg:InputDecodeWorkerEvent<'jpeg'>={jobId,type:'jpeg-decoded',image:rgba};
// @ts-expect-error PNG response cannot satisfy a JPEG-owned request.
const wrongFormat:InputDecodeWorkerEvent<'jpeg'>={jobId,type:'png-decoded',image:rgb};
// @ts-expect-error Local stop failure is never a decoder wire error.
const wrongError:InputDecodeWorkerEvent<'png'>={jobId,type:'error',code:'png-input-worker-stop-failed'};
// @ts-expect-error Request never transports the source filename separately.
const filename:InputDecodeWorkerRequest={jobId,type:'decode-png',file:new Blob(),filename:'private.png'};
void [png,jpeg,pngResult,jpegResult,wireError,localError,privateFile,rawBytes,alphaJpeg,wrongFormat,wrongError,filename];
