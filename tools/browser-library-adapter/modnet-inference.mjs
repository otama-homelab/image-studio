import {createSingleSessionMaskInference} from './single-session-mask-inference.mjs';
/** Fixed published MODNet processor; its ONNX already returns alpha probabilities. */
export function createModnetInference(options){
 const config=options.processorConfig;
 if(config?.size?.shortest_edge!==512||config.size_divisibility!==32||config.resample!==2)throw Error('modnet-preprocessing-unavailable');
 return createSingleSessionMaskInference(options,{role:'modnet',inputName:'input',outputName:'output'});
}
