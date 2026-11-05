import {createBackgroundRuntime} from './runtime';
import {releaseAssetPath} from '../../../tools/browser-library-adapter/release-asset.mjs';

type Options=Parameters<typeof createBackgroundRuntime>[0];
type Variant=NonNullable<Options['modelVariants']>[number];
export type ReleaseBackgroundConfig=Omit<Options,'modelWorker'|'foregroundWorker'|'exportWorker'|'thumbnailWorker'|'trimapWorker'|'modelVariants'|'onModelEvent'|'modelNoticesHref'>&{
 workers:{model:string;foreground:string;export:string;thumbnail:string;trimap?:string};
 modelNoticesHref:string;
 modelVariants?:(Omit<Variant,'modelWorker'>&{modelWorker:string})[];
};

/** Build-pinned configuration only; never load settings from a URL, storage or photograph. */
export function createReleaseBackgroundRuntime(config:ReleaseBackgroundConfig|null,origin:string){
 if(config===null)return undefined;
 const asset=(value:string,extension:'js'|'txt')=>new URL(releaseAssetPath(value,extension),origin);
 const {workers,modelVariants,modelNoticesHref,...options}=config;
 return createBackgroundRuntime({...options,
  modelWorker:asset(workers.model,'js'),foregroundWorker:asset(workers.foreground,'js'),exportWorker:asset(workers.export,'js'),thumbnailWorker:asset(workers.thumbnail,'js'),trimapWorker:workers.trimap?asset(workers.trimap,'js'):undefined,
  modelNoticesHref:asset(modelNoticesHref,'txt').href,
  modelVariants:modelVariants?.map(item=>({...item,modelWorker:asset(item.modelWorker,'js')})),
 });
}
