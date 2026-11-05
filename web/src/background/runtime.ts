import {t} from '../i18n';
import {createBrowserBackgroundSession} from './browserSession';
import {createBackgroundInput} from './input';
import type {BackgroundRuntime} from './BackgroundEditor';
import {readBrowserCapabilities} from '../browserCapabilities';
import {imageWorkGate} from '../imageWorkGate';
import {createResizeWorkerClient} from '../../../tools/browser-library-adapter/resize-worker-client.mjs';
import {thumbnailSize} from '../../../tools/browser-library-adapter/thumbnail-size.mjs';
import {createModelCacheActions} from '../../../tools/browser-library-adapter/model-cache-actions.mjs';

type BrowserOptions=Parameters<typeof createBrowserBackgroundSession>[0];
type Options=Omit<BrowserOptions,'onChange'>&{thumbnailWorker:URL;executionProvider?:'webgpu'|'wasm';downloadDescription:string;modelLabel?:string;modelNoticesHref?:string};

function processingNotice(background:BrowserOptions['prepareBackground'],matte:BrowserOptions['prepareMatte'],provider:'webgpu'|'wasm'){
 if(background?.model!=='hr'||!matte)return undefined;
 if(provider==='webgpu')return t("この構成にはWebGPU対応GPUが必要です。");
 // Reference: validation/2026-11-03-cpu-threephase-main-square-success.json; one image, no end-to-end timing guarantee.
 return t("HR＋ViTMatteの高画質処理は、CPUでは処理に長い時間がかかります。参考：AMD CPU・最大2スレッドの検証では、2000×2000pxの主要処理に約6分22秒、ブラウザ各プロセスのRSS合計は最大約6.3GiBでした（共有メモリの重複を含みます）。初回のモデル取得・その他の準備・前景色処理・PNG保存には別途時間がかかります。端末や画像によってさらに遅くなる場合や、メモリ不足で処理できない場合があります。");
}

/** Called only with a trusted release's descriptors, artifacts and reference input resize.
 * The production entry does not call this while the model/resource acceptance gate is open.
 */
export function createBackgroundRuntime({thumbnailWorker,downloadDescription,modelLabel,modelNoticesHref,executionProvider='webgpu',...options}:Options):BackgroundRuntime{
 const thumbnail=createResizeWorkerClient({gate:imageWorkGate,createWorker:()=>new Worker(thumbnailWorker,{type:'module'})});
 const input=createBackgroundInput({resizeOriginal:(image,signal)=>thumbnail.resize(image,{...thumbnailSize(image.width,image.height),thumbnail:true},{signal})});
 // Product policy: HR is offered on PCs; viewport size and touch alone do not identify a phone/tablet.
 const nav=globalThis.navigator as Navigator&{userAgentData?:{mobile?:boolean}};
 const mobile=nav?.userAgentData?.mobile===true||/Android|iPhone|iPad|iPod/i.test(nav?.userAgent??'')||(/Macintosh/i.test(nav?.userAgent??'')&&(nav?.maxTouchPoints??0)>1);
 if(mobile)options.modelVariants=options.modelVariants?.filter(item=>item.prepareBackground.model!=='hr');
 const primary=options.prepareBackground??options.prepareHr;
 if(!primary)throw Error('background-model-required');
 const configurations=[{id:primary.modelVersion,background:primary,matte:options.prepareMatte,provider:executionProvider},...(options.modelVariants??[]).map(item=>({id:item.prepareBackground.modelVersion,background:item.prepareBackground,matte:item.prepareMatte,provider:item.executionProvider??'webgpu'}))];
 if(configurations.some(item=>!['webgpu','wasm'].includes(item.provider)))throw Error('unknown-background-execution-provider');
 const caches=new Map(configurations.map(item=>{
  const actions=(releases:unknown[])=>createModelCacheActions({releases,gate:imageWorkGate});
  const background=actions([item.background.source]),matte=item.matte?actions([item.matte.source]):null;
  return [item.id,{background,matte,all:item.matte?actions([item.background.source,item.matte.source]):background}];
 }));
 if(caches.size!==configurations.length)throw Error('duplicate-background-model');
 const cacheFor=(id=primary.modelVersion)=>{const actions=caches.get(id);if(!actions)throw Error('unknown-model-cache-scope');return actions;};
 const capacity=(id:string)=>t("この構成{{v0}}のモデル資源は約{{v1}}MiBです。",{v0:cacheFor(id).matte?t("全体（輪郭補正用を含む）"):'',v1:Math.ceil(cacheFor(id).all.getScope().expectedBytes/1024/1024)});
 return {
  downloadDescription:capacity(primary.modelVersion),modelLabel,modelNoticesHref,processingNotice:processingNotice(primary,options.prepareMatte,executionProvider),
  models:options.modelVariants?.length?[{id:(options.prepareBackground??options.prepareHr)!.modelVersion,label:modelLabel??t("標準モデル"),description:downloadDescription,processingNotice:processingNotice(primary,options.prepareMatte,executionProvider),downloadDescription:capacity(primary.modelVersion)},...options.modelVariants.map(item=>({id:item.prepareBackground.modelVersion,label:item.label,description:item.description,processingNotice:processingNotice(item.prepareBackground,item.prepareMatte,item.executionProvider??'webgpu'),downloadDescription:capacity(item.prepareBackground.modelVersion)}))]:undefined,
  inspectCache:async(id,selection)=>{
   const scope=cacheFor(id);
   if(!selection)return scope.all.inspect();
   if(!selection.refine)return selection.backgroundMaskAvailable
    ?{foundFiles:0,expectedFiles:0,expectedBytes:0,missingBytes:0,downloadBytes:0}
    :scope.background.inspect();
   if(!scope.matte)throw Error('refinement-cache-scope-unavailable');
   return (selection.backgroundMaskAvailable?scope.matte:scope.all).inspect();
  },clearCache:async id=>cacheFor(id).all.clear(),
  estimateStorage:async()=>{
   const storage=globalThis.navigator?.storage;if(typeof storage?.estimate!=='function')throw Error('storage-estimate-unavailable');
   const {usage,quota}=await storage.estimate();if(![usage,quota].every(value=>Number.isSafeInteger(value)&&value!>=0))throw Error('storage-estimate-unavailable');
   return Object.freeze({usageBytes:usage!,quotaBytes:quota!,availableBytes:Math.max(0,quota!-usage!)});
  },
  checkEnvironment:(id=primary.modelVersion)=>{
   const config=configurations.find(item=>item.id===id);if(!config)throw Error('unknown-background-model');
   const caps=readBrowserCapabilities(),missing:string[]=[];
   if(!caps.worker)missing.push('Worker');if(!caps.objectURLs)missing.push('Blob URL');if(!caps.fileAPI)missing.push('File / Blob');
   if(!caps.webAssembly)missing.push('WebAssembly');
   if(config.provider==='webgpu'){if(!caps.secureContext)missing.push(t("安全な接続（HTTPS等）"));if(!caps.webgpuAPI)missing.push('WebGPU');}
   return {mode:config.provider==='wasm'?'cpu':'gpu',missing};
  },
  refineAvailable:!!options.prepareMatte&&!!options.trimapWorker,
  decodePhoto:(file,signal)=>input.read(file,signal),
  createSession:onChange=>createBrowserBackgroundSession({...options,onChange}),
 };
}
