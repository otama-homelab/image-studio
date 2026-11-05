import {env,PreTrainedModel,VitMatteForImageMatting,Tensor} from 'transformers-candidate';
import * as ort from 'ort-candidate';
import hashLibrary from 'hash-candidate';
import policy from 'stage-policy';
import {createStageWorkerHandler} from './stage-worker-handler.mjs';
import {createTransformersPreparation} from './transformers-prepare.mjs';
import {createOrtRuntimeBootstrap} from './ort-runtime-bootstrap.mjs';
import {makeHashWasmFactory} from './hash-wasm-factory.mjs';
const library={env,PreTrainedModel,VitMatteForImageMatting,Tensor};
const makeHasher=makeHashWasmFactory(hashLibrary.createSHA256);
const handle=createStageWorkerHandler({maxJobs:policy.maxStagesPerWorker??(policy.workerLifetime==='per-run'?policy.stages.length:1),catalog:policy.stages,Tensor:library.Tensor,postMessage:(event,transfer)=>self.postMessage(event,transfer),
 async prepareStage(index,hooks){
  const stage=policy.stages[index],cache=await self.caches.open(stage.release.cacheNamespace);
  const configureRuntime=createOrtRuntimeBootstrap({ort,gpu:navigator.gpu,origin:self.location.origin,wasmOrigin:policy.wasmOrigin,runtimeAssets:policy.runtimeAssets,...policy.profile});
  return createTransformersPreparation({library,localModelPath:stage.localModelPath,fetchImpl:self.fetch.bind(self),cache,makeHasher,configureRuntime,
   onLoadFailure:error=>{if(policy.scope==='local-validation-only-not-approved-for-distribution')console.error('[image-studio-local-model-load] '+String(error?.message??'model-loader-exception').slice(0,2048));}})(stage.release,hooks);
 },
});
self.addEventListener('message',event=>{void handle(event.data);});
