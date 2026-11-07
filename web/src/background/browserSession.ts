import {createBackgroundSession} from './session.mjs';
import {imageWorkGate} from '../imageWorkGate';
import {createCooperativeWorkerStop} from '../../../tools/browser-library-adapter/cooperative-worker-stop.mjs';
import {createWorkerClient} from '../../../tools/browser-library-adapter/worker-client.mjs';
import {createForegroundWorkerClient} from '../../../tools/browser-library-adapter/foreground-worker-client.mjs';
import {createExportWorkerClient} from '../../../tools/browser-library-adapter/export-worker-client.mjs';
import type {BackgroundRuntime} from './BackgroundEditor';
import {createTrimapWorkerClient} from '../../../tools/browser-library-adapter/trimap-worker.mjs';

type Gate=typeof imageWorkGate;
type PrepareCommand={type:'prepare';model:'hr'|'matte'|'modnet'|'portrait'|'lite';modelVersion:string;[field:string]:unknown};
const stopModelWorker=createCooperativeWorkerStop({requestType:'cancel',responseType:'cancelled',timeoutMs:120000});
type Options={
 defaultRefine?:boolean;
 modelCancellation?:'cooperative-model-cancel-v1';
 foregroundCancellation?:'cooperative-foreground-cancel-v1';trimapCancellation?:'cooperative-trimap-cancel-v1';
 prepareHr?:PrepareCommand;prepareBackground?:PrepareCommand;prepareMatte?:PrepareCommand;
 modelVariants?:{defaultRefine?:boolean;executionProvider?:'webgpu'|'wasm';modelCancellation?:'cooperative-model-cancel-v1';label:string;description:string;prepareBackground:PrepareCommand;prepareMatte?:PrepareCommand;modelWorker:URL}[];
 trimapWorker?:URL;
 onChange?:Parameters<BackgroundRuntime['createSession']>[0];
 // Trusted, built application artifacts. Never URLs obtained from user image metadata.
 modelWorker:URL;foregroundWorker:URL;exportWorker:URL;
 onModelEvent?:(event:unknown)=>void;
};

/** Lazy browser wiring: construction does not start a Worker, model fetch, or GPU request. */
export function createBrowserBackgroundSession({modelWorker,foregroundWorker,exportWorker,trimapWorker,onModelEvent,...options}:Options){
 const protocols=[['model',options.modelCancellation],['foreground',options.foregroundCancellation],['trimap',options.trimapCancellation],...(options.modelVariants??[]).map(item=>['model',item.modelCancellation])];
 for(const [role,protocol] of protocols)if(protocol!==undefined&&protocol!==`cooperative-${role}-cancel-v1`)throw Error(`invalid-${role}-cancellation-protocol`);

 return createBackgroundSession({...options,prepareHr:options.prepareHr,prepareBackground:options.prepareBackground,prepareMatte:options.prepareMatte,makeTrimap:undefined,gate:imageWorkGate,
  createTrimapClient:trimapWorker?({gate}:{gate:Gate})=>createTrimapWorkerClient({gate,cancellationProtocol:options.trimapCancellation,createWorker:()=>new Worker(trimapWorker)}):null,
  createModelClient:({gate,onEvent,modelVersion}:{gate:Gate;onEvent:(event:unknown)=>void;modelVersion:string})=>{const variant=options.modelVariants?.find(item=>item.prepareBackground.modelVersion===modelVersion);const protocol=variant?variant.modelCancellation:options.modelCancellation;return createWorkerClient({...(protocol==='cooperative-model-cancel-v1'?{stopWorker:stopModelWorker}:{}),gate,onEvent:(...events:unknown[])=>{onEvent(events[0]);onModelEvent?.(events[0]);},createWorker:()=>new Worker(variant?.modelWorker??modelWorker,{type:'module'})});},
  createForegroundClient:({gate,rgba}:{gate:Gate;rgba:boolean})=>createForegroundWorkerClient({gate,rgba,cancellationProtocol:options.foregroundCancellation,createWorker:()=>new Worker(foregroundWorker,{type:'module'})}),
  createExportClient:({gate}:{gate:Gate})=>createExportWorkerClient({gate,createWorker:()=>new Worker(exportWorker,{type:'module'})}),
 });
}
