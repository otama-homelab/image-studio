import {isPrivateValidationOrigin} from '../../tools/browser-library-adapter/private-validation-origin.mjs';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import Root from './Root';
import {createBackgroundRuntime} from './background/runtime';
import config from 'image-studio-local-config';
import {createLocalValidationTrace} from './localValidationTrace.mjs';
import {imageWorkGate} from './imageWorkGate';
import './style.css';

// This entry is built only by the private validation tool; main.tsx never imports it.
const origin=new URL(config.appOrigin);
if(config.scope!=='local-validation-only-not-approved-for-distribution'||config.distributionApproved!==false
 ||location.origin!==config.appOrigin||!isPrivateValidationOrigin(config.appOrigin,config.privateLanHttps===true))throw Error('Local validation origin required');
const trace=createLocalValidationTrace();
Object.defineProperty(window,'__imageStudioValidation',{value:()=>({...trace.read(),gate:imageWorkGate.getState()})});
const baseRuntime=createBackgroundRuntime({executionProvider:config.executionProvider,modelNoticesHref:config.modelNoticesHref,foregroundCancellation:config.foregroundCancellation,trimapCancellation:config.trimapCancellation,modelCancellation:config.modelCancellation,prepareHr:config.prepareHr,prepareBackground:config.prepareBackground,modelLabel:config.modelLabel,modelVariants:config.modelVariants?.map(item=>({...item,modelWorker:new URL(item.modelWorker)})),prepareMatte:config.prepareMatte,onModelEvent:trace.onEvent,
 modelWorker:new URL(config.workers.model),foregroundWorker:new URL(config.workers.foreground),
 exportWorker:new URL(config.workers.export),thumbnailWorker:new URL(config.workers.thumbnail),trimapWorker:config.workers.trimap?new URL(config.workers.trimap):undefined,
 downloadDescription:`ローカル検証用の固定モデル約${Math.ceil(config.modelResourceBytes/1024/1024)}MiBを利用します。`});
const runtime={...baseRuntime,createSession(onChange:Parameters<typeof baseRuntime.createSession>[0]){
 return baseRuntime.createSession(state=>{trace.onState(state);onChange(state);});
}};
if(!location.hash)history.replaceState(null,'','#/background');
createRoot(document.getElementById('root')!).render(<StrictMode><Root backgroundRuntime={runtime}/></StrictMode>);
